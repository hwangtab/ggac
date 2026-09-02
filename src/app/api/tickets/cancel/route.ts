/**
 * 예매 본인 취소·환불.
 *
 * 순서가 중요하다. **토스에 환불을 먼저 요청하고, 성공한 뒤에 예매를 취소**한다.
 * 뒤집으면 좌석은 풀렸는데 돈은 안 돌아간 상태가 생기고, 그건 관객이 알아채기
 * 어려운 형태로 남는다(화면에는 "취소됨"으로 보인다).
 *
 * 환불 금액은 공연일까지 남은 날짜로 정해진다 — 계산은 `refundPolicy.ts`가
 * 하고 여기는 결과를 쓰기만 한다.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { getReservationById, cancelReservation, getShow } from '@/db/queries/ticketing'
import { getPaymentById, recordPaymentCancel } from '@/db/queries/payments'
import { calculateTicketRefund } from '@/lib/payments/refundPolicy'
import { cancelPayment, TossApiError, TossLookupError } from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/tickets/cancel')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled()) {
      return ApiError.serviceUnavailable('결제 기능을 준비 중입니다.').toNextResponse()
    }

    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const reservationId = typeof body.reservationId === 'string' ? body.reservationId : ''
    if (!reservationId) return ApiError.badRequest('예매를 선택해 주세요.').toNextResponse()

    const reservation = await getReservationById(reservationId)
    if (!reservation) return ApiError.notFound('예매 내역을 찾을 수 없습니다.').toNextResponse()

    // 남의 예매를 취소하는 경로를 막는다. 비회원 예매(user_id가 없는 건)는
    // 여기서 취소할 수 없다 — 본인 확인 수단이 없으므로 사무국이 처리한다.
    if (!reservation.user_id || reservation.user_id !== user.id) {
      log.warn('다른 사람의 예매 취소 시도', { userId: maskId(user.id), reservationId })
      return ApiError.forbidden('본인의 예매만 취소할 수 있습니다.').toNextResponse()
    }

    if (reservation.status !== 'confirmed') {
      return ApiError.badRequest(
        reservation.status === 'canceled'
          ? '이미 취소된 예매입니다.'
          : '취소할 수 있는 예매가 아닙니다.'
      ).toNextResponse()
    }

    const show = await getShow(String(reservation.show_id))
    if (!show) return ApiError.notFound('회차 정보를 찾을 수 없습니다.').toNextResponse()

    const quote = calculateTicketRefund({
      totalAmount: Number(reservation.total_amount),
      showStartsAt: String(show.starts_at),
    })
    if (!quote.refundable) {
      return ApiError.badRequest(quote.reason).toNextResponse()
    }

    const payment = reservation.payment_id
      ? await getPaymentById(String(reservation.payment_id))
      : null
    if (!payment?.payment_key) {
      // 결제 연결이 끊긴 예매다. 임의로 좌석만 풀면 돈이 남으므로 사람이 봐야 한다.
      log.error('결제 연결이 없는 예매의 취소 요청', { reservationId })
      return ApiError.badRequest(
        '결제 정보를 확인할 수 없습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.'
      ).toNextResponse()
    }

    const { secretKey } = getServerPaymentConfig()

    // 1) 먼저 환불한다.
    try {
      await cancelPayment(
        String(payment.payment_key),
        {
          orderId: String(payment.order_id),
          cancelReason: `관객 취소 (공연 ${quote.daysBefore}일 전)`,
          // 전액이면 금액을 싣지 않는다 — 토스가 전액 취소로 처리한다.
          ...(quote.isFullRefund ? {} : { cancelAmount: quote.refundAmount }),
        },
        { secretKey }
      )
    } catch (error) {
      if (error instanceof TossLookupError) {
        // 환불됐는지 알 수 없다. 좌석을 풀면 돈은 그대로인 채 표만 사라진다.
        log.error('환불 판단 불가 — 예매 유지', { reservationId, message: error.message })
        return ApiError.serviceUnavailable(
          '환불 처리를 확인하는 중입니다. 잠시 후 예매 내역을 다시 확인해 주세요.'
        ).toNextResponse()
      }
      if (error instanceof TossApiError) {
        log.warn('환불 거절', { reservationId, code: error.code })
        return ApiError.badRequest(
          `환불에 실패했습니다. 사무국(contact@ggac.kr)으로 문의해 주세요. (${error.message})`
        ).toNextResponse()
      }
      throw error
    }

    // 2) 환불이 끝난 뒤에 좌석을 푼다.
    await recordPaymentCancel(String(payment.order_id), {
      canceledAmount: quote.refundAmount,
      raw: { canceledBy: 'member', daysBefore: quote.daysBefore },
    })
    const canceled = await cancelReservation(reservationId)

    log.info('예매 취소', {
      userId: maskId(user.id),
      reservationId,
      refundAmount: quote.refundAmount,
    })

    return ApiSuccess.ok({
      canceled: true,
      refundAmount: quote.refundAmount,
      deductionRate: quote.deductionRate,
      reason: quote.reason,
      reservationCode: canceled?.reservation_code ?? reservation.reservation_code,
    }).toNextResponse()
  } catch (error) {
    log.error('예매 취소 실패:', error)
    return ApiError.internalServerError('예매를 취소하지 못했습니다.').toNextResponse()
  }
}
