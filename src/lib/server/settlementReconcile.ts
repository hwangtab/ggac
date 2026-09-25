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
 * 캠페인 하나의 후원 수는 작으므로 순차 조회로 충분하다. 동시 호출로 토스의
 * 호출 한도를 건드리는 쪽이 더 나쁘다.
 *
 * ## 모르면 저장하지 않는다
 *
 * 한 건이라도 조회에 실패하면 **정산서를 저장하지 않는다**(라우트가 503).
 * "아마 안 바뀌었을 것"으로 넘기면 틀릴 수 있는 지급액이 기록으로 굳고, 그
 * 다음 화면은 그것을 사실로 읽는다. 없는 정산서가 틀린 정산서보다 낫다.
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

  for (const pledge of pledges) {
    let payment: Record<string, unknown> | null
    try {
      payment = await d.lookupPayment(pledge.payment_key)
    } catch (error) {
      return {
        ok: false,
        reason: 'lookup',
        pledge_code: pledge.pledge_code,
        message: error instanceof Error ? error.message : String(error),
      }
    }
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
