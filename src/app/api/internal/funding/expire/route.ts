/**
 * 만료된 후원 선점 정리 (크론 전용, 10분마다).
 *
 * 판단은 `expiryGuard.ts`, 여기는 배선만. 만료 전에 토스를 먼저 본다 — 승인은
 * 됐는데 confirm이 유실된 건을 만료 대신 확정한다.
 *
 * 인증은 업로드 정리 크론과 같다: `CRON_SECRET` Bearer, 없으면 닫는다.
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  listExpiredHolds,
  expirePledge,
  finalizePledgePayment,
  cancelPendingPledge,
  PledgeStockUnavailableError,
} from '@/db/queries/fundingPledges'
import { getPaymentByOrderId, markPaymentFailed } from '@/db/queries/payments'
import {
  cancelPayment,
  lookupPayment,
  TossLookupError,
  TossApiError,
} from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { runExpiryGuard } from '@/lib/funding/expiryGuard'
import { notifyPledgeRefunded } from '@/lib/funding/notify'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/funding/expire')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
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
  const result = await runExpiryGuard({
    listExpiredHolds: () => listExpiredHolds(),
    lookupPayment: async orderId => {
      // confirm 라우트가 승인 호출 *전에* `recordPaymentKey`로 식별자를 이미
      // 새긴다(대기 상태인 행에만). 그래서 원장에 payment_key가 없다는 것은
      // "승인 응답이 유실됐다"가 아니라 "승인 요청 자체가 나간 적이 없다"는
      // 뜻이다 — 이 경우엔 조회할 결제가 토스에도 없으므로 `not_found`로
      // 답하고 그대로 만료시키는 것이 맞다. payment_key가 있는데 confirm이
      // 유실된 건만 이 아래에서 실제로 조회한다.
      const payment = await getPaymentByOrderId(orderId)
      if (!payment?.payment_key) return 'not_found'
      try {
        const p = await lookupPayment(String(payment.payment_key), { secretKey })
        if (!p) return 'not_found'
        // 대기 상태인 원장 행의 payment_key는 confirm 라우트가 승인 호출
        // *전에* 클라이언트가 보낸 값을 그대로 새긴 것이다(유실된 승인을
        // 구하기 위한 조치) — 즉 검증된 승인에서 나왔다는 보장이 없다.
        // 자신의 대기 후원에 남의 이미 승인된 결제의 paymentKey를 실어
        // 보내면, confirm의 토스 승인 호출은 "이미 처리됨"으로 실패해
        // 정리되는 게 정상이지만 그 요청이 도중에 죽으면(타임아웃·인스턴스
        // 종료) payment_key가 대기 행에 남는다. 다음 스윕이 이걸 그대로
        // 승격시키면 남의 결제를 자기 후원으로 가로챈다. 그래서 토스가
        // 말하는 결제가 *이 주문의 결제가 맞는지*를 승격 전에 반드시
        // 확인한다 — 주문번호와 금액이 우리 원장과 일치해야만 믿는다.
        const tossOrderId = typeof p.orderId === 'string' ? p.orderId : null
        const tossTotalAmount = Number(p.totalAmount)
        const expectedAmount = Number(payment.amount)
        if (
          tossOrderId !== orderId ||
          !Number.isFinite(tossTotalAmount) ||
          tossTotalAmount !== expectedAmount
        ) {
          log.error('스윕 대상 결제가 이 주문의 것이 아님 — 승격·만료 모두 보류', {
            orderId,
            paymentKey: payment.payment_key,
            expectedOrderId: orderId,
            receivedOrderId: tossOrderId,
            expectedAmount,
            receivedAmount: tossTotalAmount,
          })
          return 'unknown'
        }
        return {
          status: String(p.status),
          paymentKey: String(p.paymentKey),
          method: typeof p.method === 'string' ? p.method : undefined,
          approvedAt: typeof p.approvedAt === 'string' ? p.approvedAt : undefined,
        }
      } catch (error) {
        if (error instanceof TossLookupError) return 'unknown'
        if (error instanceof TossApiError && error.status === 404) return 'not_found'
        throw error
      }
    },
    promote: async (pledge, lookup) => {
      const orderId = String(pledge.order_id)
      const pledgeId = String(pledge.id)
      let confirmed
      try {
        confirmed = await finalizePledgePayment({
          orderId,
          pledgeId,
          paymentKey: lookup.paymentKey,
          method: lookup.method ?? null,
          approvedAt: lookup.approvedAt ? new Date(lookup.approvedAt) : new Date(),
          raw: { promotedBy: 'expiry-guard' },
        })
      } catch (error) {
        // 승인은 났는데 승격할 자리가 없다. 이 경로는 승인 열 시간이 지나
        // 도착하므로 그사이 마지막 수량이 팔렸거나 프로젝트가 마감됐을 수
        // 있다 — 확정 트랜잭션이 그걸 보고 거절한다. 여기서 그냥 미뤄 두면
        // 후원자는 돈만 낸 채 남는다. 확정 라우트와 같은 처리를 한다:
        // 전액 환불 → 선점 정리 → 원장에 사유 기록.
        if (error instanceof PledgeStockUnavailableError) {
          let refunded = true
          try {
            await cancelPayment(
              lookup.paymentKey,
              { cancelReason: '후원 확정 불가 — 전액 환불', orderId },
              { secretKey }
            )
          } catch (refundError) {
            refunded = false
            log.error('크론 자동 환불 실패 — 수동 처리 필요', {
              orderId,
              pledgeId,
              error: refundError instanceof Error ? refundError.message : refundError,
            })
          }
          await cancelPendingPledge(pledgeId, orderId)
          await markPaymentFailed(orderId, {
            code: error.reason === 'campaign_closed' ? 'CAMPAIGN_CLOSED' : 'REWARD_SOLD_OUT',
            message: refunded
              ? '후원을 확정할 자리가 없어 승인된 결제를 전액 환불했습니다.'
              : '후원을 확정할 자리가 없으나 자동 환불에 실패했습니다. 수동 환불이 필요합니다.',
          })
          log.error('크론 승격 불가 — 승인 후 환불', {
            orderId,
            pledgeId,
            reason: error.reason,
            refunded,
          })
          // 돈이 빠져나갔다가 돌아온 사람에게 이유를 알린다. 지금까지 이
          // 경로는 아무에게도 말하지 않았다 — 결제되고 환불된 것만 통장에
          // 남는다. 자동 환불이 실패한 건은 보내지 않는다: 문장이 "전액
          // 환불했습니다"라 아직 사실이 아니고, 그 건은 위 로그를 보고
          // 사무국이 손으로 처리한 뒤 알린다. 알림 실패가 크론을 멈추지
          // 않도록 여기서도 삼킨다.
          if (refunded) {
            await notifyPledgeRefunded(
              pledge,
              error.reason === 'campaign_closed' ? 'campaign_closed' : 'reward_sold_out'
            ).catch(e => log.error('환불 알림 실패', { orderId, e }))
          }
          return false
        }
        throw error
      }
      if (confirmed) log.warn('유실된 승인을 크론이 확정', { orderId: pledge.order_id })
      return Boolean(confirmed)
    },
    expire: expirePledge,
  })

  log.info('후원 만료 정리', result)
  return ApiSuccess.ok(result).toNextResponse()
}

export const GET = handle
export const POST = handle
