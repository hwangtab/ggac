import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, listRewards, transitionCampaign } from '@/db/queries/funding'
import { logUserActivity } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { actorFor, isCampaignAction, nextStatus, type CampaignStatus } from '@/lib/funding/transitions'
import { notifyCampaignSubmitted } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (action === 'submit' && (await listRewards(id)).length === 0) {
    return ApiError.badRequest('리워드를 하나 이상 만든 뒤 제출해 주세요.').toNextResponse()
  }

  const updated = await transitionCampaign({ id, action, expectedFrom: from })
  if (!updated) return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()

  logUserActivity({
    user_id: auth.user.id,
    action_type: action === 'submit' ? 'funding_campaign_submitted' : 'admin_action',
    target_type: 'funding_campaign', target_id: id, metadata: { action },
  }).catch(e => log.warn('활동 기록 실패', e))
  if (action === 'submit') notifyCampaignSubmitted(updated).catch(e => log.error('제출 알림 실패', e))

  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
