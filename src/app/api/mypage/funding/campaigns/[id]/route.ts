import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, listRewards, updateCampaignFields, getCampaignProgress } from '@/db/queries/funding'
import { listPledgesByCampaign } from '@/db/queries/fundingPledges'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { parseCampaignPatch } from '@/lib/funding/campaignInput'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** 개설자에게 보이는 후원 행. 배송 리워드가 아니면 연락처·주소는 싣지 않는다. */
function ownerPledgeView(p: Record<string, unknown>, shippingRewardIds: Set<string>) {
  const ships = shippingRewardIds.has(String(p.reward_id))
  return {
    id: p.id, pledge_code: p.pledge_code, status: p.status, reward_title: p.reward_title,
    quantity: p.quantity, total_amount: p.total_amount, paid_at: p.paid_at,
    backer_name: p.is_anonymous ? '익명' : p.backer_name,
    supporter_message: p.supporter_message, fulfillment_status: p.fulfillment_status,
    ...(ships
      ? { backer_email: p.backer_email, shipping_name: p.shipping_name, shipping_phone: p.shipping_phone, shipping_postcode: p.shipping_postcode, shipping_address1: p.shipping_address1, shipping_address2: p.shipping_address2, shipping_memo: p.shipping_memo }
      : {}),
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (!campaign || !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const [rewards, pledges, progress] = await Promise.all([
    listRewards(id), listPledgesByCampaign(id, { status: 'paid' }), getCampaignProgress(id),
  ])
  const shippingIds = new Set(rewards.filter(r => r.requires_shipping).map(r => String(r.id)))
  return ApiSuccess.ok({
    campaign, rewards, progress,
    pledges: pledges.map(p => ownerPledgeView(p, shippingIds)),
    edit_scope: editScope(campaign.status as CampaignStatus),
  }).toNextResponse()
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled())) return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (!campaign || !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const scope = editScope(campaign.status as CampaignStatus)
  if (scope === 'none') return ApiError.badRequest('지금 상태에서는 수정할 수 없습니다.').toNextResponse()

  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
  const parsed = parseCampaignPatch(body, scope)
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()

  const updated = await updateCampaignFields(id, parsed.patch)
  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
