/**
 * 정산 직전 **토스 대사**. 콘솔에서 나간 환불을 원장에 들여오는 자리다.
 *
 * ## 왜 필요한가
 *
 * 저장소에 토스 웹훅은 없다. 그래서 토스 콘솔에서 결제를 취소하면 돈은
 * 나가지만 `funding_pledges.status`는 `paid`로 남는다. 정산 셈은 원장만
 * 보므로(`computeSettlementBasis`), 이미 돌려준 돈까지 총 모금액으로 세고
 * 창작자에게 지급하라고 말한다. 사무국 대리 환불 라우트가 그 구멍을 좁혔지만
 * **콘솔로 가는 길을 막지는 못한다** — 막을 수 없는 길이라면, 지급액을 굳히기
 * 직전에 한 번 물어보는 것이 남은 방법이다.
 *
 * ## 언제, 무엇을
 *
 * 정산서를 만들거나 다시 정리하는 그 순간(`POST …/settlement`), 이 캠페인에서
 * 우리가 `paid`로 들고 있는 후원 전부에 대해 토스에 결제 상태를 묻는다.
 * 토스가 `CANCELED`·`PARTIAL_CANCELED`라고 답하면 **정산 셈을 하기 전에**
 * 원장을 환불로 맞추고(`finalizePledgeRefund`) 활동 기록을 남긴다.
 *
 * ## 조회는 몇 건씩 묶어서 — 한 줄로 세우면 라우트 수명을 넘긴다
 *
 * 조회는 후원 한 건에 왕복 한 번이다. 한 줄로 세우면 후원자가 200명인
 * 캠페인에서 왕복 200번이 그대로 더해져, 라우트가 제 수명(`maxDuration`)
 * 안에 끝내지 못한다. 끝내지 못하면 정산서는 저장되지 않고 사무국은 같은
 * 버튼을 계속 누른다 — 누를 때마다 200번을 다시 묻는다.
 *
 * 그래서 `RECONCILE_LOOKUP_CONCURRENCY`건씩 묶어 함께 묻는다. 한꺼번에 전부
 * 띄우지 않는 이유는 토스의 호출 한도이고, 이 정도면 한 묶음이 실패해도
 * 지금까지 아무것도 저장하지 않은 상태다 — **조회를 전부 끝낸 뒤에야 원장을
 * 건드린다.**
 *
 * ## 모르면 저장하지 않는다
 *
 * 한 건이라도 조회에 실패하면 **정산서를 저장하지 않는다**(라우트가 503).
 * "아마 안 바뀌었을 것"으로 넘기면 틀릴 수 있는 지급액이 기록으로 굳고, 그
 * 다음 화면은 그것을 사실로 읽는다. 없는 정산서가 틀린 정산서보다 낫다.
 *
 * 조회를 먼저 전부 끝내므로 **조회 단계의 실패는 원장을 한 줄도 건드리지
 * 않는다.** 판정이 끝난 뒤의 원장 쓰기가 중간에 실패하면 거기까지는 남는다 —
 * 그 값들은 이미 토스가 취소라고 답한 건이라 남아 있는 편이 맞고, 정산서 자체는
 * 여전히 저장되지 않는다.
 *
 * ## 트랜잭션은 토스 호출을 감싸지 않는다
 *
 * 이 파일에 `db.transaction`은 없다. 여는 것은 `finalizePledgeRefund` 하나이고
 * 그것은 해당 건의 토스 응답이 **돌아온 뒤에** 불린다 — 사무국 대리 환불
 * (`@/lib/server/officeRefund`)과 같은 불변식이다.
 */

import {
  finalizePledgeRefund,
  listPaidPledgePaymentsByCampaign,
} from '../../db/queries/fundingPledges.ts'
import { logUserActivity } from '../../db/queries/activities.ts'
import { lookupPayment as realLookupPayment } from '../payments/toss/client.ts'

/** 원장 `raw`와 활동 기록에 남는 사유. 사무국 대리 환불과 갈린다. */
export const TOSS_CONSOLE_REFUND_REASON = 'toss_console'

/** 토스가 "이 결제는 더 이상 살아 있지 않다"고 말하는 상태들. */
const CANCELED_STATUSES = new Set(['CANCELED', 'PARTIAL_CANCELED'])

/**
 * 한 번에 함께 묻는 결제 수.
 *
 * 5인 이유: 후원 300건짜리 캠페인이 왕복 1초짜리 조회로 60초를 넘기지 않으면서
 * (300 ÷ 5 = 60묶음), 토스 한도에 대해서는 여전히 얌전한 수다. 더 키워서 얻는
 * 시간보다 한도에 걸려 전부 503이 되는 쪽이 비싸다.
 */
export const RECONCILE_LOOKUP_CONCURRENCY = 5

/**
 * `limit`건씩 묶어 함께 돌린다. 묶음 안은 동시에, 묶음 사이는 차례로.
 *
 * 결과는 **입력 차례 그대로** 돌아온다 — 어느 후원이 먼저 실패했는가로
 * 사무국에게 말해 줄 후원번호가 정해지므로, 차례가 흔들리면 같은 상황에서
 * 매번 다른 번호가 나간다. 의존성을 하나 더 들이지 않는다.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const size = Math.max(1, Math.floor(limit))
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(item => fn(item)))))
  }
  return out
}

export interface PaidPledgePayment {
  pledge_id: string
  pledge_code: string
  payment_id: string
  payment_key: string
  order_id: string
  total_amount: number
}

export interface ReconcileDeps {
  listPaidPledgePayments: (campaignId: string) => Promise<PaidPledgePayment[]>
  lookupPayment: (paymentKey: string) => Promise<Record<string, unknown> | null>
  finalizePledgeRefund: typeof finalizePledgeRefund
  logActivity: (entry: Record<string, unknown>) => Promise<unknown>
}

export interface ReconciledPledge {
  pledge_id: string
  pledge_code: string
  amount: number
}

export type ReconcileResult =
  | { ok: true; checked: number; reconciled: ReconciledPledge[] }
  /**
   * 토스에 물어보지 못했거나 답을 읽지 못했다. **아무 판단도 하지 않는다** —
   * 라우트는 정산서를 저장하지 않고 503으로 답한다.
   */
  | { ok: false; reason: 'lookup'; pledge_code: string; message: string }
  /**
   * 토스는 취소됐다는데 그 금액이 후원 총액에 못 미친다(부분 환불). 이
   * 프로젝트의 원장은 전액 환불만 표현할 수 있으므로 자동으로 맞추지 않고
   * 사람을 부른다.
   */
  | { ok: false; reason: 'partial'; pledge_code: string; message: string }
  /** 토스 판정은 끝났는데 원장을 고치지 못했다. 역시 저장하지 않는다. */
  | { ok: false; reason: 'ledger'; pledge_code: string; message: string }

function wholeWon(value: unknown): number | null {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * 토스 응답에서 **실제로 취소된 금액**을 읽는다.
 *
 * `totalAmount - balanceAmount`가 정본이다(토스가 남은 금액을 직접 준다).
 * 그것을 읽지 못하면 취소 내역(`cancels[].cancelAmount`)의 합으로 되짚는다.
 * 둘 다 못 읽으면 `null` — 추정하지 않는다.
 */
export function canceledAmountOf(payment: Record<string, unknown>): number | null {
  const total = Number(payment.totalAmount)
  const balance = Number(payment.balanceAmount)
  if (Number.isSafeInteger(total) && Number.isSafeInteger(balance) && total - balance > 0) {
    return total - balance
  }
  const cancels = payment.cancels
  if (Array.isArray(cancels)) {
    const sum = cancels.reduce((acc: number, c: unknown) => {
      const amount = Number((c as { cancelAmount?: unknown })?.cancelAmount)
      return acc + (Number.isSafeInteger(amount) && amount > 0 ? amount : 0)
    }, 0)
    if (sum > 0) return sum
  }
  return null
}

const realDeps: ReconcileDeps = {
  listPaidPledgePayments: listPaidPledgePaymentsByCampaign,
  lookupPayment: key => realLookupPayment(key, { secretKey: '' }),
  finalizePledgeRefund,
  logActivity: entry => logUserActivity(entry as never),
}

/**
 * 이 캠페인의 `paid` 후원을 토스와 대조하고, 콘솔에서 취소된 건을 원장에
 * 환불로 들여온다. **정산 셈보다 먼저** 불려야 한다.
 */
export async function reconcileCampaignWithToss(
  input: { campaignId: string; secretKey: string; actorId: string },
  overrides?: Partial<ReconcileDeps>
): Promise<ReconcileResult> {
  const d: ReconcileDeps = {
    ...realDeps,
    lookupPayment: key => realLookupPayment(key, { secretKey: input.secretKey }),
    ...overrides,
  }

  const pledges = await d.listPaidPledgePayments(input.campaignId)
  const reconciled: ReconciledPledge[] = []

  // ① 조회. 묶음으로 함께 묻는다. 여기서는 **판정만** 하고 원장은 건드리지
  // 않는다 — 한 건이라도 못 읽으면 아무것도 바뀌지 않은 상태로 물러난다.
  const looked = await mapWithConcurrency(pledges, RECONCILE_LOOKUP_CONCURRENCY, async pledge => {
    try {
      return { ok: true as const, payment: await d.lookupPayment(pledge.payment_key) }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
    }
  })

  // ② 판정. 입력 차례대로 본다 — 실패를 말할 때 어느 후원인지가 매번 같아야 한다.
  const toRefund: { pledge: PaidPledgePayment; canceled: number }[] = []
  for (let i = 0; i < pledges.length; i += 1) {
    const pledge = pledges[i]
    const result = looked[i]
    if (result.ok === false) {
      return {
        ok: false,
        reason: 'lookup',
        pledge_code: pledge.pledge_code,
        message: result.message,
      }
    }
    const payment = result.payment
    // 토스가 모르는 결제. 우리 원장은 결제됐다고 말하는데 상대는 그런 결제가
    // 없다고 한다 — 자동으로 환불 처리할 근거가 아니다(금액도 알 수 없다).
    if (!payment) {
      return {
        ok: false,
        reason: 'lookup',
        pledge_code: pledge.pledge_code,
        message: '토스에 이 결제가 없습니다.',
      }
    }
    if (!CANCELED_STATUSES.has(String(payment.status))) continue

    const canceled = canceledAmountOf(payment)
    if (canceled === null) {
      return {
        ok: false,
        reason: 'lookup',
        pledge_code: pledge.pledge_code,
        message: '토스가 취소로 답했으나 취소 금액을 읽지 못했습니다.',
      }
    }
    if (canceled < pledge.total_amount) {
      return {
        ok: false,
        reason: 'partial',
        pledge_code: pledge.pledge_code,
        message: `토스에서 부분 취소된 결제입니다(후원 ${pledge.total_amount}원 / 취소 ${canceled}원). 이 화면에서는 맞출 수 없습니다.`,
      }
    }
    toRefund.push({ pledge, canceled })
  }

  // ③ 원장. 여기부터가 쓰기다 — 판정이 전부 끝난 뒤에만 들어온다.
  for (const { pledge, canceled } of toRefund) {
    let refunded: Record<string, unknown> | null = null
    try {
      refunded = await d.finalizePledgeRefund({
        orderId: pledge.order_id,
        paymentId: pledge.payment_id,
        pledgeId: pledge.pledge_id,
        canceledAmount: canceled,
        raw: { canceledBy: TOSS_CONSOLE_REFUND_REASON, reconciledBy: input.actorId },
      })
    } catch (error) {
      return {
        ok: false,
        reason: 'ledger',
        pledge_code: pledge.pledge_code,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    if (!refunded) {
      return {
        ok: false,
        reason: 'ledger',
        pledge_code: pledge.pledge_code,
        message: '원장 0행',
      }
    }

    // 기록은 기다린다 — 이 한 줄이 "왜 이 후원이 갑자기 환불로 바뀌었는가"의
    // 전부다. 실패해도 대사 자체는 이미 끝났으므로 멈추지 않는다.
    await d
      .logActivity({
        user_id: input.actorId,
        action_type: 'funding_pledge_canceled',
        target_type: 'funding_pledge',
        target_id: pledge.pledge_id,
        metadata: {
          action: 'settlement_toss_reconcile',
          campaign_id: input.campaignId,
          pledge_code: pledge.pledge_code,
          refund_amount: canceled,
          reason: TOSS_CONSOLE_REFUND_REASON,
        },
      })
      .catch(() => undefined)

    reconciled.push({
      pledge_id: pledge.pledge_id,
      pledge_code: pledge.pledge_code,
      amount: canceled,
    })
  }

  return { ok: true, checked: pledges.length, reconciled }
}
