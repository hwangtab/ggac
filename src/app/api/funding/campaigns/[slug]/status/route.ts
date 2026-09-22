import { NextRequest } from 'next/server'

import { getCampaignBySlug, listRewards, getCampaignProgress } from '@/db/queries/funding'
import { getRemainingQuantity } from '@/db/queries/fundingPledges'
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 후원 위저드가 폴링하는 가벼운 응답. 10초 캐시. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  // 형제 라우트([slug], backers)와 같은 공개 가시성 판정. 이게 없으면 초안·
  // 심사중 캠페인도 여기서만 상태·진행률·재고를 그대로 흘려보낸다 — "숨김"과
  // "존재하지 않음"이 이 라우트에서만 구별되는 구멍이 된다.
  if (!campaign || !(PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(String(campaign.status))) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
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
