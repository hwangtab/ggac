/**
 * 예매 결제 승인 확정.
 *
 * 조합비 확정(`/api/payments/dues/confirm`)과 같은 규칙을 따른다 — 금액을
 * 원장과 대조하고, 토스에는 **저장값**을 넘기며, 판단할 수 없는 실패는
 * 실패로 확정하지 않는다.
 *
 * 다른 점은 **좌석**이다. 승인이 끝나면 선점해 둔 예매를 확정으로 바꿔야
 * 하고, 그 전에 선점이 만료되지 않았는지 확인해야 한다.
 */

import { NextRequest } from 'next/server'

import { getPaymentByOrderId, markPaymentDone, markPaymentFailed } from '@/db/queries/payments'
import { getReservationById, confirmReservation, cancelReservation } from '@/db/queries/ticketing'
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

    const payment = await getPaymentByOrderId(orderId)
    if (!payment) return ApiError.notFound('결제 내역을 찾을 수 없습니다.').toNextResponse()

    const reservation = await getReservationById(reservationId)
    if (!reservation) return ApiError.notFound('예매 내역을 찾을 수 없습니다.').toNextResponse()

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
        await cancelReservation(reservationId)
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
        await cancelReservation(reservationId)
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

    const approvedAt =
      typeof approved.approvedAt === 'string' ? approved.approvedAt : new Date().toISOString()
    await markPaymentDone(orderId, {
      paymentKey,
      method: typeof approved.method === 'string' ? approved.method : null,
      approvedAt,
      raw: approved,
    })

    const confirmedPayment = await getPaymentByOrderId(orderId)
    const confirmed = await confirmReservation(reservationId, {
      paymentId: String(confirmedPayment?.id ?? ''),
    })

    // 좌석 확정에 실패했는데 결제는 끝난 상태. 돈만 받고 표를 못 주는 것이
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
