import { NextRequest, NextResponse, after } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import {
  getCampaignById,
  getCampaignBySlug,
  transitionCampaign,
  isDuplicateCampaignSlugError,
} from '@/db/queries/funding'
import { logUserActivity, type ActivityActionTypeValue } from '@/db/queries/activities'
import {
  isCampaignAction,
  nextStatus,
  type CampaignAction,
  type CampaignStatus,
} from '@/lib/funding/transitions'
import { checkActionPreconditions } from '@/lib/funding/campaignPreconditions'
import { isValidSlug } from '@/lib/funding/campaignInput'
import { isFundingEnabled } from '@/lib/funding/settings'
import { resolveCampaignFeeRate } from '@/lib/server/fundingFeeRate'
import { notifyCampaignReviewed, notifyCampaignClosed } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/funding/transition')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * `after()`로 넘긴 승인·반려·마감 알림은 **개설자 한 사람**에게 간다 —
 * 대량 발송기를 타지 않으므로 메일 한 통과 설정·주소 조회가 전부다. 그래도
 * 예산을 적어 둔다: 적지 않으면 플랫폼 기본값(10~15초)이고, 심사 처리 자체가
 * 슬러그 중복 확인·요율 판정까지 하는 자리라 Resend가 한 번 느려지면 알림이
 * 통째로 사라진다. 한 통이 아무리 늦어도 들어오는 60초로 잡는다.
 */
export const maxDuration = 60

/** 실제로 일어난 동작을 기록한다. 심사 어휘(`funding_campaign_reviewed`)는
 * 승인·반려에만 쓴다 — 관리자가 조합원을 대신해 제출·철회·마감할 수도
 * 있으므로(`transitions.ts`의 `actorFor` 참고) 그 경우까지 "심사"로
 * 뭉뚱그리면 실제로 일어난 일과 로그가 어긋난다. */
function activityTypeFor(action: CampaignAction): ActivityActionTypeValue {
  if (action === 'submit') return 'funding_campaign_submitted'
  if (action === 'approve' || action === 'reject') return 'funding_campaign_reviewed'
  return 'admin_action'
}

/** 심사한 판과 지금 판이 어긋났을 때의 답. 이 라우트의 다른 409와 같은 모양이다. */
function contentChanged() {
  return ApiError.conflict(
    '심사하는 동안 캠페인 내용이 바뀌었습니다. 새로고침해 바뀐 내용을 다시 확인한 뒤 승인해 주세요.'
  ).toNextResponse()
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await parseJsonObjectBody(request)
    const action = body?.action
    if (!isCampaignAction(action))
      return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()

    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
    const from = campaign.status as CampaignStatus
    if (!nextStatus(from, action))
      return ApiError.badRequest('지금 상태에서는 할 수 없는 동작입니다.').toNextResponse()
    const precondition = await checkActionPreconditions(id, action)
    if (precondition.ok === false) return ApiError.badRequest(precondition.message).toNextResponse()

    let slug: string | undefined
    let platformFeeRate: number | undefined
    // 승인 활동 기록에 함께 남길 요율 판정. 승인이 아니면 null이다.
    let feeRate: { rate_bp: number; is_member: boolean } | null = null
    if (action === 'approve') {
      if (!isValidSlug(body?.slug))
        return ApiError.badRequest(
          '주소(slug)는 영문 소문자·숫자·하이픈 3~60자입니다.'
        ).toNextResponse()
      const taken = await getCampaignBySlug(body.slug)
      if (taken && taken.id !== id)
        return ApiError.badRequest('이미 쓰는 주소입니다.').toNextResponse()
      slug = body.slug
      // 요율은 **승인하는 이 순간** 골라 캠페인에 새긴다. 개설자가 조합원이면
      // 3.3%, 아니면 5.5%(둘 다 부가세 포함) — 고르는 규칙과 그 이유는
      // `@/lib/funding/feeRate`에 적혀 있다. 심사 목록이 승인 전에 보여 주는
      // 요율도 같은 함수에서 나오므로 화면과 도장이 어긋나지 않는다.
      //
      // 새긴 뒤에는 설정을 바꿔도 이 캠페인의 요율은 움직이지 않는다
      // (`settlement.ts`의 `platformFeeFor`는 언제나 캠페인 행의 값을 쓴다).
      feeRate = await resolveCampaignFeeRate(campaign.owner_user_id)
      platformFeeRate = feeRate.rate_bp
    }
    const reviewNote =
      typeof body?.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 1000) : null
    if (action === 'reject' && !reviewNote)
      return ApiError.badRequest('반려 사유를 적어 주세요.').toNextResponse()

    // 승인은 **관리자가 실제로 읽은 판(版)** 에만 도장을 찍는다.
    //
    // `expectedFrom`은 상태만 본다. 개설자가 심사 화면이 떠 있는 사이에
    // 철회 → 전면 수정 → 재제출을 1초 안에 돌리면 상태는 다시 `submitted`라
    // 조건이 맞고, 관리자가 본 적 없는 내용이 그대로 공개된다.
    //
    // 그래서 내용이 움직일 때마다 함께 움직이는 값(`updated_at`)을 판 번호로
    // 쓴다. 화면이 불러온 값을 그대로 보내고, 서버는 지금 값과 다르면 거절한다.
    // 리워드만 고쳐도 이 값이 움직인다 — `applyRewardBatch`가 트랜잭션 맨 앞에서
    // 캠페인 행을 조건부로 갱신하고, 그 갱신이 `updated_at`을 새로 찍는다
    // (`scripts/testing/queriesFunding.test.mjs`가 실제로 확인한다).
    //
    // 반려에는 요구하지 않는다. 관리자가 무엇을 봤든 "다시 보내라"는 언제나 할
    // 수 있어야 하고, 판이 바뀌었다고 반려를 막으면 이상한 캠페인을 돌려보낼
    // 길이 막힌다.
    let reviewedVersion: string | null = null
    if (action === 'approve') {
      const raw = body?.reviewedVersion
      if (typeof raw !== 'string' || raw.length === 0) {
        return ApiError.badRequest(
          '심사한 내용의 판 정보가 없습니다. 목록을 새로고침한 뒤 내용을 다시 확인하고 승인해 주세요.'
        ).toNextResponse()
      }
      if (raw !== campaign.updated_at) return contentChanged()
      reviewedVersion = raw
    }

    let updated
    try {
      updated = await transitionCampaign({
        id,
        action,
        expectedFrom: from,
        // 위 대조와 이 쓰기 사이에도 창은 남는다 — 판 번호를 쓰기 조건으로 함께
        // 걸어 마지막 방어선을 둔다(`updateCampaignFields`의 `requireStatus`와 같은 방식).
        expectedUpdatedAt: reviewedVersion,
        slug,
        reviewNote,
        platformFeeRate,
      })
    } catch (error) {
      // 사전 검사와 쓰기 사이에 다른 관리자가 같은 주소로 먼저 승인하면 이
      // 유니크 제약에 걸린다. 사전 검사가 잡아내는 것과 같은 사용자 메시지로
      // 답한다 — 500으로 새면 "서버 오류"처럼 보이지만 실제로는 경합일 뿐이다.
      if (isDuplicateCampaignSlugError(error))
        return ApiError.badRequest('이미 쓰는 주소입니다.').toNextResponse()
      throw error
    }
    if (!updated) {
      // 0행인 이유가 둘이다 — 상태가 움직였거나(다른 관리자가 먼저 처리),
      // 내용이 움직였거나(심사 중 개설자가 고쳤다). 관리자가 다음에 할 일이
      // 다르므로 무엇이 일어났는지 지금 값을 다시 읽어 구별해 준다.
      if (reviewedVersion) {
        const now = await getCampaignById(id)
        if (now && now.status === from && now.updated_at !== reviewedVersion)
          return contentChanged()
      }
      return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()
    }

    logUserActivity({
      user_id: auth.user.id,
      action_type: activityTypeFor(action),
      target_type: 'funding_campaign',
      target_id: id,
      metadata: {
        action,
        from,
        to: updated.status,
        // 어느 요율이 새겨졌는지는 나중에 돈 이야기가 될 값이다. 승인 기록
        // 옆에 함께 남긴다 — 개설자 프로필은 뒤에 바뀔 수 있으므로, 판정
        // 결과를 그때 적어 두지 않으면 왜 그 요율이 붙었는지 되짚을 수 없다.
        ...(feeRate
          ? {
              platform_fee_rate_bp: feeRate.rate_bp,
              creator_is_member: feeRate.is_member,
            }
          : {}),
      },
    }).catch(e => log.warn('활동 기록 실패', e))
    // 응답 뒤에 보낸다. 맨 promise로 두면 응답과 함께 함수가 얼어 개설자는
    // 승인·반려·마감 소식을 **영영 받지 못한다**(후원 확정 라우트와 같은 모양).
    if (action === 'approve' || action === 'reject')
      after(() =>
        notifyCampaignReviewed(updated, action).catch(e => log.error('심사 알림 실패', e))
      )
    if (action === 'close')
      after(() => notifyCampaignClosed(updated).catch(e => log.error('마감 알림 실패', e)))

    return ApiSuccess.ok({ campaign: updated }).toNextResponse()
  } catch (error) {
    log.error('심사 처리 실패:', error)
    return ApiError.internalServerError('심사를 처리하지 못했습니다.').toNextResponse()
  }
}
