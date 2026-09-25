/**
 * 사무국 대리 환불의 **실행 순서**. 후원자 취소 라우트와 같은 기계를 쓴다.
 *
 * ## 환불기를 두 벌 만들지 않는다
 *
 * 돈을 돌려주는 코드가 저장소에 둘이 되면, 다음에 토스 응답 처리 하나를
 * 고칠 때 한쪽만 고친다. 그래서 여기서 새로 만드는 것은 아무것도 없다 —
 * 선점(`claimPledgeForCancel`), 토스 취소(`cancelPayment`), 원장 확정
 * (`finalizePledgeRefund`), 되돌리기(`revertPledgeCancel`) 전부 후원자 취소가
 * 이미 쓰는 함수다. 이 파일이 하는 일은 **그 넷을 같은 순서로 부르는 것**과,
 * 라우트가 답할 수 있도록 결과를 갈래로 돌려주는 것뿐이다.
 *
 * 후원자 취소와 다른 점은 둘이다.
 * ① 선점에 `requireFulfillmentNone`을 걸지 않는다 — 발송 완료로 표시된 후원도
 *    사무국은 환불할 수 있다(`@/lib/funding/officeRefund`의 선 참고).
 * ② 취소 사유 문자열이 다르다. 토스 거래 내역에서 누가 눌렀는지 갈린다.
 *
 * ## 트랜잭션은 토스 호출을 건너뛰지 않는다
 *
 * 이 파일에 `db.transaction`은 없다. 여는 것은 `finalizePledgeRefund` 하나이고,
 * 그것은 **토스 응답이 돌아온 뒤에** 불린다. 선점은 단일 UPDATE라 트랜잭션을
 * 열지 않는다. 그래서 네트워크 왕복이 DB 쓰기 잠금을 붙들고 있는 구간이
 * 없다 — `scripts/testing/fundingOfficeRemedy.test.mjs`가 이 파일의 소스에서
 * 직접 확인한다.
 *
 * ## 부분 실패는 완료로 기록하지 않는다
 *
 * 토스가 판단 불가(`TossLookupError`)로 끝나면 후원은 `canceled`로 남고
 * `refunded`가 되지 않는다. 그 상태는 **다시 이 함수를 부르면** 선점을
 * 건너뛰고 환불 요청부터 재시도한다(`retry`). 토스가 실제로는 환불했었다면
 * 클라이언트가 `ALREADY_CANCELED_PAYMENT`를 성공으로 바꿔 주므로 재시도가
 * 끝까지 간다. 토스가 **거절**하면 선점을 되돌려 `paid`로 복구한다 — 돈이
 * 나가지 않았는데 취소된 것처럼 남기지 않는다.
 */

import {
  claimPledgeForCancel,
  revertPledgeCancel,
  finalizePledgeRefund,
  PartialRefundUnsupportedError,
} from '../../db/queries/fundingPledges.ts'
import {
  cancelPayment as realCancelPayment,
  TossApiError,
  TossLookupError,
} from '../payments/toss/client.ts'

export interface OfficeRefundDeps {
  claimPledgeForCancel: typeof claimPledgeForCancel
  revertPledgeCancel: typeof revertPledgeCancel
  finalizePledgeRefund: typeof finalizePledgeRefund
  cancelPayment: (
    paymentKey: string,
    body: { orderId: string; cancelReason: string },
    deps: { secretKey: string }
  ) => Promise<unknown>
}

const realDeps: OfficeRefundDeps = {
  claimPledgeForCancel,
  revertPledgeCancel,
  finalizePledgeRefund,
  cancelPayment: (key, body, deps) => realCancelPayment(key, body, deps),
}

/** 토스 거래 내역에 남는 취소 사유. 후원자 취소('후원자 취소')와 갈린다. */
export const OFFICE_REFUND_CANCEL_REASON = '사무국 대리 환불'

export type OfficeRefundOutcome =
  | { ok: true; pledge: Record<string, unknown>; amount: number }
  /** 선점 0행 — 그사이 다른 요청이 이 후원을 잡았거나 상태가 움직였다. 409. */
  | { ok: false; reason: 'claim_lost' }
  /** 토스 응답을 판단하지 못했다. 후원은 `canceled`로 남고 재시도로 이어진다. 503. */
  | { ok: false; reason: 'lookup' }
  /** 토스가 거절했다. 선점은 되돌렸고 후원은 `paid`다. 400. */
  | { ok: false; reason: 'rejected'; message: string }
  /** 환불은 나갔는데 원장을 갱신하지 못했다. 손으로 고쳐야 한다. 500. */
  | { ok: false; reason: 'record_failed'; detail: string }
  /**
   * 선점은 잡았지만 그사이 세상이 바뀌어 진행하면 안 된다(예: 정산금이 방금
   * 지급됐다). 선점을 되돌렸고 후원은 `paid`다. 돈은 나가지 않았다. 409.
   */
  | { ok: false; reason: 'stopped_after_claim'; message: string }

export async function refundPledgeAsOffice(
  input: {
    pledgeId: string
    paymentId: string
    paymentKey: string
    orderId: string
    /** 원장의 결제 금액(원). 브라우저가 보낸 값이 아니다. */
    amount: number
    /** 앞선 시도가 선점까지 마친 건이면 참 — 선점을 건너뛴다. */
    retry: boolean
    secretKey: string
    /** 활동 기록과 짝을 맞추기 위한 표시. 원장 `raw`에 그대로 남는다. */
    actorId: string
    /**
     * 선점 **뒤**, 토스 호출 **앞**에 한 번 더 묻는 자리. 라우트가 선점 전에
     * 읽어 둔 것(정산 지급 여부)이 그사이 바뀌었는지 여기서 다시 본다.
     *
     * 왜 선점 뒤인가 — 선점된 후원(`canceled` + `payment_id`)은 정산 재계산이
     * **환불로 센다.** 그래서 선점이 들어간 순간부터 `mark_paid`는 낡은 근거로
     * 판정돼 409를 내고, 이 검사 뒤에는 더 이상 창이 없다. 선점 **전**에만
     * 읽으면 읽기와 선점 사이에 지급이 끼어들 수 있었다 — 그 창이 이 함수의
     * 존재 이유다. 트랜잭션으로 묶지 않는 이유는 토스 호출을 트랜잭션 안에
     * 두면 안 되기 때문이다(파일 머리 주석).
     *
     * `{ proceed: false, message }`를 돌려주면 선점을 되돌리고 멈춘다.
     * 던지면 선점을 되돌리고 다시 던진다 — 확인을 못 한 채 돈을 보내지 않는다.
     */
    afterClaim?: () => Promise<{ proceed: true } | { proceed: false; message: string }>
  },
  overrides?: Partial<OfficeRefundDeps>
): Promise<OfficeRefundOutcome> {
  const d = overrides ? { ...realDeps, ...overrides } : realDeps

  // 1) 선점. 재시도 건은 앞선 요청이 이미 잡아 두었다.
  //    **이행 상태를 조건에 걸지 않는다** — 그것이 사무국 환불의 요점이다.
  if (input.retry === false) {
    const claimed = await d.claimPledgeForCancel(input.pledgeId, {})
    if (!claimed) return { ok: false, reason: 'claim_lost' }
  }

  // 1.5) 선점이 들어갔으니 이제 정산 쪽은 이 건을 환불로 센다. 그 상태에서
  //      한 번 더 묻는다. 여기서 멈추면 돈은 아직 나가지 않았으므로 선점을
  //      되돌리는 것으로 깨끗이 끝난다.
  if (input.afterClaim) {
    let verdict: { proceed: true } | { proceed: false; message: string }
    try {
      verdict = await input.afterClaim()
    } catch (error) {
      await d.revertPledgeCancel(input.pledgeId)
      throw error
    }
    if (verdict.proceed === false) {
      await d.revertPledgeCancel(input.pledgeId)
      return { ok: false, reason: 'stopped_after_claim', message: verdict.message }
    }
  }

  // 2) 토스. 여기 앞뒤로 열려 있는 트랜잭션이 없다(파일 머리 주석 참고).
  try {
    await d.cancelPayment(
      input.paymentKey,
      { orderId: input.orderId, cancelReason: OFFICE_REFUND_CANCEL_REASON },
      { secretKey: input.secretKey }
    )
  } catch (error) {
    if (error instanceof TossLookupError) return { ok: false, reason: 'lookup' }
    if (error instanceof TossApiError) {
      if (error.code !== 'ALREADY_CANCELED_PAYMENT') {
        // 거절이 확실하다 — 돈은 나가지 않았다. 선점을 되돌린다.
        await d.revertPledgeCancel(input.pledgeId)
        return { ok: false, reason: 'rejected', message: error.message }
      }
      // 클라이언트가 이 코드를 성공으로 바꿔 주므로 여기로는 오지 않는다.
      // 클라이언트 동작이 바뀔 경우의 안전망일 뿐이다.
    } else {
      throw error
    }
  }

  // 3) 원장. 이 시점이면 돈은 이미 나갔다 — 아래에서 무슨 일이 나든 되돌릴 수 없다.
  let refunded: Record<string, unknown> | null = null
  try {
    refunded = await d.finalizePledgeRefund({
      orderId: input.orderId,
      paymentId: input.paymentId,
      pledgeId: input.pledgeId,
      canceledAmount: input.amount,
      raw: { canceledBy: 'office', actorId: input.actorId },
    })
  } catch (error) {
    if (error instanceof PartialRefundUnsupportedError) {
      return {
        ok: false,
        reason: 'record_failed',
        detail: `부분 환불 불일치(후원 ${error.totalAmount}원 / 취소 ${error.canceledAmount}원)`,
      }
    }
    throw error
  }
  if (!refunded) return { ok: false, reason: 'record_failed', detail: '원장 0행' }

  return { ok: true, pledge: refunded, amount: input.amount }
}
