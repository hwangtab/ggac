/**
 * 조합비 결제 대사 (크론 전용, 10분마다).
 *
 * 예매·후원 만료 크론과 같은 일을 조합비에 한다. 판단은
 * `src/lib/funding/expiryGuard.ts`의 `runExpiryGuard`가 하고 — 그 함수는 후원을
 * 모른다. 행과 조회·승격·만료 함수만 받는다 — 여기는 배선만 한다.
 *
 * 왜 필요한가. 확정 라우트(`/api/payments/dues/confirm`)는 토스가 "승인됐는지
 * 모른다"(`TossLookupError`)고 답하면 **실패로 적지 않고** 물러난다. 실패로
 * 적으면 실제로 승인된 회비가 미납으로 남기 때문이다. 그 자리에서 "대사가
 * 나중에 맞춘다"고 말해 왔는데, 정작 그 대사가 없었다 — 회비는 영영 `pending`
 * 으로 남고, 다음 달 자동청구가 그 달을 다시 걷는다.
 *
 * 승인이 확인되면 납부까지 연결하고(`markDuesPaid`), 승인이 없으면 실패로
 * 끝내 회원이 다시 낼 수 있게 한다. 판단이 안 서는 건은 **그대로 둔다** —
 * 하루가 지나면 사람에게 알린다.
 *
 * 인증은 다른 내부 크론과 같다: `CRON_SECRET` Bearer, 없으면 닫는다.
 */
import { NextRequest, after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  getPaymentByOrderId,
  listStalePendingPayments,
  listStuckPendingPayments,
  markPaymentDone,
  markPaymentFailed,
  markDuesPaid,
} from '@/db/queries/payments'
import {
  currentBillingMonth,
  getServerPaymentConfig,
  isPaymentEnabled,
} from '@/lib/payments/toss/config'
import { runExpiryGuard } from '@/lib/funding/expiryGuard'
import { createOrderPaymentLookup } from '@/lib/payments/orderLookup'
import { notifyStuckPayments } from '@/lib/payments/notifyStuck'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/internal/dues/expire')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 결제창을 열어 둔 사람을 대사가 앞질러 끝내면 안 된다. 토스 결제 인증
 * 유효시간(10분)에 승인 왕복(최대 60초)을 더한 만큼은 두고 본다.
 */
const SETTLE_GRACE_MS = 15 * 60_000

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
  // 스윕은 행의 `id`로 만료를 부르는데, 결제 원장의 갱신 열쇠는 주문번호다.
  // 목록을 만들면서 짝을 기억해 둔다.
  const orderById = new Map<string, string>()
  let stuckToReport: { count: number; orderIds: string[] } | null = null

  const result = await runExpiryGuard({
    listExpiredHolds: async () => {
      const rows = await listStalePendingPayments({
        kind: 'dues',
        olderThanMs: SETTLE_GRACE_MS,
      })
      for (const row of rows) orderById.set(String(row.id), String(row.order_id))
      return rows
    },
    lookupPayment: createOrderPaymentLookup({ secretKey, getPaymentByOrderId, log }),
    promote: async (payment, lookup) => {
      const orderId = String(payment.order_id)
      const userId = payment.user_id ? String(payment.user_id) : ''
      const done = await markPaymentDone(orderId, {
        paymentKey: lookup.paymentKey,
        method: lookup.method ?? null,
        approvedAt: lookup.approvedAt ?? new Date().toISOString(),
        raw: { promotedBy: 'dues-reconcile' },
      })
      if (done?.status !== 'done') return false

      // 청구월은 **주문을 만든 때**로 본다. 대사는 며칠 뒤에 돌 수도 있어서
      // 지금 달로 적으면 회원이 낸 달이 아닌 달이 납부로 바뀐다.
      if (userId) {
        try {
          await markDuesPaid({
            userId,
            billingMonth: currentBillingMonth(new Date(String(payment.created_at))),
            paymentId: String(done.id ?? payment.id),
          })
        } catch (error) {
          log.error('회비 납부 연결 실패(결제는 확정됨)', { orderId, error })
        }
      }
      log.warn('유실된 조합비 승인을 크론이 확정', { orderId, userId: maskId(userId) })
      return true
    },
    expire: async id => {
      const orderId = orderById.get(id)
      if (!orderId) return false
      const failed = await markPaymentFailed(orderId, {
        code: 'RECONCILED_NOT_APPROVED',
        message: '대사 결과 승인된 결제가 없어 실패로 정리했습니다.',
      })
      return failed?.status === 'failed'
    },
    listStuckHolds: () => listStuckPendingPayments({ kind: 'dues' }),
    reportStuck: rows => {
      const ids = rows.slice(0, 20).map(r => String(r.order_id))
      log.error('하루 넘게 풀리지 않은 조합비 결제 — 손으로 확인 필요', {
        count: rows.length,
        orderIds: ids,
      })
      logSecurityEvent('DUES_STUCK_PENDING_PAYMENTS', { count: rows.length, orderIds: ids }, 'high')
      stuckToReport = { count: rows.length, orderIds: ids }
    },
  })

  if (stuckToReport) {
    const stuck = stuckToReport as { count: number; orderIds: string[] }
    after(() =>
      notifyStuckPayments({
        kind: 'dues_stuck_payments',
        label: '조합비',
        action:
          '토스 거래 내역에서 주문번호를 확인해, 승인된 건은 납부로 처리하고 승인되지 않은 건은 실패로 정리해 주세요.',
        count: stuck.count,
        orderIds: stuck.orderIds,
      }).catch(e => log.error('정체 조합비 결제 알림 실패', e))
    )
  }

  log.info('조합비 결제 대사', result)
  return ApiSuccess.ok(result).toNextResponse()
}

export const GET = handle
export const POST = handle
