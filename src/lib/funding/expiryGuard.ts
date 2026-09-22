/**
 * 만료 크론의 **판단**. DB와 토스를 주입받는다(`billingRun.ts`와 같은 이유).
 *
 * 선점이 만료된 후원을 그냥 지우면, 승인은 됐는데 confirm 라우트가 유실된
 * 건(브라우저가 닫힘, 함수 타임아웃)이 "돈은 나갔는데 후원은 만료"가 된다.
 * 그래서 만료 전에 토스를 먼저 본다.
 */

type Row = Record<string, unknown>

export type PaymentLookup =
  | { status: string; paymentKey: string; method?: string; approvedAt?: string }
  | 'unknown'
  | 'not_found'

export interface ExpiryGuardDeps {
  listExpiredHolds: () => Promise<Row[]>
  lookupPayment: (orderId: string) => Promise<PaymentLookup>
  promote: (pledge: Row, lookup: { status: string; paymentKey: string; method?: string; approvedAt?: string }) => Promise<boolean>
  expire: (pledgeId: string) => Promise<boolean>
}

export async function runExpiryGuard(
  deps: ExpiryGuardDeps
): Promise<{ promoted: number; expired: number; deferred: number }> {
  const result = { promoted: 0, expired: 0, deferred: 0 }
  const holds = await deps.listExpiredHolds()
  for (const pledge of holds) {
    try {
      const lookup = await deps.lookupPayment(String(pledge.order_id))
      if (lookup === 'unknown') {
        result.deferred++
        continue
      }
      if (lookup !== 'not_found' && lookup.status === 'DONE') {
        const ok = await deps.promote(pledge, lookup)
        if (ok) result.promoted++
        else result.deferred++
        continue
      }
      if (await deps.expire(String(pledge.id))) result.expired++
      else result.deferred++
    } catch {
      result.deferred++
    }
  }
  return result
}
