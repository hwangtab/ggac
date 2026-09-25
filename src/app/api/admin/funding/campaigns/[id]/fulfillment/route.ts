/**
 * 리워드 이행을 **사무국이 들여다보고, 필요하면 되돌리는** 자리.
 *
 * ## GET — 한 번에 쓸어버린 표시를 보이게 한다
 *
 * 개설자는 캠페인 이틀째에 후원 전부를 '발송 완료'로 누를 수 있다. 그러면
 * 후원자 전원의 자동 취소가 닫히고 전원이 "보냈습니다" 메일을 받는데, 오늘
 * 남는 것은 활동 기록 한 줄뿐이고 **그 줄을 읽는 사람이 없다.**
 *
 * 그래서 이 조회가 세 가지를 함께 준다 — 지금 이행 상태별 건수, 후원 목록,
 * 그리고 **이 캠페인의 이행 표시 이력**(누가, 언제, 어디로, 몇 건을). 한 번의
 * 요청이 후원자 거의 전부를 올렸으면 표시를 달아 보낸다(`isSweepingMark`).
 * 표시는 잘못의 증거가 아니라 **볼 자리**다 — 판단은 사무국이 한다.
 *
 * 나가는 것은 후원자 표기(익명이면 '익명')·후원번호·금액·상태뿐이다. 이메일·
 * 전화·주소는 싣지 않는다 — 여기서 할 일에 필요 없고, 후원번호와 이메일이
 * 한 화면에 같이 놓이는 것이 이 기능에서 이미 한 번 닫은 문이다.
 *
 * ## POST — 발송 표시를 되돌린다
 *
 * 평상시 이행 표(`allowedSourcesFor`)에서 역행은 `preparing → none` 하나뿐이고
 * 그 규칙은 그대로다. 이 라우트는 그 표를 넓히는 것이 아니라 **다른 문**이며,
 * 열쇠가 셋이다.
 *
 * ① **사무국만.** `requireAdmin()` 뒤에 있다. 개설자는 자기 캠페인이라도 이
 *    라우트를 부를 수 없다 — 잘못 누른 사람이 혼자 되돌리면 "발송했다"는
 *    기록이 아무 무게도 갖지 못한다.
 * ② **사유를 적어야 한다**(열 자 이상). 그 문장이 기록에 그대로 남는다.
 * ③ **무슨 일이었는지 골라야 한다**(`FULFILLMENT_REVERSAL_KINDS`). 코드는
 *    "엉뚱한 행을 눌렀다"와 "부치지도 않고 눌렀다"와 "부친 뒤에 환불을 다시
 *    열려 한다"를 구분하지 못한다. 사무국이 고른 값이 그 구분이고, 같은
 *    개설자에게서 `not_shipped`가 거듭 나오면 그것 자체가 신호다.
 *
 * 되돌리기가 `none`까지 내려가면 그 후원자는 다시 스스로 전액 취소를 할 수
 * 있다(`reopensSelfCancel`). 부친 물건에 대해 환불을 다시 여는 것 —— 원래
 * 규칙이 막으려던 바로 그 일 —— 이므로, 그 건수를 응답과 기록에 따로 센다.
 *
 * **읽고 나서 쓰지 않는다.** 출발 상태를 조건부 쓰기의 WHERE에 걸고, 요청한
 * 만큼 움직이지 않았으면 409로 답한다 — 개설자 이행 라우트와 같은 모양이다.
 */
import { NextRequest, NextResponse, after } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getCampaignById, getCampaignProgress } from '@/db/queries/funding'
import {
  advanceFulfillment,
  listPaymentFailureMessagesByCampaign,
  listPledgesByCampaign,
} from '@/db/queries/fundingPledges'
import { listActivitiesWithProfile, logUserActivity } from '@/db/queries/activities'
import { getSettlementByCampaign } from '@/db/queries/fundingSettlements'
import {
  allowedReversalSourcesFor,
  crossesSentBoundaryBackward,
  isFulfillableCampaignStatus,
  isFulfillmentReversalKind,
  isFulfillmentStatus,
  isSweepingMark,
  reopensSelfCancel,
  FULFILLMENT_ORDER,
  FULFILLMENT_REVERSAL_REASON_MAX,
  FULFILLMENT_REVERSAL_REASON_MIN,
  type FulfillmentStatus,
} from '@/lib/funding/fulfillment'
import { backerDisplayName, MAX_BULK_RECIPIENTS } from '@/lib/funding/notifyContent'
import { notifyFulfillmentReversed } from '@/lib/funding/notifyOfficeRemedy'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/funding/fulfillment')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 되돌리기도 후원자 수만큼 정정 메일을 보낸다 — 개설자 이행 라우트와 같은 값. */
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** 이력에서 읽어 오는 표시 기록의 개수. 화면이 접어 두고 보여 준다. */
const MARK_HISTORY_LIMIT = 30

/** 활동 기록은 이 표가 생기기 전 것도 있다 — 처음부터 읽는다. */
const EPOCH = new Date(0)

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()

    const pledges = await listPledgesByCampaign(id)
    // 취소된 건이 "돈이 잡힌 적 없다"인지 "승인 뒤 환불이 불확실하게 끝났다"인지는
    // 결제 행의 실패 사유 한 줄로만 갈린다. 그 문장이 목록에 없으면 두 가지가
    // 똑같이 보이고, 사람이 볼 이유가 없는 줄로 섞인다.
    const failureMessages = await listPaymentFailureMessagesByCampaign(id)
    const paid = pledges.filter(p => p.status === 'paid')
    const counts: Record<FulfillmentStatus, number> = {
      none: 0,
      preparing: 0,
      shipped: 0,
      delivered: 0,
    }
    for (const p of paid) {
      const s = p.fulfillment_status
      if (isFulfillmentStatus(s)) counts[s] += 1
    }

    const history = await listActivitiesWithProfile({
      actionType: 'funding_fulfillment_updated',
      targetType: 'funding_campaign',
      targetId: id,
      startDate: EPOCH,
      page: 1,
      limit: MARK_HISTORY_LIMIT,
    })

    return ApiSuccess.ok({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        approved_at: campaign.approved_at ?? null,
        closed_at: campaign.closed_at ?? null,
      },
      fulfillable: isFulfillableCampaignStatus(campaign.status),
      // 환불 버튼이 **누르기 전에** 무엇을 각오해야 하는지 말할 수 있어야
      // 한다. 지급이 끝난 캠페인의 환불은 개설자에게서 되돌려 받아야 하는
      // 돈을 만들고, 환불 라우트는 그 경우 확인 없이는 409로 답한다.
      settlement_status: (await getSettlementByCampaign(id))?.status ?? null,
      progress: await getCampaignProgress(id),
      counts,
      // 환불된 건도 함께 준다 — 사무국이 "이미 돌려준 건인가"를 같은 표에서
      // 보아야 같은 후원을 두 번 처리하지 않는다.
      pledges: pledges
        .filter(p => p.status === 'paid' || p.status === 'refunded' || p.status === 'canceled')
        .map(p => ({
          id: p.id,
          pledge_code: p.pledge_code,
          backer_name: backerDisplayName(p),
          status: p.status,
          fulfillment_status: p.fulfillment_status,
          reward_title: p.reward_title,
          quantity: p.quantity,
          total_amount: p.total_amount,
          paid_at: p.paid_at ?? null,
          // 취소된 후원이 "돈이 잡힌 적 없다"인지 "승인 뒤 환불이 불확실하게
          // 끝났다"인지는 결제 행이 붙어 있는지로만 갈린다. 결제 식별자
          // 자체는 싣지 않는다 — 화면이 필요한 것은 참·거짓 하나뿐이다
          // (`pledgeRowState`).
          has_payment: typeof p.payment_id === 'string' && p.payment_id.length > 0,
          payment_failure_message: failureMessages.get(String(p.id)) ?? null,
        })),
      marks: history.rows.map(row => {
        const updated = Number(row.metadata?.updated ?? 0)
        return {
          id: row.id,
          created_at: row.created_at,
          actor: row.member_profiles?.display_name ?? '(탈퇴한 사용자)',
          to: row.metadata?.to ?? null,
          requested: Number(row.metadata?.requested ?? 0),
          updated,
          action: row.metadata?.action ?? 'mark',
          kind: row.metadata?.kind ?? null,
          reason: typeof row.metadata?.reason === 'string' ? row.metadata.reason : null,
          // 한 번에 거의 전부를 올린 표시인가. 판단이 아니라 표시다.
          sweeping: row.metadata?.to === 'shipped' && isSweepingMark(updated, paid.length),
        }
      }),
      mark_total: history.total,
    }).toNextResponse()
  } catch (error) {
    log.error('이행 현황 조회 실패:', error)
    return ApiError.internalServerError('이행 현황을 불러오지 못했습니다.').toNextResponse()
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    // 본문을 먼저 끝까지 읽는다 — 상태를 읽은 뒤에 읽으면 본문이 도착하는
    // 시점을 요청자가 쥔다(개설자 이행 라우트와 같은 순서).
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const to = body.to
    if (!isFulfillmentStatus(to))
      return ApiError.badRequest('되돌릴 이행 상태가 올바르지 않습니다.').toNextResponse()
    const allowedFrom = allowedReversalSourcesFor(to)
    if (allowedFrom.length === 0) {
      return ApiError.badRequest(
        `'${FULFILLMENT_ORDER[0]}'보다 앞선 상태는 없습니다. 되돌릴 목표를 다시 골라 주세요.`
      ).toNextResponse()
    }

    if (!isFulfillmentReversalKind(body.kind)) {
      return ApiError.badRequest(
        '무슨 일이 있었는지 골라 주세요 — 엉뚱한 후원을 표시했거나, 실제로는 발송하지 않았거나.'
      ).toNextResponse()
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < FULFILLMENT_REVERSAL_REASON_MIN) {
      return ApiError.badRequest(
        `되돌리는 사유를 ${FULFILLMENT_REVERSAL_REASON_MIN}자 이상 적어 주세요. 이 문장이 기록에 그대로 남습니다.`
      ).toNextResponse()
    }

    const rawIds = Array.isArray(body.pledge_ids) ? body.pledge_ids : null
    const pledgeIds = [
      ...new Set((rawIds ?? []).filter((v): v is string => typeof v === 'string' && v.length > 0)),
    ]
    if (pledgeIds.length === 0)
      return ApiError.badRequest('되돌릴 후원을 하나 이상 골라 주세요.').toNextResponse()
    if (pledgeIds.length > MAX_BULK_RECIPIENTS)
      return ApiError.badRequest(
        `한 번에 ${MAX_BULK_RECIPIENTS}건까지 되돌릴 수 있습니다. 나누어 골라 주세요.`
      ).toNextResponse()

    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
    if (!isFulfillableCampaignStatus(campaign.status)) {
      return ApiError.badRequest(
        '후원을 받기 시작한 뒤부터 리워드 이행 상태를 되돌릴 수 있습니다.'
      ).toNextResponse()
    }

    // **두 번 나누어 쓴다.** 조건부 쓰기는 바뀐 뒤의 행을 돌려주므로 출발
    // 상태가 남지 않는다. 발송 경계를 거꾸로 넘는 출발 상태들과 나머지를
    // 갈라 두 번 쓰면, 어느 쪽에서 돌아온 행인지가 곧 출발 상태의 답이 된다
    // — 앞서 "보냈습니다"를 받은 사람이 누구인지가 그것으로 정해진다.
    const crossingFrom = allowedFrom.filter(from => crossesSentBoundaryBackward(from, to))
    const quietFrom = allowedFrom.filter(from => !crossesSentBoundaryBackward(from, to))
    const crossed = await advanceFulfillment({
      campaignId: id,
      pledgeIds,
      to,
      allowedFrom: crossingFrom,
    })
    const quiet = await advanceFulfillment({
      campaignId: id,
      pledgeIds,
      to,
      allowedFrom: quietFrom,
    })
    const updated = [...crossed, ...quiet]

    // 되돌리기는 자동 환불을 다시 열 수 있다 — 기록을 흘려보내지 않는다.
    const reopened = crossingFrom.some(from => reopensSelfCancel(from, to)) ? crossed.length : 0
    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'funding_fulfillment_updated',
        target_type: 'funding_campaign',
        target_id: id,
        metadata: {
          action: 'office_reversal',
          to,
          kind: body.kind,
          reason: reason.slice(0, FULFILLMENT_REVERSAL_REASON_MAX),
          requested: pledgeIds.length,
          updated: updated.length,
          reopened_self_cancel: reopened,
          pledge_codes: updated.slice(0, 50).map(p => p.pledge_code),
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (e) {
      logSecurityEvent(
        'FUNDING_FULFILLMENT_REVERSAL_AUDIT_FAILED',
        { campaignId: id, error: e instanceof Error ? e.message : String(e) },
        'high'
      )
      log.error('되돌리기 기록 실패', e)
    }

    // 앞서 "보냈습니다"를 받은 사람에게만 정정을 보낸다.
    if (crossed.length > 0) {
      const selfCancelReopened = reopened > 0
      after(() =>
        notifyFulfillmentReversed(
          campaign,
          crossed.map(p => ({ pledge: p, selfCancelReopened }))
        ).catch(e => log.error('되돌리기 알림 실패', e))
      )
    }

    if (updated.length !== pledgeIds.length) {
      // 움직인 것은 그대로 둔다 — 되돌리면 이미 나간 정정 안내와 어긋난다.
      return ApiError.conflict(
        `${pledgeIds.length}건 중 ${updated.length}건만 되돌렸습니다. 나머지는 그사이 상태가 바뀌었거나 결제가 남아 있지 않습니다. 새로고침한 뒤 다시 확인해 주세요.`
      ).toNextResponse()
    }

    return ApiSuccess.ok({
      updated: updated.length,
      reopened_self_cancel: reopened,
      pledges: updated.map(p => ({ id: p.id, fulfillment_status: p.fulfillment_status })),
    }).toNextResponse()
  } catch (error) {
    log.error('이행 되돌리기 실패:', error)
    return ApiError.internalServerError('이행 상태를 되돌리지 못했습니다.').toNextResponse()
  }
}
