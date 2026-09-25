/**
 * 만료 크론의 **판단**. DB와 토스를 주입받는다(`billingRun.ts`와 같은 이유).
 *
 * 선점이 만료된 후원을 그냥 지우면, 승인은 됐는데 confirm 라우트가 유실된
 * 건(브라우저가 닫힘, 함수 타임아웃)이 "돈은 나갔는데 후원은 만료"가 된다.
 * 그래서 만료 전에 토스를 먼저 본다.
 *
 * ## 답을 못 내는 행을 어떻게 다루는가
 *
 * 이 스윕은 유실된 승인을 구하는 **유일한** 장치다. 그래서 "한 건도 못 푸는
 * 행"이 창(최대 100건)을 채우면 새 건이 아예 눈에 띄지 않는다 — 안전망이 눈을
 * 감는다. 세 갈래로 나눠 그 일이 없게 한다.
 *
 * - **`mismatch`** — 토스가 말하는 결제가 *이 주문의 것이 아니다*(주문번호가
 *   다르다). 우리 주문으로 승인된 결제는 없다는 뜻이므로 다시 물어도 답은
 *   같다. 보류하지 않고 **만료**시켜 끝낸다. 이 갈래가 영구 정체의 주범이다.
 * - **`unknown`** — 토스를 못 봤거나(조회 실패), 주문번호는 맞는데 금액이
 *   어긋난다. 후자는 승인된 돈이 실제로 있을 수 있어 자동으로 정할 수 없다.
 *   보류한다.
 * - 보류가 오래 이어진 행은 `listStuckHolds`로 따로 세어 `reportStuck`으로
 *   넘긴다. 영영 `pending`으로 두면서 아무에게도 말하지 않는 것 자체가 고장이다.
 *
 * 목록의 차례는 쿼리가 정한다(늦게 만료된 것부터) — 정체된 행이 앞을 막지
 * 못하게 하는 것이 그 차례의 목적이다.
 */

type Row = Record<string, unknown>

export type PaymentLookup =
  | { status: string; paymentKey: string; method?: string; approvedAt?: string }
  | 'unknown'
  | 'mismatch'
  | 'not_found'

export interface ExpiryGuardResult {
  promoted: number
  expired: number
  deferred: number
  /** 남의 결제 식별자가 실려 있어 만료로 끝낸 건. */
  mismatched: number
  /** 하루 넘게 풀리지 않은 채 남아 있는 건. 사람이 봐야 한다. */
  stuck: number
}

export interface ExpiryGuardDeps {
  listExpiredHolds: () => Promise<Row[]>
  lookupPayment: (orderId: string) => Promise<PaymentLookup>
  promote: (
    pledge: Row,
    lookup: { status: string; paymentKey: string; method?: string; approvedAt?: string }
  ) => Promise<boolean>
  expire: (pledgeId: string) => Promise<boolean>
  /** 하루 넘게 `pending`으로 남은 선점. 없으면 이 점검을 건너뛴다. */
  listStuckHolds?: () => Promise<Row[]>
  /** 정체된 건을 사람에게 알린다. 여기서 던져도 스윕 결과를 바꾸지 않는다. */
  reportStuck?: (pledges: Row[]) => Promise<void> | void
}

export async function runExpiryGuard(deps: ExpiryGuardDeps): Promise<ExpiryGuardResult> {
  const result: ExpiryGuardResult = {
    promoted: 0,
    expired: 0,
    deferred: 0,
    mismatched: 0,
    stuck: 0,
  }
  const holds = await deps.listExpiredHolds()
  for (const pledge of holds) {
    try {
      const lookup = await deps.lookupPayment(String(pledge.order_id))
      if (lookup === 'unknown') {
        result.deferred++
        continue
      }
      // 우리 주문의 결제가 아니다 — 다시 물어도 같은 답이므로 보류하지 않는다.
      // 만료시키지 않으면 이 행이 다음 스윕의 창을 계속 먹는다.
      if (lookup === 'mismatch') {
        result.mismatched++
        if (await deps.expire(String(pledge.id))) result.expired++
        else result.deferred++
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

  if (deps.listStuckHolds) {
    try {
      const stuck = await deps.listStuckHolds()
      result.stuck = stuck.length
      if (stuck.length > 0 && deps.reportStuck) await deps.reportStuck(stuck)
    } catch {
      // 점검이 실패해도 정리 자체는 끝난 것으로 답한다.
    }
  }

  return result
}
