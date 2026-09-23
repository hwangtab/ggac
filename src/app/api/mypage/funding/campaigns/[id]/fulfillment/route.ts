/**
 * 리워드 이행 상태를 옮긴다 — 개설자(와 사무국)가 쓰는 유일한 자리.
 *
 * 전이 규칙의 정본은 `@/lib/funding/fulfillment`다. 이 라우트는 물어보고만
 * 움직인다: 캠페인이 이행을 움직일 수 있는 상태인가, 이 목표 상태로 갈 수
 * 있는 출발 상태가 무엇인가, 그중 실제로 움직인 행은 어느 것인가.
 *
 * **읽고 나서 쓰지 않는다.** 화면이 본 상태와 쓰는 시점의 상태가 다를 수
 * 있으므로(두 탭, 개설자와 사무국이 동시에) 출발 상태를 쓰기 조건에 걸고,
 * 요청한 것만큼 움직이지 않았으면 409로 답한다. 이 기능에서 같은 종류의
 * 경합에 두 번 물렸고 두 번 다 같은 모양으로 고쳤다.
 *
 * 알림은 **발송 경계를 넘은 건에만** 나간다(`crossesSentBoundary`). 준비
 * 중은 개설자의 내부 단계이고, 이미 보냈다고 알린 건을 전달 완료로 마저
 * 옮길 때는 다시 알리지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById } from '@/db/queries/funding'
import { advanceFulfillment } from '@/db/queries/fundingPledges'
import { logUserActivity } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { isApprovedActiveAdmin } from '@/lib/server/authz'
import {
  allowedSourcesFor,
  crossesSentBoundary,
  isFulfillableCampaignStatus,
  isFulfillmentStatus,
} from '@/lib/funding/fulfillment'
import { notifyPledgesShipped } from '@/lib/funding/notify'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/fulfillment')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 한 번에 옮길 수 있는 건수. 화면의 '전체 선택'이 그대로 들어오는 자리다. */
const MAX_PLEDGES_PER_REQUEST = 500

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  // 본문을 먼저 끝까지 읽는다 — 상태를 읽은 뒤에 읽으면 본문이 도착하는
  // 시점을 요청자가 쥐고 있어 그사이 캠페인이 움직일 수 있다(편집 라우트와
  // 같은 순서).
  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

  const to = body.to
  if (!isFulfillmentStatus(to))
    return ApiError.badRequest('옮길 이행 상태가 올바르지 않습니다.').toNextResponse()

  const rawIds = Array.isArray(body.pledge_ids) ? body.pledge_ids : null
  if (!rawIds || rawIds.length === 0)
    return ApiError.badRequest('상태를 바꿀 후원을 하나 이상 선택해 주세요.').toNextResponse()
  const pledgeIds = [
    ...new Set(rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  ]
  if (pledgeIds.length === 0)
    return ApiError.badRequest('상태를 바꿀 후원을 하나 이상 선택해 주세요.').toNextResponse()
  if (pledgeIds.length > MAX_PLEDGES_PER_REQUEST)
    return ApiError.badRequest(
      `한 번에 ${MAX_PLEDGES_PER_REQUEST}건까지 바꿀 수 있습니다. 나누어 처리해 주세요.`
    ).toNextResponse()

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  if (!isFulfillableCampaignStatus(campaign.status)) {
    return ApiError.badRequest(
      '후원을 받기 시작한 뒤부터 리워드 이행 상태를 바꿀 수 있습니다.'
    ).toNextResponse()
  }

  // 되돌리기(`none`)는 사무국만 할 수 있다. 개설자에게는 출발 상태 목록이
  // 비어 오므로 아래 쓰기가 아무것도 건드리지 않지만, 아무 일도 일어나지
  // 않은 이유를 화면이 추측하지 않도록 여기서 분명히 답한다.
  const isAdmin = isApprovedActiveAdmin(auth.profile)
  const allowedFrom = allowedSourcesFor(to, isAdmin)
  if (allowedFrom.length === 0) {
    return ApiError.forbidden(
      '이행 상태를 되돌리는 것은 사무국만 할 수 있습니다. contact@ggac.kr으로 문의해 주세요.'
    ).toNextResponse()
  }

  // **두 번 나누어 쓴다.** 알림은 발송 경계를 넘은 건에만 나가야 하는데,
  // 조건부 쓰기는 바뀐 뒤의 행을 돌려주므로 출발 상태가 남지 않는다. 출발
  // 상태를 경계 기준으로 갈라 두 번 쓰면, 어느 쪽에서 돌아온 행인지가 곧
  // 출발 상태의 답이 된다. 둘 다 조건부라 경합 안전성은 그대로다.
  const crossingFrom = allowedFrom.filter(from => crossesSentBoundary(from, to))
  const quietFrom = allowedFrom.filter(from => !crossesSentBoundary(from, to))
  // 순차로 부른다 — 같은 커넥션에서 두 UPDATE를 겹치면 잠금 경합(SQLITE_BUSY)을
  // 부를 뿐 얻는 것이 없다.
  const crossed = await advanceFulfillment({
    campaignId: id,
    pledgeIds,
    to,
    allowedFrom: crossingFrom,
  })
  const quiet = await advanceFulfillment({ campaignId: id, pledgeIds, to, allowedFrom: quietFrom })
  const updated = [...crossed, ...quiet]

  logUserActivity({
    user_id: auth.user.id,
    action_type: 'funding_fulfillment_updated',
    target_type: 'funding_campaign',
    target_id: id,
    metadata: { to, requested: pledgeIds.length, updated: updated.length },
  }).catch(e => log.warn('활동 기록 실패', e))

  // 알림 하나가 이 응답을 바꾸면 안 되므로 기다리지 않는다 — 실패는 알림
  // 모듈 안에서 삼켜진다.
  if (crossed.length > 0) {
    notifyPledgesShipped(campaign, crossed).catch(e => log.error('발송 알림 실패', e))
  }

  if (updated.length !== pledgeIds.length) {
    // 움직인 것은 그대로 둔다(되돌리면 이미 나간 알림과 어긋난다). 대신
    // 몇 건이 빠졌는지 말해 주고 새로고침을 요청한다.
    return ApiError.conflict(
      `${pledgeIds.length}건 중 ${updated.length}건만 바꿨습니다. 나머지는 이미 상태가 바뀌었거나 결제가 취소된 후원입니다. 새로고침한 뒤 다시 확인해 주세요.`
    ).toNextResponse()
  }

  return ApiSuccess.ok({
    updated: updated.length,
    pledges: updated.map(p => ({ id: p.id, fulfillment_status: p.fulfillment_status })),
  }).toNextResponse()
}
