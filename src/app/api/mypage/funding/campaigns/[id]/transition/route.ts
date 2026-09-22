import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, transitionCampaign } from '@/db/queries/funding'
import { logUserActivity, type ActivityActionTypeValue } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { actorFor, isCampaignAction, nextStatus, type CampaignAction, type CampaignStatus } from '@/lib/funding/transitions'
import { checkActionPreconditions } from '@/lib/funding/campaignPreconditions'
import { notifyCampaignSubmitted } from '@/lib/funding/notify'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 실제로 일어난 동작을 기록한다. 심사 어휘(`funding_campaign_reviewed`)는
 * 승인·반려에만 쓴다 — 그 밖(withdraw·close)은 전용 어휘가 없으므로 범용
 * 관리 행위(`admin_action`)로 남긴다. */
function activityTypeFor(action: CampaignAction): ActivityActionTypeValue {
  if (action === 'submit') return 'funding_campaign_submitted'
  if (action === 'approve' || action === 'reject') return 'funding_campaign_reviewed'
  return 'admin_action'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled())) return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await parseJsonObjectBody(request)
  const action = body?.action
  if (!isCampaignAction(action)) return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()
  // 관리자 전용 동작은 관리자 라우트로만. 여기서는 소유자 동작만 받는다.
  if (actorFor(action) !== 'owner_or_admin') return ApiError.forbidden('권한이 없습니다.').toNextResponse()

  const campaign = await getCampaignById(id)
  if (!campaign || !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const from = campaign.status as CampaignStatus
  if (!nextStatus(from, action)) return ApiError.badRequest('지금 상태에서는 할 수 없는 동작입니다.').toNextResponse()
  const precondition = await checkActionPreconditions(id, action)
  if (precondition.ok === false) return ApiError.badRequest(precondition.message).toNextResponse()

  const updated = await transitionCampaign({ id, action, expectedFrom: from })
  if (!updated) return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()

  logUserActivity({
    user_id: auth.user.id,
    action_type: activityTypeFor(action),
    target_type: 'funding_campaign', target_id: id, metadata: { action },
  }).catch(e => log.warn('활동 기록 실패', e))
  if (action === 'submit') notifyCampaignSubmitted(updated).catch(e => log.error('제출 알림 실패', e))

  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
