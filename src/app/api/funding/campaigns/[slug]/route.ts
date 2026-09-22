import { NextRequest } from 'next/server'

import { getCampaignBySlug, listRewards, getCampaignProgress } from '@/db/queries/funding'
import { getRemainingQuantity } from '@/db/queries/fundingPledges'
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'
import { toPublicCampaign } from '@/lib/funding/publicCampaign'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  if (
    !campaign ||
    !(PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(String(campaign.status))
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const [rewards, progress] = await Promise.all([
    listRewards(String(campaign.id)),
    getCampaignProgress(String(campaign.id)),
  ])
  const rewardsWithStock = await Promise.all(
    rewards.map(async r => ({ ...r, remaining_quantity: await getRemainingQuantity(String(r.id)) }))
  )
  return ApiSuccess.ok({
    campaign: toPublicCampaign(campaign),
    rewards: rewardsWithStock,
    progress,
  }).toNextResponse()
}
