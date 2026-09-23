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
 *
 * **기능 스위치를 인증보다 먼저 본다** — 이 저장소의 다른 펀딩 쓰기 라우트
 * 전부와 같은 순서다(`…/route.ts`, `…/rewards/route.ts`,
 * `…/transition/route.ts`). 스위치가 꺼져 있으면 누가 부르든 503이고, 그
 * 응답은 "당신이 누구인지와 무관하게 이 기능이 아직 없다"만 말한다 — 인증
 * 여부에 따라 답이 갈리지 않으므로 흘리는 것이 없다. 켜져 있으면 비인증
 * 요청은 401을 받고, `e2e/authz-funding.spec.ts`가 스위치를 켠 채로 그것을
 * 직접 확인한다.
 */
import { NextRequest, NextResponse, after } from 'next/server'

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
import { MAX_BULK_RECIPIENTS } from '@/lib/funding/notifyContent'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/fulfillment')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 쓰기 자체는 금방 끝나지만 `after()`로 넘긴 발송 알림은 후원자 수만큼 메일을
 * 보낸다. 플랫폼 기본값(10~15초)이면 마흔 명분(초당 2통 간격으로 20초)도 못
 * 채우고 함수가 얼어붙는다 — 그러면 앞쪽 몇 통만 나가고, 후원은 이미
 * `shipped`라 버튼을 다시 눌러도 조건에 걸리는 행이 없어 **재시도할 길조차
 * 없다.** 리워드 저장 라우트·만료 크론과 같은 300을 준다.
 */
export const maxDuration = 300

/**
 * 한 번에 옮길 수 있는 건수.
 *
 * **대량 발송기의 상한과 같은 값이어야 한다.** 달랐을 때 무슨 일이
 * 벌어지는지가 이 상수가 여기 있는 이유다: 라우트가 500까지 받고 발송기가
 * 400을 넘으면 통째로 포기하므로, 450건을 한 번에 누르면 450명 전원이
 * 되돌릴 수 없이 발송 완료가 되고 개설자는 성공을 보고받으며 **후원자는 아무도
 * 연락을 받지 못한다.** 450명 캠페인에서 '전체 선택' 한 번이면 일어난다.
 *
 * 그래서 값을 하나로 묶고, **쓰기 전에** 막는다 — 넘친 것을 나중에 알면
 * 이미 되돌릴 수 없는 상태가 되어 있다.
 */
const MAX_PLEDGES_PER_REQUEST = MAX_BULK_RECIPIENTS

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
  // 쓰기보다 먼저 막는다 — 위 상수 주석 참고.
  if (pledgeIds.length > MAX_PLEDGES_PER_REQUEST)
    return ApiError.badRequest(
      `한 번에 ${MAX_PLEDGES_PER_REQUEST}건까지 바꿀 수 있습니다. 나누어 선택해 주세요.`
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

  // 후원자 수가 얼마든 응답을 기다리게 하지 않는다. 다만 **떠다니는 약속으로
  // 두지 않는다** — 응답이 나가는 순간 함수가 얼어붙어 메일이 중간에 끊긴다.
  // `after()`가 응답 뒤에도 함수를 살려 두고, 위 `maxDuration`이 그 시간을
  // 준다(리워드 저장 라우트·확정 라우트와 같은 모양). `notifyPledgesShipped`는
  // 스스로 던지지 않지만 `after()` 안에서 새는 예외는 잡아 줄 사람이 없으므로
  // 한 번 더 감싼다.
  if (crossed.length > 0) {
    after(() => notifyPledgesShipped(campaign, crossed).catch(e => log.error('발송 알림 실패', e)))
  }

  if (updated.length !== pledgeIds.length) {
    // **여기까지 오는 것은 진짜 경합뿐이다.** 화면이 옮길 수 있는 건만 골라
    // 보내므로(`canTransitionFulfillment`), 이미 그 상태였던 건이 섞여 이
    // 갈림길에 오지 않는다 — 다른 탭이나 사무국이 그사이 같은 후원을
    // 움직였을 때만 온다.
    //
    // 움직인 것은 그대로 둔다(되돌리면 이미 나간 알림과 어긋난다). 무슨 일이
    // 있었는지는 **추측하지 않는다** — 결제가 취소됐다고 단정하면 아무 일도
    // 없던 돈 이야기를 개설자가 읽게 된다.
    return ApiError.conflict(
      `${pledgeIds.length}건 중 ${updated.length}건만 바꿨습니다. 나머지는 그사이 다른 곳에서 상태가 바뀌었습니다. 새로고침한 뒤 남은 건을 다시 확인해 주세요.`
    ).toNextResponse()
  }

  return ApiSuccess.ok({
    updated: updated.length,
    pledges: updated.map(p => ({ id: p.id, fulfillment_status: p.fulfillment_status })),
  }).toNextResponse()
}
