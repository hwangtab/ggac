/**
 * 사무국 대리 예매 환불이 **무엇을 받아들이는가**의 정본. DB도 네트워크도 모른다.
 *
 * ## 관객이 못 하는 것 중 사무국이 할 수 있는 것
 *
 * 본인 취소(`src/app/api/tickets/cancel/route.ts`)는 세 조건을 모두 만족할 때만
 * 열린다 — `confirmed`이고, 요청자가 그 예매의 `user_id` 본인이고,
 * `refundPolicy.ts`가 환불 가능하다고 답하는 날짜. **비회원 예매는 첫 조건에서
 * 이미 막힌다**(`user_id`가 비어 있어 본인 확인 수단이 없다). 그 화면은 그래서
 * "사무국으로 문의해 주세요"라고만 말했는데, 사무국에게 남은 수단은 **토스
 * 콘솔**뿐이었다.
 *
 * 콘솔에서 환불하면 돈은 나가지만 `reservations.status`는 `confirmed`로,
 * `payments.status`는 `done`으로 남는다. 좌석은 영영 잠기고(재고 계산이 그
 * 행을 점유로 센다), 원장은 받은 적 없는 돈을 받았다고 말한다. 원장이 모르는
 * 환불을 만들지 않는 것이 이 기능의 존재 이유이므로, "여기서 막으면 콘솔로
 * 간다"가 곧 "여기서 막지 않는다"의 근거가 된다.
 *
 * ## 그래서 어디에 선을 긋는가
 *
 * 막는 것은 **돈이 실제로 잡힌 적 없는 예매**뿐이다. 결제 연결이 없는 선점,
 * 만료된 선점, 이미 전액이 환불된 결제. 이것들은 환불할 돈이 애초에 없다 —
 * 여기서 통과시키면 토스에 없는 결제의 취소를 요청하게 된다.
 *
 * **공연일은 보지 않는다.** 공제율 표(`refundPolicy.ts`)는 관객이 스스로
 * 취소할 때의 기준이고, 공연 당일·종료 뒤에는 아예 닫힌다. 사무국이 이 길을
 * 쓰는 때가 바로 그 닫힌 자리다 — 공연이 취소됐거나, 회차를 잘못 산 관객이
 * 당일에 전화를 걸어 온 경우. 그래서 금액은 표가 아니라 **사람이 적는다**.
 * 적지 않으면 남은 전액이다.
 *
 * ## 사유는 빈칸일 수 없다
 *
 * 환불은 되돌릴 수 없고 진짜 돈을 옮긴다. 누가 왜 눌렀는지가 남지 않으면
 * 남는 것은 "사무국이 환불했다"는 문장뿐이고, 그것은 기록이 아니다.
 */

/** 사유의 길이. 아래 한계는 활동 기록에 그대로 실린다. */
export const TICKET_REFUND_REASON_MIN = 10
export const TICKET_REFUND_REASON_MAX = 500

export type TicketOfficeRefundBlock =
  | 'not_captured'
  | 'already_refunded'
  | 'no_payment'
  | 'amount_invalid'

export type TicketOfficeRefundPlan =
  | {
      ok: true
      /** 이번에 돌려줄 금액(원). */
      refundAmount: number
      /** 아직 돌려주지 않은 금액(원). `refundAmount`의 상한이다. */
      remaining: number
      /**
       * 남은 전액인가. 토스는 `cancelAmount`를 싣지 않으면 잔액 전부를
       * 취소하므로, 전액일 때는 금액을 빼서 보낸다(본인 취소와 같은 규칙).
       */
      isFullRefund: boolean
      /**
       * 원장에 적을 **누적** 취소 총액. 이번 회차 금액만 적으면 부분 환불을
       * 두 번 했을 때 두 번째가 `lt` 조건에 걸려 조용히 무시된다
       * (`finalizeTicketRefund` 주석).
       */
      canceledAmountTotal: number
    }
  | { ok: false; reason: TicketOfficeRefundBlock; message: string }

function wholeWon(value: unknown): number | null {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function nonNegativeWon(value: unknown): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

/**
 * 이 예매를 사무국이 환불할 수 있는가. 판정에 쓰는 것은 원장 두 행과, 사무국이
 * 적은 금액뿐이다.
 *
 * `requestedAmount`가 없으면 남은 전액이다. 있으면 정수 원이어야 하고 남은
 * 금액을 넘을 수 없다 — 넘는 요청을 토스에 그대로 보내면 거절당하는데, 그건
 * 화면이 답을 늦게 받는 것일 뿐 아무것도 지키지 못한다.
 */
export function planTicketOfficeRefund(
  reservation: Record<string, unknown> | null,
  payment: Record<string, unknown> | null,
  options: { requestedAmount?: unknown } = {}
): TicketOfficeRefundPlan {
  if (!reservation) {
    return { ok: false, reason: 'not_captured', message: '예매 내역을 찾을 수 없습니다.' }
  }

  // 좌석을 아직 쥐고 있는 예매만 여기로 온다. `canceled`·`expired`는
  // `finalizeTicketRefund`가 0행으로 답하므로, 토스를 부르기 **전에** 막는다 —
  // 나간 뒤에 거부되면 돈만 나가고 기록이 남지 않는다.
  const status = String(reservation.status ?? '')
  if (status !== 'confirmed' && status !== 'pending') {
    return {
      ok: false,
      reason: status === 'canceled' ? 'already_refunded' : 'not_captured',
      message:
        status === 'canceled'
          ? '이미 취소된 예매입니다. 환불이 나가지 않았다면 토스 거래 내역을 확인해 주세요.'
          : '좌석을 쥐고 있지 않은 예매입니다. 환불할 결제가 없습니다.',
    }
  }

  if (!payment || typeof payment.payment_key !== 'string' || payment.payment_key.length === 0) {
    return {
      ok: false,
      reason: 'no_payment',
      message: '결제 정보를 확인할 수 없습니다. 토스 거래 내역을 먼저 확인해 주세요.',
    }
  }

  const paid = wholeWon(payment.amount)
  if (paid === null) {
    return { ok: false, reason: 'amount_invalid', message: '결제 금액을 읽지 못했습니다.' }
  }

  const alreadyCanceled = nonNegativeWon(payment.canceled_amount)
  const remaining = paid - alreadyCanceled
  if (remaining <= 0) {
    return {
      ok: false,
      reason: 'already_refunded',
      message: '이미 전액이 환불된 결제입니다.',
    }
  }

  let refundAmount = remaining
  if (options.requestedAmount !== undefined && options.requestedAmount !== null) {
    const requested = wholeWon(options.requestedAmount)
    if (requested === null) {
      return {
        ok: false,
        reason: 'amount_invalid',
        message: '환불 금액은 1원 이상의 정수여야 합니다.',
      }
    }
    if (requested > remaining) {
      return {
        ok: false,
        reason: 'amount_invalid',
        message: `환불할 수 있는 금액은 ${remaining.toLocaleString('ko-KR')}원까지입니다.`,
      }
    }
    refundAmount = requested
  }

  return {
    ok: true,
    refundAmount,
    remaining,
    isFullRefund: refundAmount === remaining,
    canceledAmountTotal: alreadyCanceled + refundAmount,
  }
}

/** 사무국이 적은 사유. 다듬은 문자열을 돌려주고, 모자라면 null이다. */
export function normalizeTicketRefundReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < TICKET_REFUND_REASON_MIN) return null
  return trimmed.slice(0, TICKET_REFUND_REASON_MAX)
}
