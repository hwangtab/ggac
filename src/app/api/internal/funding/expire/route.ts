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
      // 승인 응답이 유실된 건은 paymentKey를 모른다. 원장의 paymentKey가 없으면
      // 토스 주문번호 조회(`/v1/payments/orders/{orderId}`)가 필요한데 client.ts에
      // 그 함수가 없으므로 여기서는 payment_key가 있는 건만 조회한다.
      const payment = await getPaymentByOrderId(orderId)
      if (!payment?.payment_key) return 'not_found'
      try {
        const p = await lookupPayment(String(payment.payment_key), { secretKey })
        if (!p) return 'not_found'
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
