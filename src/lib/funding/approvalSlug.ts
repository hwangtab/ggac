// 로컬 import는 `.ts`를 명시한다 — `campaignPreconditions.ts`와 같은 이유(`node --test`).
import { getCampaignBySlug } from '../../db/queries/funding.ts'
import { getProfileDisplayName } from '../../db/queries/profiles.ts'
import { campaignSlugCandidates, suggestCampaignSlug } from './campaignSlug.ts'

/**
 * 이 캠페인에 지금 붙일 수 있는 제안 주소. 다른 캠페인이 쓰는 주소는 건너뛴다.
 * 판정과 쓰기 사이의 경합은 승인 라우트가 유니크 제약으로 다시 막는다.
 */
export async function resolveApprovalSlug(campaign: Record<string, unknown>): Promise<string> {
  const id = String(campaign.id)
  const ownerName = campaign.owner_user_id
    ? await getProfileDisplayName(String(campaign.owner_user_id))
    : null
  const base = suggestCampaignSlug({ ownerName, title: String(campaign.title ?? ''), id })
  const candidates = campaignSlugCandidates(base, id)
  for (const slug of candidates) {
    const taken = await getCampaignBySlug(slug)
    if (!taken || taken.id === id) return slug
  }
  return candidates[candidates.length - 1]
}
