import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getCampaignById, getCampaignBySlug, transitionCampaign } from '@/db/queries/funding'
import { logUserActivity } from '@/db/queries/activities'
import { isCampaignAction, nextStatus, type CampaignStatus } from '@/lib/funding/transitions'
import { isValidSlug } from '@/lib/funding/campaignInput'
import { getFundingSettings } from '@/lib/funding/settings'
import { notifyCampaignReviewed, notifyCampaignClosed } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await parseJsonObjectBody(request)
  const action = body?.action
  if (!isCampaignAction(action)) return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()

  const campaign = await getCampaignById(id)
  if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  const from = campaign.status as CampaignStatus
  if (!nextStatus(from, action)) return ApiError.badRequest('지금 상태에서는 할 수 없는 동작입니다.').toNextResponse()

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

  const updated = await transitionCampaign({ id, action, expectedFrom: from, slug, reviewNote, platformFeeRate })
  if (!updated) return ApiError.badRequest('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()

  logUserActivity({
    user_id: auth.user.id, action_type: 'funding_campaign_reviewed',
    target_type: 'funding_campaign', target_id: id, metadata: { action, from, to: updated.status },
  }).catch(e => log.warn('활동 기록 실패', e))
  if (action === 'approve' || action === 'reject') notifyCampaignReviewed(updated, action).catch(e => log.error('심사 알림 실패', e))
  if (action === 'close') notifyCampaignClosed(updated).catch(e => log.error('마감 알림 실패', e))

  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
