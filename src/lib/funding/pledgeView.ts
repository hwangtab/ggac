/**
 * 후원자 본인에게 보여줘도 되는 후원 필드의 단일 정의.
 *
 * 원장 조회는 심사 메모·주문번호(`order_id`)·결제 식별자(`payment_id`) 같은
 * 운영 전용 필드까지 함께 준다. 비회원 조회 라우트(`/api/funding/pledges/lookup`)와
 * 조합원 본인 목록(`/api/mypage/funding`)이 각자 다른 화이트리스트를 두면
 * 한쪽만 고치고 잊는 순간 다시 새는 필드가 생긴다 — 여기 하나만 고치면 된다.
 */
export function toPublicPledgeFields(pledge: Record<string, unknown>): Record<string, unknown> {
  return {
    pledge_code: pledge.pledge_code,
    status: pledge.status,
    reward_title: pledge.reward_title,
    quantity: pledge.quantity,
    additional_amount: pledge.additional_amount,
    total_amount: pledge.total_amount,
    paid_at: pledge.paid_at,
    fulfillment_status: pledge.fulfillment_status,
  }
}
