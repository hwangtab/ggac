/**
 * 매월 자동 청구의 **판단 로직**.
 *
 * DB와 토스를 전부 주입받는다 — 그래야 이중 청구가 나는 조건들을 네트워크
 * 없이 테스트로 고정할 수 있다(`scripts/testing/payments-billing-run.test.mjs`).
 * 실제 배선은 크론 라우트가 한다.
 *
 * 세 가지 규칙이 이 파일의 존재 이유다.
 *
 *  1. **이미 낸 사람은 건너뛴다.** 크론이 두 번 돌거나, 회원이 직접 결제한
 *     뒤 크론이 돌 수 있다.
 *  2. **판단할 수 없는 실패는 실패로 확정하지 않는다.** 청구가 나갔는지 모르는
 *     상태에서 실패로 적어 두면 다음 실행이 다시 청구해 이중 결제가 된다.
 *  3. **한 사람의 실패가 나머지를 막지 않는다.** 한 명 때문에 전체 청구가
 *     멈추면 그 달 회비를 못 걷는다.
 */

import { assertDuesAmount } from './toss/config.ts'
import { generateOrderId } from './toss/protocol.ts'

export interface BillingRunDeps {
  billingMonth: string
  listTargets: () => Promise<Record<string, unknown>[]>
  getDues: (userId: string, billingMonth: string) => Promise<Record<string, unknown> | null>
  ensureDues: (input: {
    userId: string
    billingMonth: string
    amount: number
  }) => Promise<Record<string, unknown>>
  createPendingPayment: (input: {
    orderId: string
    userId: string
    kind: 'dues'
    orderName: string
    amount: number
    payerName?: string | null
    payerEmail?: string | null
  }) => Promise<Record<string, unknown>>
  charge: (
    billingKey: string,
    input: {
      customerKey: string
      amount: number
      orderId: string
      orderName: string
      customerEmail?: string | null
      customerName?: string | null
    }
  ) => Promise<Record<string, unknown>>
  markPaymentDone: (
    orderId: string,
    patch: { paymentKey: string; method?: string | null; approvedAt: string; raw: unknown }
  ) => Promise<Record<string, unknown> | null>
  markPaymentFailed: (orderId: string, patch: { code: string; message: string }) => Promise<unknown>
  markDuesPaid: (input: {
    userId: string
    billingMonth: string
    paymentId: string
  }) => Promise<unknown>
  getPaymentByOrderId: (orderId: string) => Promise<Record<string, unknown> | null>
  notifyFailure: (input: {
    userId: string
    email?: string | null
    displayName?: string | null
    reason: string
  }) => Promise<unknown>
  log?: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

export interface BillingRunResult {
  charged: number
  failed: number
  skipped: number
  /** 청구됐는지 알 수 없어 다음 대사로 넘긴 건. */
  undecided: number
}

function monthLabel(billingMonth: string): string {
  const [year, month] = billingMonth.split('-')
  return `${year}년 ${Number(month)}월`
}

/** 판단 불가 오류인가. 클래스 대신 이름으로 본다 — 주입 테스트에서도 같게 동작해야 한다. */
function isUndecidable(error: unknown): boolean {
  return (error as { name?: string })?.name === 'TossLookupError'
}

export async function runBillingCharges(deps: BillingRunDeps): Promise<BillingRunResult> {
  const result: BillingRunResult = { charged: 0, failed: 0, skipped: 0, undecided: 0 }
  const targets = await deps.listTargets()

  for (const target of targets) {
    const userId = String(target.user_id)
    const billingKey = String(target.billing_key)
    const customerKey = String(target.customer_key)
    const amount = target.monthly_fee

    // 금액이 없거나 범위를 벗어나면 청구하지 않는다. 임의로 정해서 걸면
    // 회원이 동의한 적 없는 금액이 빠져나간다.
    try {
      assertDuesAmount(amount)
    } catch {
      deps.log?.warn?.('자동결제 건너뜀(회비 금액 이상)', { userId })
      result.skipped++
      continue
    }
    const dueAmount = amount as number

    const existing = await deps.getDues(userId, deps.billingMonth)
    if (existing?.status === 'paid') {
      result.skipped++
      continue
    }

    await deps.ensureDues({ userId, billingMonth: deps.billingMonth, amount: dueAmount })

    const orderId = generateOrderId('dues')
    const orderName = `경기아트콜렉티브 ${monthLabel(deps.billingMonth)} 조합비`

    await deps.createPendingPayment({
      orderId,
      userId,
      kind: 'dues',
      orderName,
      amount: dueAmount,
      payerName: (target.display_name as string) ?? null,
      payerEmail: (target.email as string) ?? null,
    })

    let approved: Record<string, unknown>
    try {
      approved = await deps.charge(billingKey, {
        customerKey,
        amount: dueAmount,
        orderId,
        orderName,
        customerEmail: (target.email as string) ?? null,
        customerName: (target.display_name as string) ?? null,
      })
    } catch (error) {
      if (isUndecidable(error)) {
        // 청구가 나갔는지 모른다. 대기 상태로 남겨 두면 대사가 실제 상태로 맞춘다.
        deps.log?.error?.('자동결제 판단 불가(대사 대기)', { userId, orderId })
        result.undecided++
        continue
      }

      const code = (error as { code?: string }).code ?? 'BILLING_FAILED'
      const message = error instanceof Error ? error.message : '자동결제에 실패했습니다.'
      await deps.markPaymentFailed(orderId, { code, message })
      await deps.notifyFailure({
        userId,
        email: (target.email as string) ?? null,
        displayName: (target.display_name as string) ?? null,
        reason: message,
      })
      deps.log?.warn?.('자동결제 실패', { userId, orderId, code })
      result.failed++
      continue
    }

    const approvedAt =
      typeof approved.approvedAt === 'string' ? approved.approvedAt : new Date().toISOString()
    await deps.markPaymentDone(orderId, {
      paymentKey: typeof approved.paymentKey === 'string' ? approved.paymentKey : orderId,
      method: typeof approved.method === 'string' ? approved.method : '카드',
      approvedAt,
      raw: approved,
    })

    const payment = await deps.getPaymentByOrderId(orderId)
    await deps.markDuesPaid({
      userId,
      billingMonth: deps.billingMonth,
      paymentId: String(payment?.id ?? ''),
    })
    result.charged++
  }

  return result
}
