/**
 * 공개 응답에 실어도 되는 캠페인 필드.
 *
 * 목록과 상세가 같은 캠페인을 서로 다른 모양으로 내보내면, 상세가 가린 값이
 * 목록으로 새는 것을 아무도 눈치채지 못한다(`review_note`는 관리자가 쓴 반려
 * 사유다). 두 라우트가 같은 함수를 부르게 해서 "공개"의 정의를 한 곳에 둔다.
 */
const PRIVATE_CAMPAIGN_FIELDS = ['review_note', 'platform_fee_rate', 'owner_user_id'] as const

export function toPublicCampaign<T extends Record<string, unknown>>(
  campaign: T
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...campaign }
  for (const key of PRIVATE_CAMPAIGN_FIELDS) delete rest[key]
  return rest
}
