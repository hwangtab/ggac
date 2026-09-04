/**
 * 예매 결제 승인 확정.
 *
 * 조합비 확정(`/api/payments/dues/confirm`)과 같은 규칙을 따른다 — 금액을
 * 원장과 대조하고, 토스에는 **저장값**을 넘기며, 판단할 수 없는 실패는
 * 실패로 확정하지 않는다.
 *
 * 다른 점은 **좌석**이다. 승인이 끝나면 선점해 둔 예매를 확정으로 바꿔야
 * 하고, 그 전에 선점이 만료되지 않았는지 확인해야 한다.
 *
 * **주문과 예매가 짝이 맞는지 먼저 본다.** 예전에는 `orderId`로 결제를,
 * `reservationId`로 예매를 각각 찾아 놓고 둘이 같은 건인지 대조하지 않았다.
 * 금액 검사는 결제 원장을 기준으로 도니, 싼 주문을 결제하고 비싼 예매의 id를
 * 실어 보내면 그대로 통과했다. 같은 이유로, 금액이 어긋났을 때 요청이 지목한
 * 예매를 취소해 주는 것도 결제 없이 남의 자리를 없애는 수단이 됐다.
 *
 * 이제 선점 시점에 새긴 `reservations.order_id`가 유일한 연결 고리다. 짝이
 * 맞지 않으면 **아무것도 바꾸지 않고** 되돌려보낸다.
 */

import { NextRequest } from 'next/server'

import { getPaymentByOrderId, markPaymentFailed } from '@/db/queries/payments'
import {
  getReservationById,
  finalizeTicketPayment,
  cancelReservation,
} from '@/db/queries/ticketing'
import { assertAmountMatches, AmountMismatchError } from '@/lib/payments/toss/protocol'
import {
  confirmPayment,
  cancelPayment,
  TossApiError,
  TossLookupError,
} from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/tickets/confirm')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled()) {
      return ApiError.serviceUnavailable('예매를 준비 중입니다.').toNextResponse()
    }

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const paymentKey = typeof body.paymentKey === 'string' ? body.paymentKey : ''
    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    const reservationId = typeof body.reservationId === 'string' ? body.reservationId : ''
    if (!paymentKey || !orderId || !reservationId) {
      return ApiError.badRequest('결제 정보가 올바르지 않습니다.').toNextResponse()
    }

    // 승인은 토스를 대신 호출하게 만드는 일이라 외부 쿼터와 함수 동시성을 쓴다.
    // 정상적인 결제는 주문 하나에 한 번이므로 넉넉히 잡아도 사람은 걸리지 않는다.
    const rl = await applyRouteRateLimit(request, {
      name: 'ticket_confirm',
      windowMs: 60_000,
      maxRequests: 20,
      message: '결제 확인 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      keyGenerator: createIPKeyGenerator('ticket-confirm'),
    })
    if (!rl.success) {
      return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    // 서로를 필요로 하지 않는 조회다. 원격 왕복을 직렬로 쌓을 이유가 없다.
    const [payment, reservation] = await Promise.all([
      getPaymentByOrderId(orderId),
      getReservationById(reservationId),
    ])
    if (!payment) return ApiError.notFound('결제 내역을 찾을 수 없습니다.').toNextResponse()
    if (!reservation) return ApiError.notFound('예매 내역을 찾을 수 없습니다.').toNextResponse()

    // 이 라우트에서 가장 중요한 한 줄. 여기를 지나면 아래 모든 처리가 "이
    // 주문의 예매"를 다룬다고 믿는다.
    //
    // 예매에 주문번호가 없으면 이 컬럼이 생기기 전의 건이다. 그런 예매는 이
    // 경로로 확정하지 않는다 — 짝을 확인할 방법이 없는 채로 승인하느니 사무국
    // 문의로 보내는 편이 낫다.
    if (!reservation.order_id || reservation.order_id !== orderId) {
      log.error('예매·결제 불일치', {
        orderId,
        reservationId,
        reservationOrderId: reservation.order_id ?? null,
      })
      return ApiError.badRequest(
        '결제 정보와 예매 정보가 일치하지 않습니다. 사무국으로 문의해 주세요.'
      ).toNextResponse()
    }

    // 원장과 예매가 서로 다른 금액을 말하면 어느 쪽도 믿을 수 없다.
    if (Number(reservation.total_amount) !== Number(payment.amount)) {
      log.error('예매 금액과 주문 금액 불일치', {
        orderId,
        reservationAmount: Number(reservation.total_amount),
        paymentAmount: Number(payment.amount),
      })
      return ApiError.badRequest(
        '결제 금액을 확인할 수 없습니다. 사무국으로 문의해 주세요.'
      ).toNextResponse()
    }

    // 새로고침해도 안전하게 — 이미 확정된 건은 그대로 성공으로 답한다.
    if (payment.status === 'done' && reservation.status === 'confirmed') {
      return ApiSuccess.ok({
        orderId,
        reservationCode: reservation.reservation_code,
        amount: payment.amount,
      }).toNextResponse()
    }

    // 선점이 풀린 뒤에 돌아온 경우. 승인하면 좌석 없이 결제만 받게 된다.
    if (reservation.status === 'expired' || reservation.status === 'canceled') {
      await markPaymentFailed(orderId, {
        code: 'RESERVATION_EXPIRED',
        message: '결제 시간이 지나 좌석이 반환되었습니다.',
      })
      return ApiError.badRequest(
        '결제 시간이 지나 좌석이 반환되었습니다. 다시 예매해 주세요.'
      ).toNextResponse()
    }

    const storedAmount = Number(payment.amount)
    try {
      assertAmountMatches(storedAmount, body.amount)
    } catch (error) {
      if (error instanceof AmountMismatchError) {
        log.error('예매 금액 불일치', {
          orderId,
          expected: error.expected,
          received: String(error.received),
        })
        await markPaymentFailed(orderId, {
          code: 'AMOUNT_MISMATCH',
          message: '결제 금액이 주문 금액과 일치하지 않습니다.',
        })
        await cancelReservation(reservationId, { expectedOrderId: orderId })
        return ApiError.badRequest(
          '결제 금액이 일치하지 않아 승인하지 않았습니다.'
        ).toNextResponse()
      }
      throw error
    }

    const { secretKey } = getServerPaymentConfig()

    let approved: Record<string, unknown>
    try {
      approved = await confirmPayment({ paymentKey, orderId, amount: storedAmount }, { secretKey })
    } catch (error) {
      if (error instanceof TossApiError) {
        await markPaymentFailed(orderId, { code: error.code, message: error.message })
        // 결제가 확실히 거절됐으므로 좌석을 즉시 돌려준다 — 다음 사람이 살 수 있다.
        await cancelReservation(reservationId, { expectedOrderId: orderId })
        log.warn('예매 결제 거절', { orderId, code: error.code })
        return ApiError.badRequest(error.message).toNextResponse()
      }
      if (error instanceof TossLookupError) {
        // 승인됐는지 알 수 없다. 좌석도 결제도 건드리지 않는다 — 선점은
        // 만료로 자연히 풀리고, 결제는 대사가 실제 상태로 맞춘다.
        log.error('예매 결제 판단 불가', { orderId, message: error.message })
        return ApiError.serviceUnavailable(
          '결제 결과를 확인하는 중입니다. 잠시 후 예매 내역을 확인해 주세요.'
        ).toNextResponse()
      }
      throw error
    }

    const approvedAtRaw =
      typeof approved.approvedAt === 'string' ? approved.approvedAt : new Date().toISOString()
    const approvedAt = new Date(approvedAtRaw)

    // 결제 확정과 좌석 확정을 한 트랜잭션으로 끝낸다. 예전에는 둘 사이에
    // 인스턴스가 죽으면 결제만 `done`이고 좌석은 `pending`으로 남았고, 아래
    // 자동 환불은 같은 요청이 살아 있을 때만 도는 보상이라 그 상태를 못 막았다.
    const confirmed = await finalizeTicketPayment({
      orderId,
      reservationId,
      paymentKey,
      method: typeof approved.method === 'string' ? approved.method : null,
      approvedAt: Number.isNaN(approvedAt.getTime()) ? new Date() : approvedAt,
      raw: approved,
    })

    // 좌석 확정에 실패했는데 승인은 끝난 상태. 돈만 받고 표를 못 주는 것이
    // 최악이므로 즉시 환불한다.
    if (!confirmed || confirmed.status !== 'confirmed') {
      log.error('예매 확정 실패 — 환불 시도', { orderId, reservationId })
      try {
        await cancelPayment(paymentKey, { cancelReason: '좌석 확정 실패', orderId }, { secretKey })
      } catch (refundError) {
        log.error('자동 환불 실패 — 수동 처리 필요', {
          orderId,
          error: refundError instanceof Error ? refundError.message : refundError,
        })
      }
      return ApiError.internalServerError(
        '좌석을 확정하지 못해 결제를 취소했습니다. 사무국으로 문의해 주세요.'
      ).toNextResponse()
    }

    log.info('예매 확정', { orderId, reservationCode: confirmed.reservation_code })
    return ApiSuccess.ok({
      orderId,
      reservationCode: confirmed.reservation_code,
      amount: storedAmount,
    }).toNextResponse()
  } catch (error) {
    log.error('예매 확정 실패:', error)
    return ApiError.internalServerError('예매를 확정하지 못했습니다.').toNextResponse()
  }
}
