import { isApprovedActiveAdmin, type ProfileLike } from '@/lib/server/authz'

/**
 * 캠페인 편집·제출·마감. **소유자** 또는 관리자.
 *
 * 소유자에게는 조합원 승인을 묻지 않는다. 사무국이 대신 여는 개설
 * (`POST /api/admin/funding/campaigns`)이 조합원이 아닌 회원도 개설자로
 * 받기 때문이다(`src/lib/funding/proxyOwner.ts`, 승인 때 비조합원 요율
 * 5.5%가 붙는다). 여기서 `isApprovedActive`를 함께 요구하면 그렇게 만들어진
 * 캠페인의 주인이 **자기 캠페인에서 403**을 받는다 — 사무국이 모든 편집을
 * 대신 해 주지 않는 한 그 캠페인은 주인이 손댈 수 없는 물건이 된다.
 *
 * 경계가 헐리지는 않는다. 이 판정은 `campaign.owner_user_id`와의 일치를
 * 여전히 요구하므로 남의 캠페인에는 닿지 못하고, **개설 자체**
 * (`POST /api/mypage/funding/campaigns`)는 `requireActiveMember`가 계속
 * 조합원만 통과시킨다 — 비조합원 캠페인은 사무국 대리 개설로만 생긴다.
 */
export function canManageCampaign(
  profile: ProfileLike | null,
  userId: string | null,
  campaign: { owner_user_id: string | null }
): boolean {
  if (isApprovedActiveAdmin(profile)) return true
  // 프로필이 없다는 것은 "이 사람이 누군지 확인하지 못했다"는 뜻이다(조회
  // 실패 포함) — 승인 여부를 묻지 않게 된 지금도 그 경우는 닫아 둔다.
  if (!userId || !profile) return false
  return campaign.owner_user_id === userId
}

/** 심사(승인·반려)·정산·환불·수기 등록. */
export function canReviewCampaign(profile: ProfileLike | null): boolean {
  return isApprovedActiveAdmin(profile)
}

/** 세션으로 보는 후원은 본인 것뿐. 비회원 후원은 번호+이메일 경로(lookup)로만. */
export function canViewPledge(userId: string | null, pledge: { user_id: string | null }): boolean {
  return Boolean(userId) && pledge.user_id === userId
}
