import { NextRequest, NextResponse, after } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, transitionCampaign } from '@/db/queries/funding'
import { logUserActivity, type ActivityActionTypeValue } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import {
  actorFor,
  isCampaignAction,
  nextStatus,
  type CampaignAction,
  type CampaignStatus,
} from '@/lib/funding/transitions'
import { checkActionPreconditions } from '@/lib/funding/campaignPreconditions'
import { notifyCampaignSubmitted } from '@/lib/funding/notify'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 전이 자체는 한 줄 갱신이지만, `after()`로 넘긴 심사 요청 알림은 관리자
 * 전원에게 메일을 보낸다. 대량 발송기는 한도를 지키려고 통 사이를 벌리므로
 * (`notifyContent.ts`의 `BULK_MIN_INTERVAL_MS`), 상한(400명)까지 가면 200초
 * 남짓이다. 플랫폼 기본값(10~15초)이면 그전에 함수가 얼어 **관리자 절반만
 * 받고 누가 받았는지도 모르는** 상태가 된다. 리워드 저장·만료 크론과 같은
 * 300을 준다.
 */
export const maxDuration = 300

/** 실제로 일어난 동작을 기록한다. 심사 어휘(`funding_campaign_reviewed`)는
 * 승인·반려에만 쓴다 — 그 밖(withdraw·close)은 전용 어휘가 없으므로 범용
 * 관리 행위(`admin_action`)로 남긴다. */
function activityTypeFor(action: CampaignAction): ActivityActionTypeValue {
  if (action === 'submit') return 'funding_campaign_submitted'
  if (action === 'approve' || action === 'reject') return 'funding_campaign_reviewed'
  return 'admin_action'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await parseJsonObjectBody(request)
  const action = body?.action
  if (!isCampaignAction(action))
    return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()
  // 관리자 전용 동작은 관리자 라우트로만. 여기서는 소유자 동작만 받는다.
  if (actorFor(action) !== 'owner_or_admin')
    return ApiError.forbidden('권한이 없습니다.').toNextResponse()

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const from = campaign.status as CampaignStatus
  if (!nextStatus(from, action))
    return ApiError.badRequest('지금 상태에서는 할 수 없는 동작입니다.').toNextResponse()
  const precondition = await checkActionPreconditions(id, action)
  if (precondition.ok === false) return ApiError.badRequest(precondition.message).toNextResponse()

  const updated = await transitionCampaign({ id, action, expectedFrom: from })
  if (!updated)
    return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()

  const activity = logUserActivity({
    user_id: auth.user.id,
    action_type: activityTypeFor(action),
    target_type: 'funding_campaign',
    target_id: id,
    metadata: { action },
  })
  if (action === 'submit') {
    // 알림 억제 판정이 **이 기록을 근거로** 센다(`@/lib/funding/notifyThrottle`).
    // 방금 남긴 이 줄까지 세면 첫 제출이 "직전에도 제출했다"로 읽히므로,
    // 기다렸다 id를 받아 판정에서 빼게 한다.
    const activityId = await activity.catch(e => {
      log.warn('활동 기록 실패', e)
      return null
    })
    // 응답 뒤에 보낸다. 맨 promise로 두면 응답과 함께 함수가 얼어 관리자에게
    // 아무것도 가지 않는다(리워드 저장 라우트와 같은 모양).
    after(() =>
      notifyCampaignSubmitted(updated, { activityId }).catch(e => log.error('제출 알림 실패', e))
    )
  } else {
    activity.catch(e => log.warn('활동 기록 실패', e))
  }

  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
