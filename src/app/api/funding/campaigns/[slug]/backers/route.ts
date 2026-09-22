import { NextRequest } from 'next/server'

import { getCampaignBySlug } from '@/db/queries/funding'
import { listPublicBackers } from '@/db/queries/fundingPledges'
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  if (!campaign || !(PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(String(campaign.status))) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  return ApiSuccess.ok({ backers: await listPublicBackers(String(campaign.id)) }).toNextResponse()
}
