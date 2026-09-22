import { NextRequest } from 'next/server'

import { getCampaignBySlug, listRewards, getCampaignProgress } from '@/db/queries/funding'
import { getRemainingQuantity } from '@/db/queries/fundingPledges'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 후원 위저드가 폴링하는 가벼운 응답. 10초 캐시. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  const rewards = await listRewards(String(campaign.id))
  const stock = Object.fromEntries(
    await Promise.all(rewards.map(async r => [String(r.id), await getRemainingQuantity(String(r.id))]))
  )
  const res = ApiSuccess.ok({
    status: campaign.status,
    is_open: campaign.status === 'active',
    progress: await getCampaignProgress(String(campaign.id)),
    stock,
  }).toNextResponse()
  res.headers.set('Cache-Control', 'public, max-age=10, s-maxage=10')
  return res
}
