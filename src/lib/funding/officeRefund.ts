/**
 * 사무국 대리 환불이 **무엇을 받아들이는가**의 정본. DB도 네트워크도 모른다.
 *
 * ## 후원자가 못 하는 것 중 사무국이 할 수 있는 것
 *
 * 후원자 본인 취소(`src/app/api/funding/pledges/cancel/route.ts`)는 세 조건을
 * 모두 만족할 때만 열린다 — 캠페인이 `active`이고, 이행이 `none`이고, 본인
 * 확인이 되는 후원. 약관 제4조가 정한 **자동** 취소의 범위다.
 *
 * 사무국은 그 셋을 전부 넘어선다. 마감된 캠페인도, 정산까지 끝난 캠페인도,
 * 발송 완료로 표시된 후원도 환불할 수 있다. 그래야 하는 이유는 하나다 —
 * **오늘 그 자리에 있는 유일한 대안이 토스 콘솔이기 때문이다.** 콘솔에서
 * 환불하면 돈은 나가지만 `funding_pledges.status`는 `paid`로 남고, 정산은
 * 이미 돌려준 돈까지 창작자에게 지급하라고 말한다. 원장이 모르는 환불을
 * 만들지 않는 것이 이 기능의 존재 이유이므로, "여기서 막으면 콘솔로 간다"가
 * 곧 "여기서 막지 않는다"의 근거가 된다.
 *
 * ## 그래서 어디에 선을 긋는가
 *
 * 막는 것은 **돈이 실제로 잡힌 적 없는 후원**뿐이다. `pending`·`expired`,
 * 결제 연결이 없는 `canceled`, 이미 끝난 `refunded`. 이것들은 환불할 돈이
 * 애초에 없다 — 여기서 통과시키면 토스에 없는 결제의 취소를 요청하게 된다.
 *
 * 그리고 **지급까지 끝난 정산서가 있는 캠페인**은 한 번 더 확인을 받는다
 * (`needs_settled_ack`). 막지는 않는다 — 후원자에게 돌려줄 돈은 창작자에게
 * 이미 보냈는지와 무관하게 돌려줘야 한다. 다만 그 환불은 **조합이 창작자에게
 * 되돌려 받아야 하는 돈**을 만들고, 그 사실은 버튼을 누르기 전에 화면에
 * 적혀야 한다. 정산 라우트의 `acknowledge_no_account`와 같은 모양이다.
 *
 * ## 사유는 빈칸일 수 없다
 *
 * 환불은 되돌릴 수 없고 진짜 돈을 옮긴다. 누가 왜 눌렀는지가 남지 않으면
 * 남는 것은 "사무국이 환불했다"는 문장뿐이고, 그것은 기록이 아니다.
 */

/** 사유의 길이. 아래 한계는 활동 기록에 그대로 실린다. */
export const OFFICE_REFUND_REASON_MIN = 10
export const OFFICE_REFUND_REASON_MAX = 500

export type OfficeRefundBlock =
  | 'not_captured'
  | 'already_refunded'
  | 'no_payment'
  | 'amount_mismatch'

export type OfficeRefundPlan =
  | {
      ok: true
      /**
       * 앞선 요청이 선점(`paid → canceled`)까지 마치고 토스 응답을 판단하지
       * 못한 채 끝난 건. 후원자 취소 라우트와 같은 판정이며, 같은 이유로 선점
       * 단계를 건너뛰고 환불 요청부터 다시 시작한다.
       */
      retry: boolean
      /** 환불할 금액(원). 원장의 결제 금액이지 브라우저가 보낸 값이 아니다. */
      amount: number
    }
  | { ok: false; reason: OfficeRefundBlock; message: string }

function wholeWon(value: unknown): number | null {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * 이 후원을 사무국이 환불할 수 있는가. 판정에 쓰는 것은 원장 두 행뿐이다.
 *
 * 캠페인 상태도 이행 상태도 **보지 않는다** — 위 주석의 선이 그것이다. 무엇을
 * 넘어서는지는 화면이 사무국에게 말해 주고(발송 완료 건입니다, 정산이 끝난
 * 캠페인입니다), 넘어설지는 사람이 정한다.
 */
export function planOfficeRefund(
  pledge: Record<string, unknown> | null,
  payment: Record<string, unknown> | null
): OfficeRefundPlan {
  if (!pledge) {
    return { ok: false, reason: 'not_captured', message: '후원 내역을 찾을 수 없습니다.' }
  }
  if (pledge.status === 'refunded') {
    return { ok: false, reason: 'already_refunded', message: '이미 환불된 후원입니다.' }
  }
  const hasPayment = typeof pledge.payment_id === 'string' && pledge.payment_id.length > 0
  const retry = pledge.status === 'canceled' && hasPayment
  if (pledge.status !== 'paid' && retry === false) {
    return {
      ok: false,
      reason: 'not_captured',
      message: '결제가 잡힌 적 없는 후원입니다. 환불할 금액이 없습니다.',
    }
  }
  if (!payment || typeof payment.payment_key !== 'string' || payment.payment_key.length === 0) {
    return {
      ok: false,
      reason: 'no_payment',
      message: '결제 정보를 확인할 수 없습니다. 토스 거래 내역을 먼저 확인해 주세요.',
    }
  }
  const amount = wholeWon(payment.amount)
  if (amount === null) {
    return {
      ok: false,
      reason: 'amount_mismatch',
      message: '결제 금액을 읽지 못했습니다.',
    }
  }
  // 이 프로젝트의 환불은 전액뿐이다(`finalizePledgeRefund`). 결제 금액이 후원
  // 총액에 못 미치면 원장 쪽에서 시끄럽게 거부되므로, 토스를 부르기 **전에**
  // 여기서 먼저 막는다 — 나간 뒤에 거부되면 돈만 나가고 기록이 남지 않는다.
  const total = wholeWon(pledge.total_amount)
  if (total !== null && amount < total) {
    return {
      ok: false,
      reason: 'amount_mismatch',
      message: '결제 금액이 후원 금액보다 적습니다. 부분 환불은 이 화면에서 처리할 수 없습니다.',
    }
  }
  return { ok: true, retry, amount }
}

/** 사무국이 적은 사유. 다듬은 문자열을 돌려주고, 모자라면 null이다. */
export function normalizeOfficeRefundReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < OFFICE_REFUND_REASON_MIN) return null
  return trimmed.slice(0, OFFICE_REFUND_REASON_MAX)
}

/**
 * 이 캠페인은 지급이 끝났는가 — 그렇다면 확인을 한 번 더 받는다.
 *
 * `settlement`는 정산서 행(없으면 null). 지급 전(`pending`) 정산서는 환불이
 * 들어오면 `is_stale`로 표시되어 다시 정리하면 그만이므로 확인을 받지 않는다.
 */
export function officeRefundNeedsSettledAck(settlement: Record<string, unknown> | null): boolean {
  return settlement !== null && settlement.status === 'paid'
}
