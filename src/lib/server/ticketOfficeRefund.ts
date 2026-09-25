/**
 * 사무국 대리 예매 환불의 **실행 순서**. 본인 취소와 같은 기계를 쓴다.
 *
 * ## 환불기를 두 벌 만들지 않는다
 *
 * 돈을 돌려주는 코드가 저장소에 둘이 되면, 다음에 토스 응답 처리 하나를 고칠
 * 때 한쪽만 고친다. 그래서 여기서 새로 만드는 것은 아무것도 없다 — 토스
 * 취소(`cancelPayment`)도 원장·좌석 확정(`finalizeTicketRefund`)도 본인 취소가
 * 이미 쓰는 함수다. 이 파일이 하는 일은 **그 둘을 같은 순서로 부르는 것**과,
 * 라우트가 답할 수 있도록 결과를 갈래로 돌려주는 것뿐이다.
 *
 * 본인 취소와 다른 점은 둘이다.
 * ① 금액을 공제율 표에서 뽑지 않는다 — 사무국이 적는다(`ticketOfficeRefund.ts`).
 * ② 취소 사유 문자열이 다르다. 토스 거래 내역에서 누가 눌렀는지 갈린다.
 *
 * ## 토스를 먼저 부르고, 성공한 뒤에 좌석을 푼다
 *
 * 뒤집으면 좌석은 풀렸는데 돈은 안 돌아간 상태가 생기고, 그건 관객이 알아채기
 * 어려운 형태로 남는다(화면에는 "취소됨"으로 보인다). 본인 취소 라우트의 머리
 * 주석이 정한 순서이고, 여기서도 같다.
 *
 * 선점(`claim`) 단계가 없는 것은 펀딩과 다른 점이다. 예매 쪽에는 "취소 중"을
 * 표시할 중간 상태가 없고, 대신 `finalizeTicketRefund`가 한 트랜잭션에서
 * `status IN ('pending','confirmed')`를 조건으로 걸어 **읽은 상태에 조건을
 * 건다.** 두 요청이 겹치면 뒤엣것이 0행으로 답한다.
 *
 * ## 콘솔에서 이미 환불한 건도 여기로 들어온다
 *
 * 토스 콘솔에서 손으로 환불한 결제를 이 길로 다시 누르면, 토스가
 * `ALREADY_CANCELED_PAYMENT`로 답하고 클라이언트가 그것을 **성공으로** 바꿔
 * 준다(`toss/client.ts`). 그래서 그다음 줄이 그대로 돌아 좌석이 풀리고 원장이
 * 맞춰진다 — 콘솔 환불의 뒷정리가 별도 기계 없이 같은 버튼으로 끝난다.
 *
 * ## 트랜잭션은 토스 호출을 감싸지 않는다
 *
 * 이 파일에 `db.transaction`은 없다. 여는 것은 `finalizeTicketRefund` 하나이고,
 * 그것은 **토스 응답이 돌아온 뒤에** 불린다. 네트워크 왕복이 DB 쓰기 잠금을
 * 붙들고 있는 구간이 없다.
 */

import { finalizeTicketRefund } from '../../db/queries/ticketing.ts'
import {
  cancelPayment as realCancelPayment,
  TossApiError,
  TossLookupError,
} from '../payments/toss/client.ts'

export interface TicketOfficeRefundDeps {
  finalizeTicketRefund: typeof finalizeTicketRefund
  cancelPayment: (
    paymentKey: string,
    body: { orderId: string; cancelReason: string; cancelAmount?: number },
    deps: { secretKey: string }
  ) => Promise<unknown>
}

const realDeps: TicketOfficeRefundDeps = {
  finalizeTicketRefund,
  cancelPayment: (key, body, deps) => realCancelPayment(key, body, deps),
}

/** 토스 거래 내역에 남는 취소 사유. 본인 취소('관객 취소 …')와 갈린다. */
export const TICKET_OFFICE_REFUND_CANCEL_REASON = '사무국 대리 환불'

export type TicketOfficeRefundOutcome =
  | { ok: true; reservation: Record<string, unknown>; refundAmount: number }
  /** 토스 응답을 판단하지 못했다. 좌석도 원장도 건드리지 않았다. 503. */
  | { ok: false; reason: 'lookup' }
  /** 토스가 거절했다. 돈은 나가지 않았고 예매는 그대로다. 400. */
  | { ok: false; reason: 'rejected'; message: string }
  /** 환불은 나갔는데 원장·좌석을 갱신하지 못했다. 손으로 고쳐야 한다. 500. */
  | { ok: false; reason: 'record_failed' }

export async function refundReservationAsOffice(
  input: {
    reservationId: string
    paymentId: string
    paymentKey: string
    orderId: string
    /** 이번에 돌려줄 금액(원). 브라우저가 보낸 값을 원장으로 검증한 결과다. */
    refundAmount: number
    /** 남은 전액이면 참 — 토스에 금액을 싣지 않는다. */
    isFullRefund: boolean
    /** 원장에 적을 누적 취소 총액(`planTicketOfficeRefund`가 계산한다). */
    canceledAmountTotal: number
    secretKey: string
    /** 활동 기록과 짝을 맞추기 위한 표시. 원장 `raw`에 그대로 남는다. */
    actorId: string
  },
  overrides?: Partial<TicketOfficeRefundDeps>
): Promise<TicketOfficeRefundOutcome> {
  const d = overrides ? { ...realDeps, ...overrides } : realDeps

  // 1) 먼저 환불한다.
  try {
    await d.cancelPayment(
      input.paymentKey,
      {
        orderId: input.orderId,
        cancelReason: TICKET_OFFICE_REFUND_CANCEL_REASON,
        // 전액이면 금액을 싣지 않는다 — 토스가 잔액 전부를 취소한다.
        ...(input.isFullRefund ? {} : { cancelAmount: input.refundAmount }),
      },
      { secretKey: input.secretKey }
    )
  } catch (error) {
    if (error instanceof TossLookupError) {
      // 환불됐는지 알 수 없다. 좌석을 풀면 돈은 그대로인 채 표만 사라진다.
      return { ok: false, reason: 'lookup' }
    }
    if (error instanceof TossApiError) {
      return { ok: false, reason: 'rejected', message: error.message }
    }
    throw error
  }

  // 2) 환불이 끝난 뒤에 원장과 좌석을 **함께** 바꾼다. 여기서 실패하면 돈은
  //    이미 나갔으므로 되돌릴 방법이 없다 — 라우트가 시끄럽게 남긴다.
  const canceled = await d.finalizeTicketRefund({
    orderId: input.orderId,
    paymentId: input.paymentId,
    reservationId: input.reservationId,
    canceledAmount: input.canceledAmountTotal,
    raw: { canceledBy: 'office', actorId: input.actorId },
  })
  if (!canceled) return { ok: false, reason: 'record_failed' }

  return { ok: true, reservation: canceled, refundAmount: input.refundAmount }
}
