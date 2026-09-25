/**
 * 결제 단계에서 **돌아가기**를 눌렀을 때 그 선점을 놓아 줘도 되는가.
 *
 * DB도 네트워크도 모른다 — 원장 두 행(후원·결제)과 요청자가 들고 있는 값만 본다.
 *
 * ## 왜 놓아 줄 길이 필요한가
 *
 * 선점이 서면 화면이 결제창으로 넘어가고, 리워드를 잘못 골랐다는 것을
 * 그제서야 알아차려도 뒤로 가는 길이 없었다. 남는 선택은 창을 닫고 처음부터
 * 다시 하는 것뿐인데, 앞의 선점은 10분 동안 그대로 서 있다. 그렇게 세 번
 * 고쳐 고르면 한 신원의 선점 상한(`MAX_HOLDS_PER_REWARD`·
 * `MAX_OUTSTANDING_HOLDS`)에 자기 자신이 걸려 "먼저 결제를 마치라"는 말을
 * 듣는다 — 그 사람이 할 수 있는 일이 아무것도 없는 안내다.
 *
 * 놓아 준 선점은 상한 셈에서 곧바로 빠진다. 상한은 `pending`만 세기 때문이다
 * (`ownHoldCondition`).
 *
 * ## 누구에게 열리는가
 *
 * **결제가 잡힌 적 없는 `pending` 선점뿐이다.** 그 밖의 상태는 전부 거절한다 —
 * 결제가 붙은 건을 여기서 취소하면 돈이 나간 채 후원만 사라진다. 이미
 * 결제까지 간 건의 취소는 환불이 붙은 다른 문(`…/pledges/cancel`)이다.
 *
 * 임자 확인은 두 갈래다. 회원 선점은 **세션이 그 회원일 때만**. 비회원 선점은
 * 브라우저가 들고 있는 **주문번호(`order_id`)가 맞을 때만** — 그 값은 선점을
 * 만든 그 브라우저에만 돌아간 값이다. 회원 선점에도 주문번호를 함께 요구해,
 * 다른 후원의 ID를 찍어 보는 요청이 지나가지 않게 한다.
 *
 * ## "결제가 진행 중인가"를 무엇으로 보는가 — 원장의 `payment_key`다
 *
 * 후원 행의 `payment_id`는 **확정이 끝난 뒤에야** 채워진다
 * (`finalizePledgePaymentOnce`가 상태를 `paid`로 바꾸는 바로 그 UPDATE에서
 * 함께 쓴다). 그래서 `pending`인 후원의 `payment_id`는 언제나 비어 있고, 그
 * 값만 보는 검사는 아무것도 막지 못한다.
 *
 * 승인이 날아가고 있는 중임을 알려 주는 표식은 **결제 행의 `payment_key`**다.
 * 확정 라우트가 토스에 승인을 요청하기 **직전에** 새긴다
 * (`recordPaymentKey`). 즉 이 값이 서 있는 `pending` 후원은 "결제창에서
 * 승인 버튼까지 눌렀고 우리가 그 결과를 기다리는 중"이라는 뜻이다. 그 사이
 * 도착한 돌아가기 요청을 그대로 받아 선점을 취소하면, 승인은 났는데 확정할
 * 후원이 없어져 **돈이 나간 채 후원만 사라진다** — 만료 스윕이 토스를 보고
 * 판정할 기회도 함께 사라진다(스윕은 `pending`만 고른다).
 *
 * 그래서 두 표식 중 하나라도 서 있으면 놓아 주지 않고 "확인 중"으로 답한다.
 */

export type PledgeReleasePlan = { ok: true } | { ok: false; status: 404 | 409; message: string }

/**
 * 승인 결과를 기다리는 중인 건에 돌려주는 문장. 되돌릴 수 없는 취소보다
 * 기다림이 싸다. 라우트도 같은 문장을 쓴다 — 취소 트랜잭션이 같은 판정을 한
 * 번 더 하므로, 두 자리가 다른 말을 하면 같은 상황에 두 문장이 나간다.
 */
export const PLEDGE_RELEASE_IN_FLIGHT_MESSAGE =
  '결제 결과를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.'
const IN_FLIGHT_MESSAGE = PLEDGE_RELEASE_IN_FLIGHT_MESSAGE

/** 이 주문의 결제 행에 승인 요청 직전의 표식(`payment_key`)이 서 있는가. */
function paymentInFlight(payment: Record<string, unknown> | null): boolean {
  if (!payment) return false
  return typeof payment.payment_key === 'string' && payment.payment_key.length > 0
}

export function planPledgeRelease(
  pledge: Record<string, unknown> | null,
  actor: { userId: string | null; orderId: string },
  /** 같은 주문번호의 결제 원장 행. 없으면(아직 만들어지지 않았으면) `null`. */
  payment: Record<string, unknown> | null = null
): PledgeReleasePlan {
  // 없는 것과 남의 것을 구분하지 않는다 — 구분하면 ID를 찍어 보는 쪽에
  // 존재 여부가 샌다.
  if (!pledge) return { ok: false, status: 404, message: '후원 내역을 찾을 수 없습니다.' }
  if (typeof actor.orderId !== 'string' || actor.orderId.length === 0)
    return { ok: false, status: 404, message: '후원 내역을 찾을 수 없습니다.' }
  if (pledge.order_id !== actor.orderId)
    return { ok: false, status: 404, message: '후원 내역을 찾을 수 없습니다.' }

  const owner =
    typeof pledge.user_id === 'string' && pledge.user_id.length > 0 ? pledge.user_id : null
  if (owner !== null && owner !== actor.userId)
    return { ok: false, status: 404, message: '후원 내역을 찾을 수 없습니다.' }

  if (pledge.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      message:
        pledge.status === 'paid'
          ? '이미 결제가 끝난 후원입니다. 취소는 후원 내역 화면에서 해 주세요.'
          : '이미 정리된 결제 대기입니다. 처음부터 다시 골라 주세요.',
    }
  }

  // 승인이 날아가고 있는 중이다 — 머리 주석의 `payment_key` 절 참고. 여기서
  // 취소하면 돈이 나간 채 후원만 사라진다.
  if (paymentInFlight(payment)) {
    return { ok: false, status: 409, message: IN_FLIGHT_MESSAGE }
  }
  // 확정이 끝난 뒤에만 서는 표식이라 `pending`에서는 오늘 닿지 않지만, 닿았다면
  // 확정과 상태가 어긋난 건이다 — 그 역시 돈이 붙어 있다.
  if (typeof pledge.payment_id === 'string' && pledge.payment_id.length > 0) {
    return { ok: false, status: 409, message: IN_FLIGHT_MESSAGE }
  }
  return { ok: true }
}
