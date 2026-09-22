import { isApprovedActive, isApprovedActiveAdmin, type ProfileLike } from '@/lib/server/authz'

/** 캠페인 편집·제출·마감. 소유자(승인·활성) 또는 관리자. */
export function canManageCampaign(
  profile: ProfileLike | null,
  userId: string | null,
  campaign: { owner_user_id: string | null }
): boolean {
  if (isApprovedActiveAdmin(profile)) return true
  if (!userId || !isApprovedActive(profile)) return false
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
