/**
 * 공개 응답에 실어도 되는 리워드 필드.
 *
 * 리워드 행에는 `locked_at`(첫 결제가 붙은 시각)이 있다. 공개 후원자 명단은
 * `paid_at`을 밀리초까지 그대로 내보내므로, 둘을 나란히 놓으면 "이 리워드를
 * 처음 잠근 후원"이 누구인지가 시각 하나로 맞춰진다 — 이름이 걸린 후원자를
 * 특정 리워드, 즉 특정 금액에 묶을 수 있다. `campaign_id`·`sort_order`·
 * `created_at`·`updated_at`도 화면이 쓰지 않으니 함께 뺀다.
 *
 * 캠페인은 `toPublicCampaign`, 후원은 `toPublicPledgeFields`가 같은 일을 한다.
 * 지우는 목록이 아니라 **싣는 목록**이라, 표에 컬럼이 늘어도 저절로 새지 않는다.
 */
export function toPublicReward(reward: Record<string, unknown>): Record<string, unknown> {
  return {
    id: reward.id,
    title: reward.title,
    description: reward.description,
    amount: reward.amount,
    total_quantity: reward.total_quantity,
    requires_shipping: reward.requires_shipping,
    estimated_delivery: reward.estimated_delivery,
    image_url: reward.image_url,
  }
}
