/**
 * 사무국 대리 예매 환불 — 관객을 대신해 조합이 돈을 돌려주고 좌석을 푼다.
 *
 * ## 이 라우트가 없던 동안 무슨 일이 있었나
 *
 * 저장소에서 예매를 환불하는 코드는 본인 취소(`/api/tickets/cancel`) 하나뿐이
 * 었고, 그 길은 **로그인한 본인**의 `confirmed` 예매를, **공연 하루 전까지**만
 * 연다. 비회원 예매는 `user_id`가 비어 있어 첫 조건에서 막히고, 공연 당일
 * 취소는 마지막 조건에서 막힌다. 그 자리에서 사무국에게 남은 수단은 **토스
 * 콘솔**뿐이었다.
 *
 * 콘솔 환불은 우리 원장에 닿지 않는다. 돈은 나갔는데 `reservations.status`는
 * `confirmed`, `payments.status`는 `done`으로 남는다 — 좌석은 영영 잠기고(재고
 * 계산이 그 행을 점유로 센다) 매출 집계는 돌려준 돈을 받은 돈으로 센다. 원장이
 * 모르는 환불이 생기는 것이 이 기능이 막으려는 일이다.
 *
 * 이미 콘솔에서 환불한 건도 같은 버튼으로 정리된다 — 토스가
 * `ALREADY_CANCELED_PAYMENT`로 답하면 클라이언트가 성공으로 바꿔 주므로
 * (`toss/client.ts`) 좌석과 원장만 뒤따라 맞춰진다.
 *
 * ## 무엇을 확인받고 무엇을 남기는가
 *
 * - **사유를 적어야 통과한다**(`normalizeTicketRefundReason`). 되돌릴 수 없고
 *   진짜 돈이 움직이는 동작에서 "사무국이 환불했다"만 남는 기록은 기록이 아니다.
 * - **금액은 사람이 적는다.** 공제율 표(`refundPolicy.ts`)는 관객이 스스로
 *   취소할 때의 기준이고 공연 당일에는 아예 닫힌다 — 사무국이 이 길을 쓰는 때가
 *   바로 그 자리다. 적지 않으면 남은 전액이다. 어느 경우든 상한은 **원장의 남은
 *   금액**이지 브라우저가 보낸 값이 아니다(`planTicketOfficeRefund`).
 * - **활동 기록은 기다려서 남긴다.** 흘려보내면 함수가 얼어붙을 때 돈만 나가고
 *   기록이 사라진다. 실패하면 `logSecurityEvent`로 올린다 — 그래도 응답은
 *   성공이다(환불은 이미 나갔고, 그 사실을 감추는 답이 더 나쁘다).
 *
 * ## 읽은 상태에 조건을 건다
 *
 * 상태를 읽고 나서 그대로 쓰지 않는다. `finalizeTicketRefund`가 한 트랜잭션에서
 * `status IN ('pending','confirmed')`와 `payment_id` 짝을 WHERE에 걸고, 0행이면
 * 그사이 다른 곳에서 움직인 것이다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getReservationById } from '@/db/queries/ticketing'
import { getPaymentById } from '@/db/queries/payments'
import { logUserActivity } from '@/db/queries/activities'
import {
  normalizeTicketRefundReason,
  planTicketOfficeRefund,
  TICKET_REFUND_REASON_MIN,
} from '@/lib/payments/ticketOfficeRefund'
import { refundReservationAsOffice } from '@/lib/server/ticketOfficeRefund'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/tickets/refund')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 토스 취소는 최대 60초까지 걸린다(`toss/client.ts`). 그 뒤 원장·기록이 남는다. */
export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  // 결제 스위치는 인증 뒤에 본다 — 비인증 요청이 401 대신 503을 받으면
  // "인증을 확인하지 않고 막았다"는 착시가 된다(펀딩 환불 라우트와 같다).
  if (!isPaymentEnabled())
    return ApiError.serviceUnavailable('결제 기능을 준비 중입니다.').toNextResponse()

  const { id } = await params
  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    const reason = normalizeTicketRefundReason(body.reason)
    if (reason === null) {
      return ApiError.badRequest(
        `환불 사유를 ${TICKET_REFUND_REASON_MIN}자 이상 적어 주세요. 이 문장이 환불 기록에 그대로 남습니다.`
      ).toNextResponse()
    }

    const reservation = await getReservationById(id)
    if (!reservation) return ApiError.notFound('예매 내역을 찾을 수 없습니다.').toNextResponse()
    const payment = reservation.payment_id
      ? await getPaymentById(String(reservation.payment_id))
      : null

    const plan = planTicketOfficeRefund(reservation, payment, { requestedAmount: body.amount })
    if (plan.ok === false) {
      if (plan.reason === 'already_refunded')
        return ApiError.conflict(plan.message).toNextResponse()
      return ApiError.badRequest(plan.message).toNextResponse()
    }

    const { secretKey } = getServerPaymentConfig()
    const outcome = await refundReservationAsOffice({
      reservationId: String(reservation.id),
      paymentId: String(payment.id),
      paymentKey: String(payment.payment_key),
      orderId: String(payment.order_id),
      refundAmount: plan.refundAmount,
      isFullRefund: plan.isFullRefund,
      canceledAmountTotal: plan.canceledAmountTotal,
      secretKey,
      actorId: auth.user.id,
    })

    if (outcome.ok === false) {
      if (outcome.reason === 'lookup') {
        log.error('환불 판단 불가 — 예매 유지', { reservationId: id })
        return ApiError.serviceUnavailable(
          '환불 결과를 확인하지 못했습니다. 토스 거래 내역을 확인한 뒤 같은 버튼을 다시 눌러 주세요. 이미 환불됐다면 그대로 기록만 맞춰집니다.'
        ).toNextResponse()
      }
      if (outcome.reason === 'rejected') {
        log.warn('환불 거절', { reservationId: id, message: outcome.message })
        return ApiError.badRequest(
          `토스가 환불을 거절했습니다. (${outcome.message})`
        ).toNextResponse()
      }
      // 돈은 나갔는데 좌석·원장이 못 따라왔다. 손으로 고쳐야 하므로 시끄럽게 남긴다.
      logSecurityEvent(
        'TICKET_OFFICE_REFUND_LEDGER_FAILED',
        {
          reservationId: id,
          orderId: String(payment.order_id),
          refundAmount: plan.refundAmount,
        },
        'high'
      )
      log.error('환불 기록 실패 — 수동 처리 필요', {
        reservationId: id,
        refundAmount: plan.refundAmount,
      })
      return ApiError.internalServerError(
        '환불은 처리됐으나 예매 상태를 갱신하지 못했습니다. 즉시 사무국 담당자에게 알려 주세요.'
      ).toNextResponse()
    }

    // 기록은 기다린다 — 이 한 줄이 "누가 왜 남의 결제를 돌려줬는가"의 전부다.
    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'ticket_reservation_refunded',
        target_type: 'ticket_reservation',
        target_id: String(reservation.id),
        metadata: {
          action: 'office_refund',
          show_id: reservation.show_id ?? null,
          reservation_code: reservation.reservation_code ?? null,
          order_id: String(payment.order_id),
          refund_amount: outcome.refundAmount,
          // 관객이 스스로 할 수 없었던 이유를 되짚을 때 가장 먼저 보게 되는 값들.
          booker_kind: reservation.user_id ? 'member' : 'guest',
          total_amount: reservation.total_amount ?? null,
          partial: plan.isFullRefund === false,
          reason,
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (e) {
      logSecurityEvent(
        'TICKET_OFFICE_REFUND_AUDIT_FAILED',
        {
          reservationId: id,
          orderId: String(payment.order_id),
          error: e instanceof Error ? e.message : String(e),
        },
        'high'
      )
      log.error('사무국 예매 환불 기록 실패', e)
    }

    log.info('사무국 대리 예매 환불', {
      reservationId: id,
      actorId: maskId(auth.user.id),
      refundAmount: outcome.refundAmount,
    })

    return ApiSuccess.ok({
      refunded: true,
      refund_amount: outcome.refundAmount,
      partial: plan.isFullRefund === false,
      reservation_code: outcome.reservation.reservation_code ?? reservation.reservation_code,
      status: outcome.reservation.status,
    }).toNextResponse()
  } catch (error) {
    log.error('사무국 예매 환불 실패:', error)
    return ApiError.internalServerError('환불을 처리하지 못했습니다.').toNextResponse()
  }
}
