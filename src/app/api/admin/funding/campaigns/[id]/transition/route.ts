import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getCampaignById, getCampaignBySlug, transitionCampaign, isDuplicateCampaignSlugError } from '@/db/queries/funding'
import { logUserActivity, type ActivityActionTypeValue } from '@/db/queries/activities'
import { isCampaignAction, nextStatus, type CampaignAction, type CampaignStatus } from '@/lib/funding/transitions'
import { checkActionPreconditions } from '@/lib/funding/campaignPreconditions'
import { isValidSlug } from '@/lib/funding/campaignInput'
import { getFundingSettings } from '@/lib/funding/settings'
import { notifyCampaignReviewed, notifyCampaignClosed } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 실제로 일어난 동작을 기록한다. 심사 어휘(`funding_campaign_reviewed`)는
 * 승인·반려에만 쓴다 — 관리자가 조합원을 대신해 제출·철회·마감할 수도
 * 있으므로(`transitions.ts`의 `actorFor` 참고) 그 경우까지 "심사"로
 * 뭉뚱그리면 실제로 일어난 일과 로그가 어긋난다. */
function activityTypeFor(action: CampaignAction): ActivityActionTypeValue {
  if (action === 'submit') return 'funding_campaign_submitted'
  if (action === 'approve' || action === 'reject') return 'funding_campaign_reviewed'
  return 'admin_action'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await parseJsonObjectBody(request)
    const action = body?.action
    if (!isCampaignAction(action)) return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()

    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
    const from = campaign.status as CampaignStatus
    if (!nextStatus(from, action)) return ApiError.badRequest('지금 상태에서는 할 수 없는 동작입니다.').toNextResponse()
    const precondition = await checkActionPreconditions(id, action)
    if (precondition.ok === false) return ApiError.badRequest(precondition.message).toNextResponse()

    let slug: string | undefined
    let platformFeeRate: number | undefined
    if (action === 'approve') {
      if (!isValidSlug(body?.slug)) return ApiError.badRequest('주소(slug)는 영문 소문자·숫자·하이픈 3~60자입니다.').toNextResponse()
      const taken = await getCampaignBySlug(body.slug)
      if (taken && taken.id !== id) return ApiError.badRequest('이미 쓰는 주소입니다.').toNextResponse()
      slug = body.slug
      platformFeeRate = (await getFundingSettings()).platform_fee_rate_bp
    }
    const reviewNote = typeof body?.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 1000) : null
    if (action === 'reject' && !reviewNote) return ApiError.badRequest('반려 사유를 적어 주세요.').toNextResponse()

    let updated
    try {
      updated = await transitionCampaign({ id, action, expectedFrom: from, slug, reviewNote, platformFeeRate })
    } catch (error) {
      // 사전 검사와 쓰기 사이에 다른 관리자가 같은 주소로 먼저 승인하면 이
      // 유니크 제약에 걸린다. 사전 검사가 잡아내는 것과 같은 사용자 메시지로
      // 답한다 — 500으로 새면 "서버 오류"처럼 보이지만 실제로는 경합일 뿐이다.
      if (isDuplicateCampaignSlugError(error)) return ApiError.badRequest('이미 쓰는 주소입니다.').toNextResponse()
      throw error
    }
    if (!updated) return ApiError.badRequest('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()

    logUserActivity({
      user_id: auth.user.id, action_type: activityTypeFor(action),
      target_type: 'funding_campaign', target_id: id, metadata: { action, from, to: updated.status },
    }).catch(e => log.warn('활동 기록 실패', e))
    if (action === 'approve' || action === 'reject') notifyCampaignReviewed(updated, action).catch(e => log.error('심사 알림 실패', e))
    if (action === 'close') notifyCampaignClosed(updated).catch(e => log.error('마감 알림 실패', e))

    return ApiSuccess.ok({ campaign: updated }).toNextResponse()
  } catch (error) {
    log.error('심사 처리 실패:', error)
    return ApiError.internalServerError('심사를 처리하지 못했습니다.').toNextResponse()
  }
}
