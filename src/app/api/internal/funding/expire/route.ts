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

import { listExpiredHolds, expirePledge, finalizePledgePayment } from '@/db/queries/fundingPledges'
import { getPaymentByOrderId } from '@/db/queries/payments'
import { lookupPayment, TossLookupError, TossApiError } from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { runExpiryGuard } from '@/lib/funding/expiryGuard'
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
        if (tossOrderId !== orderId || !Number.isFinite(tossTotalAmount) || tossTotalAmount !== expectedAmount) {
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
      const confirmed = await finalizePledgePayment({
        orderId: String(pledge.order_id),
        pledgeId: String(pledge.id),
        paymentKey: lookup.paymentKey,
        method: lookup.method ?? null,
        approvedAt: lookup.approvedAt ? new Date(lookup.approvedAt) : new Date(),
        raw: { promotedBy: 'expiry-guard' },
      })
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
