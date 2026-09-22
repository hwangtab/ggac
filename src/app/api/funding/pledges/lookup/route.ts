import { NextRequest } from 'next/server'

import { getCampaignById } from '@/db/queries/funding'
import { getPledgeByCodeAndEmail } from '@/db/queries/fundingPledges'
import { isPledgeCode } from '@/lib/funding/pledgeCode'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 후원자에게 보여줄 필드만. 배송지·전화·관리자 메모는 내보내지 않는다. */
function publicView(pledge: Record<string, unknown>, campaign: Record<string, unknown> | null) {
  return {
    pledge_code: pledge.pledge_code,
    status: pledge.status,
    reward_title: pledge.reward_title,
    quantity: pledge.quantity,
    additional_amount: pledge.additional_amount,
    total_amount: pledge.total_amount,
    paid_at: pledge.paid_at,
    fulfillment_status: pledge.fulfillment_status,
    campaign_slug: campaign?.slug ?? null,
    campaign_title: campaign?.title ?? null,
    campaign_status: campaign?.status ?? null,
  }
}

export async function POST(request: NextRequest) {
  const rl = await applyRouteRateLimit(request, {
    name: 'funding_lookup', windowMs: 60_000, maxRequests: 10,
    message: '요청이 너무 잦습니다.', keyGenerator: createIPKeyGenerator('funding-lookup'),
  })
  if (!rl.success && rl.response?.status === 429) return rl.response

  const body = await parseJsonObjectBody(request)
  if (!body || !isPledgeCode(body.pledgeCode) || typeof body.email !== 'string') {
    return ApiError.badRequest('후원번호와 이메일을 입력해 주세요.').toNextResponse()
  }
  const pledge = await getPledgeByCodeAndEmail(body.pledgeCode, body.email.trim())
  if (!pledge) return ApiError.notFound('후원 내역을 찾을 수 없습니다.').toNextResponse()
  const campaign = await getCampaignById(String(pledge.campaign_id))
  return ApiSuccess.ok({ pledge: publicView(pledge, campaign) }).toNextResponse()
}
