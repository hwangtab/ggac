import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  getCampaignById,
  listRewards,
  updateCampaignFields,
  getCampaignProgress,
} from '@/db/queries/funding'
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
    id: p.id,
    pledge_code: p.pledge_code,
    status: p.status,
    reward_title: p.reward_title,
    quantity: p.quantity,
    total_amount: p.total_amount,
    paid_at: p.paid_at,
    backer_name: p.is_anonymous ? '익명' : p.backer_name,
    supporter_message: p.supporter_message,
    fulfillment_status: p.fulfillment_status,
    ...(ships
      ? {
          backer_email: p.backer_email,
          shipping_name: p.shipping_name,
          shipping_phone: p.shipping_phone,
          shipping_postcode: p.shipping_postcode,
          shipping_address1: p.shipping_address1,
          shipping_address2: p.shipping_address2,
          shipping_memo: p.shipping_memo,
        }
      : {}),
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const [rewards, pledges, progress] = await Promise.all([
    listRewards(id),
    listPledgesByCampaign(id, { status: 'paid' }),
    getCampaignProgress(id),
  ])
  const shippingIds = new Set(rewards.filter(r => r.requires_shipping).map(r => String(r.id)))
  return ApiSuccess.ok({
    campaign,
    rewards,
    progress,
    pledges: pledges.map(p => ownerPledgeView(p, shippingIds)),
    edit_scope: editScope(campaign.status as CampaignStatus),
  }).toNextResponse()
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  // 본문을 **먼저** 끝까지 읽는다. 상태를 읽고 편집 범위를 정한 뒤에 읽으면,
  // 본문이 도착하는 시점을 요청자가 쥐고 있으므로 그 사이에 제출·승인이 끼어들
  // 수 있다 — 그러면 낡은 범위로 검증하게 된다(전이 라우트와 같은 순서다).
  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const status = campaign.status as CampaignStatus
  const scope = editScope(status)
  if (scope === 'none')
    return ApiError.badRequest('지금 상태에서는 수정할 수 없습니다.').toNextResponse()

  const parsed = parseCampaignPatch(body, scope)
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()

  // 순서를 바로잡아도 판정과 쓰기 사이의 창은 남는다. 판정 근거가 된 상태를
  // 쓰기 조건으로 함께 걸어, 그 사이에 상태가 움직였으면 아무것도 쓰지 않는다.
  const updated = await updateCampaignFields(id, parsed.patch, { requireStatus: status })
  if (!updated)
    return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()
  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
