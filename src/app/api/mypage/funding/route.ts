import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { getCampaignById, listCampaignsByOwner } from '@/db/queries/funding'
import { listPledgesByUser } from '@/db/queries/fundingPledges'
import { toPublicPledgeFields } from '@/lib/funding/pledgeView'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const [campaigns, pledges] = await Promise.all([
    listCampaignsByOwner(auth.user.id),
    listPledgesByUser(auth.user.id),
  ])
  // 화면이 각 후원을 캠페인으로 링크하려면 slug가 있어야 한다 — 비회원 조회
  // 라우트(`/api/funding/pledges/lookup`)와 같은 이유로 여기서도 붙인다.
  // 캠페인 수는 적으니 중복 없이 한 번씩만 조회한다.
  const campaignIds = [...new Set(pledges.map(p => String(p.campaign_id)))]
  const campaignRows = await Promise.all(campaignIds.map(id => getCampaignById(id)))
  const slugById = new Map(campaignIds.map((id, i) => [id, campaignRows[i]?.slug ?? null]))
  // 원장 그대로 내보내면 심사 메모·주문번호·결제 식별자까지 본인 화면에
  // 실린다 — 게스트 조회 라우트와 같은 화이트리스트로 좁힌다.
  return ApiSuccess.ok({
    campaigns,
    pledges: pledges.map(p => ({
      ...toPublicPledgeFields(p),
      campaign_id: p.campaign_id,
      campaign_slug: slugById.get(String(p.campaign_id)) ?? null,
    })),
  }).toNextResponse()
}
