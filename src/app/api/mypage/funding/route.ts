import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { listCampaignsByOwner } from '@/db/queries/funding'
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
  // 원장 그대로 내보내면 심사 메모·주문번호·결제 식별자까지 본인 화면에
  // 실린다 — 게스트 조회 라우트와 같은 화이트리스트로 좁힌다.
  return ApiSuccess.ok({
    campaigns,
    pledges: pledges.map(p => ({ ...toPublicPledgeFields(p), campaign_id: p.campaign_id })),
  }).toNextResponse()
}
