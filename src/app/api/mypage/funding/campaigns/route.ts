import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { createCampaign } from '@/db/queries/funding'
import { logUserActivity } from '@/db/queries/activities'
import { parseCampaignPatch } from '@/lib/funding/campaignInput'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/campaigns')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CREATOR_TERMS_VERSION = '2026-09-21'

export async function POST(request: NextRequest) {
  if (!(await isFundingEnabled())) return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
  if (body.agreedCreatorTerms !== true) return ApiError.badRequest('개설자 약관에 동의해 주세요.').toNextResponse()

  const parsed = parseCampaignPatch(body, 'all')
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()
  const { patch } = parsed
  if (!patch.title || !patch.summary || !patch.goal_amount) {
    return ApiError.badRequest('제목·한 줄 소개·목표 금액은 필수입니다.').toNextResponse()
  }

  const campaign = await createCampaign({
    owner_user_id: auth.user.id,
    title: String(patch.title),
    summary: String(patch.summary),
    story: typeof patch.story === 'string' ? patch.story : '',
    category: typeof patch.category === 'string' ? patch.category : undefined,
    goal_amount: Number(patch.goal_amount),
    start_at: (patch.start_at as string | null) ?? null,
    end_at: (patch.end_at as string | null) ?? null,
    cover_image: (patch.cover_image as string | null) ?? null,
    project_slug: (patch.project_slug as string | null) ?? null,
    terms_version: CREATOR_TERMS_VERSION,
  })
  logUserActivity({ user_id: auth.user.id, action_type: 'funding_campaign_created', target_type: 'funding_campaign', target_id: String(campaign.id) })
    .catch(e => log.warn('활동 기록 실패', e))
  return ApiSuccess.created({ campaign }).toNextResponse()
}
