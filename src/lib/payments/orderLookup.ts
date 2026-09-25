/**
 * "이 주문의 승인이 실제로 있었는가"를 토스에 묻는 판정. 대사 스윕이 쓴다.
 *
 * 후원 만료 크론(`/api/internal/funding/expire`)이 인라인으로 하던 판정을 그대로
 * 옮긴 것이다. 예매·조합비도 같은 질문을 하고, 답을 잘못 읽으면 잃는 것이 같다
 * (돈은 나갔는데 표·납부가 없거나, 남의 결제를 내 주문으로 가로챈다). 세 곳이
 * 저마다 쓰면 한 곳만 고쳐지므로 판정을 한 자리에 둔다.
 *
 * 돌려주는 값의 뜻은 `PaymentLookup`에 적힌 그대로다.
 *
 * - **`not_found`** — 원장에 결제 식별자가 없거나 토스가 "그런 결제 없음"으로
 *   답했다. 확정 라우트는 승인 호출 *전에* `recordPaymentKey`로 식별자를
 *   새기므로, 식별자가 없다는 것은 "승인 응답이 유실됐다"가 아니라 **승인 요청
 *   자체가 나간 적이 없다**는 뜻이다.
 * - **`mismatch`** — 토스가 말하는 결제의 주문번호가 우리 것이 아니다. 대기 행의
 *   식별자는 클라이언트가 보낸 값을 검증 전에 새긴 것이라, 남의 결제 식별자가
 *   실려 있을 수 있다. 그대로 승격시키면 남의 결제를 가로챈다. 다시 물어도 답이
 *   같으므로 보류하지 않고 끝낸다 — 보류하면 이 행이 다음 스윕의 창을 영영 먹는다.
 * - **`unknown`** — 조회를 못 했거나, 주문번호는 맞는데 금액이 어긋난다. 후자는
 *   승인된 돈이 실제로 있을 수 있어 자동으로 정할 수 없다. 사람이 봐야 한다.
 */

import type { PaymentLookup } from '../funding/expiryGuard.ts'

import { lookupPayment as tossLookupPayment, TossApiError, TossLookupError } from './toss/client.ts'

export interface OrderPaymentLookupDeps {
  secretKey: string
  getPaymentByOrderId: (orderId: string) => Promise<Record<string, unknown> | null>
  /** 토스 조회. 테스트가 대역을 넘긴다. */
  lookupPayment?: (
    paymentKey: string,
    deps: { secretKey: string }
  ) => Promise<Record<string, unknown> | null>
  log?: { error: (msg: string, meta?: unknown) => void }
}

export function createOrderPaymentLookup(
  deps: OrderPaymentLookupDeps
): (orderId: string) => Promise<PaymentLookup> {
  const look = deps.lookupPayment ?? tossLookupPayment

  return async function lookupByOrderId(orderId: string): Promise<PaymentLookup> {
    const payment = await deps.getPaymentByOrderId(orderId)
    if (!payment?.payment_key) return 'not_found'

    try {
      const p = await look(String(payment.payment_key), { secretKey: deps.secretKey })
      if (!p) return 'not_found'

      const tossOrderId = typeof p.orderId === 'string' ? p.orderId : null
      const tossTotalAmount = Number(p.totalAmount)
      const expectedAmount = Number(payment.amount)
      if (
        tossOrderId !== orderId ||
        !Number.isFinite(tossTotalAmount) ||
        tossTotalAmount !== expectedAmount
      ) {
        deps.log?.error('스윕 대상 결제가 이 주문의 것이 아님', {
          orderId,
          receivedOrderId: tossOrderId,
          expectedAmount,
          receivedAmount: tossTotalAmount,
        })
        return tossOrderId !== orderId ? 'mismatch' : 'unknown'
      }

      return {
        status: String(p.status),
        paymentKey: String(p.paymentKey),
        method: typeof p.method === 'string' ? p.method : undefined,
        approvedAt: typeof p.approvedAt === 'string' ? p.approvedAt : undefined,
      }
    } catch (error) {
      if (error instanceof TossLookupError) return 'unknown'
      if (error instanceof TossApiError && error.status === 404) return 'not_found'
      throw error
    }
  }
}
