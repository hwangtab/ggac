/**
 * 만료된 좌석 선점 정리 (크론 전용, 10분마다).
 *
 * 후원 만료 크론(`/api/internal/funding/expire`)과 같은 일을 예매에 한다.
 * 판단은 `src/lib/funding/expiryGuard.ts`의 `runExpiryGuard`가 하고 — 그 함수는
 * 후원을 모른다. 행과 조회·승격·만료 함수만 받는다 — 여기는 배선만 한다.
 *
 * 왜 필요한가. 확정 라우트(`/api/tickets/confirm`)가 토스 승인을 받고 좌석을
 * 확정하기까지 사이에 브라우저가 닫히거나 함수가 죽으면, 카드는 긁혔는데 예매는
 * `pending`으로 남아 10분 뒤 재고에서 빠진다. 그 뒤로는 아무도 그 결제를 보지
 * 않는다. 이 스윕이 그 유일한 안전망이다 — 만료시키기 **전에** 토스에 물어,
 * 승인이 있으면 만료 대신 확정한다.
 *
 * 세 가지를 한 번에 한다.
 *
 *  1. 결제 식별자가 새겨진 만료 선점은 한 건씩 토스에 물어 확정하거나 만료한다.
 *  2. 결제를 시작한 적조차 없는 만료 선점은 한 문장으로 정리한다
 *     (`expireStaleHolds`). 이쪽은 물어볼 것이 없다.
 *  3. 하루가 지나도 풀리지 않은 선점은 사람에게 알린다.
 *
 * 인증은 후원 크론과 같다: `CRON_SECRET` Bearer, 없으면 닫는다.
 */
import { NextRequest, after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { getPaymentByOrderId, markPaymentFailed } from '@/db/queries/payments'
import {
  listExpiredHolds,
  listStuckHolds,
  expireReservation,
  expireStaleHolds,
  finalizeTicketPayment,
  cancelReservation,
} from '@/db/queries/ticketing'
import { cancelPayment } from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { runExpiryGuard } from '@/lib/funding/expiryGuard'
import { createOrderPaymentLookup } from '@/lib/payments/orderLookup'
import { notifyStuckPayments } from '@/lib/payments/notifyStuck'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/internal/tickets/expire')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 창이 가득 찬 최악의 경우 조회 100회(≈30초)에 환불 몇 건. 후원 크론과 같게 둔다. */
export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  const expected = [process.env.CRON_SECRET].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  if (expected.length === 0) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  return expected.some(
    t => provided.length === t.length && timingSafeEqual(Buffer.from(provided), Buffer.from(t))
  )
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) return ApiError.unauthorized('권한이 없습니다.').toNextResponse()
  if (!isPaymentEnabled()) return ApiSuccess.ok({ skipped: 'payment_disabled' }).toNextResponse()

  const { secretKey } = getServerPaymentConfig()
  let stuckToReport: { count: number; orderIds: string[] } | null = null

  const result = await runExpiryGuard({
    listExpiredHolds: () => listExpiredHolds(),
    lookupPayment: createOrderPaymentLookup({ secretKey, getPaymentByOrderId, log }),
    promote: async (reservation, lookup) => {
      const orderId = String(reservation.order_id)
      const reservationId = String(reservation.id)
      const confirmed = await finalizeTicketPayment({
        orderId,
        reservationId,
        paymentKey: lookup.paymentKey,
        method: lookup.method ?? null,
        approvedAt: lookup.approvedAt ? new Date(lookup.approvedAt) : new Date(),
        raw: { promotedBy: 'ticket-expiry-guard' },
      })
      if (confirmed) {
        log.warn('유실된 승인을 크론이 확정', { orderId, reservationId })
        return true
      }

      // 승인은 났는데 앉힐 자리가 없다 — 선점이 만료된 사이에 마지막 좌석이
      // 다른 관객에게 팔렸다. 돈만 받고 표를 못 주는 것이 최악이므로 즉시
      // 전액 환불하고, 선점을 정리해 이 행이 다음 스윕에 다시 걸리지 않게 한다.
      let refunded = true
      try {
        await cancelPayment(
          lookup.paymentKey,
          { cancelReason: '좌석 확정 불가 — 전액 환불', orderId },
          { secretKey }
        )
      } catch (refundError) {
        // **환불이 안 나갔다가 아니라 나갔는지 모른다**이다. 같은 결제의 취소가
        // 겹치거나 응답이 유실돼도 여기로 온다. 사람이 확인해야 한다.
        refunded = false
        log.error('크론 자동 환불 결과 불확실 — 사람이 확인 필요', {
          orderId,
          reservationId,
          error: refundError instanceof Error ? refundError.message : refundError,
        })
      }
      await cancelReservation(reservationId, { expectedOrderId: orderId })
      await markPaymentFailed(orderId, {
        code: 'SEAT_UNAVAILABLE',
        message: refunded
          ? '좌석을 확정할 수 없어 승인된 결제를 전액 환불했습니다.'
          : '좌석을 확정할 수 없어 환불을 요청했으나 결과를 확인하지 못했습니다. 환불 여부를 사람이 확인해야 합니다.',
      })
      log.error('크론 승격 불가 — 승인 후 환불', { orderId, reservationId, refunded })
      return false
    },
    expire: expireReservation,
    listStuckHolds: () => listStuckHolds(),
    reportStuck: reservations => {
      const ids = reservations.slice(0, 20).map(r => String(r.order_id ?? r.id))
      log.error('하루 넘게 풀리지 않은 좌석 선점 — 손으로 확인 필요', {
        count: reservations.length,
        orderIds: ids,
      })
      logSecurityEvent(
        'TICKET_STUCK_PENDING_HOLDS',
        { count: reservations.length, orderIds: ids },
        'high'
      )
      stuckToReport = { count: reservations.length, orderIds: ids }
    },
  })

  // 결제를 시작한 적 없는 선점은 물어볼 것이 없다. 위 스윕이 건드리지 않으므로
  // (원장에 결제 식별자가 있는 행만 판정한다) 여기서 한 문장으로 정리한다.
  let reclaimed = 0
  try {
    reclaimed = await expireStaleHolds()
  } catch (error) {
    log.error('버려진 선점 정리 실패', { error })
  }

  if (stuckToReport) {
    const stuck = stuckToReport as { count: number; orderIds: string[] }
    after(() =>
      notifyStuckPayments({
        kind: 'ticket_stuck_holds',
        label: '예매',
        action:
          '토스 거래 내역에서 주문번호를 확인해, 승인된 건은 좌석을 확정하거나 환불하고 승인되지 않은 건은 만료 처리해 주세요.',
        count: stuck.count,
        orderIds: stuck.orderIds,
      }).catch(e => log.error('정체 선점 알림 실패', e))
    )
  }

  log.info('예매 선점 정리', { ...result, reclaimed })
  return ApiSuccess.ok({ ...result, reclaimed }).toNextResponse()
}

export const GET = handle
export const POST = handle
