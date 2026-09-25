import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { listCampaignsForAdmin, getCampaignProgress } from '@/db/queries/funding'
import { nextStatus, type CampaignStatus } from '@/lib/funding/transitions'
import { resolveCampaignFeeRate, type CampaignFeeRate } from '@/lib/server/fundingFeeRate'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 승인 버튼을 누르면 수수료율이 캠페인에 **영원히** 새겨진다. 그것을 정산할
 * 때 처음 알게 두지 않으려고, 아직 승인할 수 있는 캠페인에는 "지금 누르면
 * 붙을 요율"을 함께 실어 보낸다(`fee_preview`).
 *
 * 승인할 수 없는 캠페인에는 싣지 않는다 — 이미 승인된 건은 캠페인 행에
 * 새겨진 값이 사실이고, 예고는 그 사실과 다를 수 있다.
 *
 * 나가는 것은 요율과 참·거짓 하나뿐이다. 개설자 프로필에서 읽은 값 자체는
 * 어느 것도 응답에 싣지 않는다.
 */
async function feePreviewFor(campaign: Record<string, unknown>): Promise<CampaignFeeRate | null> {
  if (!nextStatus(campaign.status as CampaignStatus, 'approve')) return null
  return resolveCampaignFeeRate(campaign.owner_user_id)
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const status = request.nextUrl.searchParams.get('status') ?? undefined
  const campaigns = await listCampaignsForAdmin({ status })
  const withProgress = await Promise.all(
    campaigns.map(async c => ({
      ...c,
      progress: await getCampaignProgress(String(c.id)),
      fee_preview: await feePreviewFor(c),
    }))
  )
  return ApiSuccess.ok({ campaigns: withProgress }).toNextResponse()
}
