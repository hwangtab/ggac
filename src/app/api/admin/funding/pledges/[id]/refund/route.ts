/**
 * 사무국 대리 환불 — 후원자를 대신해 조합이 전액을 돌려준다.
 *
 * ## 이 라우트가 없던 동안 무슨 일이 있었나
 *
 * 저장소에서 후원을 환불하는 코드는 후원자 본인 취소 하나뿐이었다. 그 길은
 * 캠페인이 `active`이고 이행이 `none`일 때만 열린다. 그 밖의 경우 —— 마감된
 * 캠페인, 발송 완료로 잘못 표시된 후원, 자동 취소 조건을 지난 건 —— 에서
 * 사무국에게 남은 수단은 **토스 콘솔**뿐이었고, 콘솔에서 나간 환불은
 * `funding_pledges.status`에 닿지 않는다. 그러면 정산은 이미 돌려준 돈까지
 * 창작자에게 지급하라고 말한다. 원장이 모르는 환불이 생기는 것이 이 기능이
 * 막으려는 일이다.
 *
 * ## 무엇을 확인받고 무엇을 남기는가
 *
 * - **사유를 적어야 통과한다**(`normalizeOfficeRefundReason`). 되돌릴 수 없고
 *   진짜 돈이 움직이는 동작에서 "사무국이 환불했다"만 남는 기록은 기록이 아니다.
 * - **지급까지 끝난 정산서가 있으면 한 번 더 확인받는다**(`acknowledge_settled`).
 *   막지는 않는다 — 후원자에게 돌려줄 돈은 창작자에게 이미 보냈는지와 무관하게
 *   돌려줘야 한다. 다만 그 환불은 조합이 창작자에게서 되돌려 받아야 하는 돈을
 *   만들고, 그 사실은 누르기 전에 화면에 적혀야 한다(정산 라우트의
 *   `acknowledge_no_account`와 같은 모양).
 * - **활동 기록은 기다려서 남긴다.** 흘려보내면 함수가 얼어붙을 때 돈만 나가고
 *   기록이 사라진다. 실패하면 `logSecurityEvent`로 올린다 — 그래도 응답은
 *   성공이다(환불은 이미 나갔고, 그 사실을 감추는 답이 더 나쁘다).
 *
 * ## 읽은 상태에 조건을 건다
 *
 * 상태를 읽고 나서 쓰지 않는다. 선점(`claimPledgeForCancel`)이 `status='paid'`를
 * WHERE에 걸고, 0행이면 그사이 다른 곳에서 움직인 것이므로 409로 답한다 —
 * 이 기능에서 네 번 확립된 모양이다.
 *
 * ## 트랜잭션은 토스 호출을 감싸지 않는다
 *
 * 이 라우트는 트랜잭션을 열지 않는다. 여는 것은 `finalizePledgeRefund` 하나이고
 * 그것은 토스 응답이 돌아온 **뒤에** 불린다(`@/lib/server/officeRefund`).
 */
import { NextRequest, NextResponse, after } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getCampaignById } from '@/db/queries/funding'
import { getPledgeById } from '@/db/queries/fundingPledges'
import { getPaymentById } from '@/db/queries/payments'
import { getSettlementByCampaign } from '@/db/queries/fundingSettlements'
import { logUserActivity } from '@/db/queries/activities'
import {
  normalizeOfficeRefundReason,
  officeRefundNeedsSettledAck,
  planOfficeRefund,
  OFFICE_REFUND_REASON_MIN,
} from '@/lib/funding/officeRefund'
import { refundPledgeAsOffice } from '@/lib/server/officeRefund'
import { notifyOfficeRefunded } from '@/lib/funding/notifyOfficeRemedy'
import { notifyRefundAfterPayout } from '@/lib/funding/notify'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/funding/refund')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 토스 취소는 최대 60초까지 걸린다(`toss/client.ts`). 그 뒤 원장·기록이 남는다. */
export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 사무국의 뒷정리는 **스위치를 보지 않는다.** 스위치를 내리는 것은 "새
  // 프로젝트를 열고 새 결제를 받는 일을 멈춘다"는 뜻이지, 이미 받은 돈을
  // 돌려주지도 정산하지도 못하게 만든다는 뜻이 아니다. 여기를 막으면 펀딩을
  // 잠시 멈춘 날 환불 요청이 들어와도 사무국에게 남는 수단이 토스 콘솔뿐이
  // 되고, 콘솔에서 나간 환불은 원장이 모른다 — 이 기능이 막으려던 바로 그
  // 일이다. 공개 경로(개설·후원·결제 확정·심사 승인)는 그대로 막힌다.
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  // 결제 스위치는 인증 뒤에 본다 — 비인증 요청이 401 대신 503을 받으면
  // "인증을 확인하지 않고 막았다"는 착시가 된다(`e2e/authz-funding.spec.ts`).
  if (!isPaymentEnabled())
    return ApiError.serviceUnavailable('결제 기능을 준비 중입니다.').toNextResponse()

  const { id } = await params
  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    const reason = normalizeOfficeRefundReason(body.reason)
    if (reason === null) {
      return ApiError.badRequest(
        `환불 사유를 ${OFFICE_REFUND_REASON_MIN}자 이상 적어 주세요. 이 문장이 환불 기록에 그대로 남습니다.`
      ).toNextResponse()
    }

    const pledge = await getPledgeById(id)
    if (!pledge) return ApiError.notFound('후원 내역을 찾을 수 없습니다.').toNextResponse()
    const payment = pledge.payment_id ? await getPaymentById(String(pledge.payment_id)) : null
    const plan = planOfficeRefund(pledge, payment)
    if (plan.ok === false) {
      if (plan.reason === 'already_refunded')
        return ApiError.conflict(plan.message).toNextResponse()
      return ApiError.badRequest(plan.message).toNextResponse()
    }

    const campaignId = String(pledge.campaign_id)
    const settlementBefore = await getSettlementByCampaign(campaignId)
    const settledAck = officeRefundNeedsSettledAck(settlementBefore)
    if (settledAck && body.acknowledge_settled !== true) {
      const payout = Number(settlementBefore?.payout_amount ?? 0).toLocaleString('ko-KR')
      return ApiError.conflict(
        `이 프로젝트는 정산금 ${payout}원이 이미 지급됐습니다. 지금 환불하면 그 금액을 개설자에게서 되돌려 받아야 합니다. 그래도 진행하려면 한 번 더 확인해 주세요.`
      ).toNextResponse()
    }

    const campaign = await getCampaignById(campaignId)
    const { secretKey } = getServerPaymentConfig()
    const outcome = await refundPledgeAsOffice({
      pledgeId: String(pledge.id),
      paymentId: String(payment.id),
      paymentKey: String(payment.payment_key),
      orderId: String(payment.order_id),
      amount: plan.amount,
      retry: plan.retry,
      secretKey,
      actorId: auth.user.id,
      // 위에서 읽은 정산 상태는 선점 전의 것이다. 그 읽기와 선점 사이에 다른
      // 관리자가 `mark_paid`를 눌렀으면, 지급된 정산서가 이 환불을 모른 채
      // 굳는다 — `isBasisStale`은 지급된 정산서를 다시 보지 않는다. 선점이
      // 들어간 뒤 다시 읽어, 그새 지급됐고 확인도 없었으면 돈을 보내기 전에
      // 멈춘다. 이 검사를 지난 뒤로는 창이 없다: 선점된 후원은 정산
      // 재계산이 환불로 세므로 `mark_paid`가 낡은 근거로 스스로 409를 낸다.
      afterClaim: async () => {
        if (settledAck || body.acknowledge_settled === true) return { proceed: true }
        const now = await getSettlementByCampaign(campaignId)
        if (officeRefundNeedsSettledAck(now) === false) return { proceed: true }
        const payout = Number(now?.payout_amount ?? 0).toLocaleString('ko-KR')
        return {
          proceed: false,
          message: `확인하는 사이에 이 프로젝트의 정산금 ${payout}원이 지급됐습니다. 지금 환불하면 그 금액을 개설자에게서 되돌려 받아야 합니다. 그래도 진행하려면 한 번 더 확인해 주세요.`,
        }
      },
    })

    if (outcome.ok === false) {
      if (outcome.reason === 'claim_lost') {
        return ApiError.conflict(
          '그사이 이 후원의 상태가 바뀌었습니다. 새로고침한 뒤 다시 확인해 주세요.'
        ).toNextResponse()
      }
      if (outcome.reason === 'stopped_after_claim') {
        // 돈은 나가지 않았고 선점은 되돌렸다. 관리자가 확인란을 켜고 다시 누른다.
        return ApiError.conflict(outcome.message).toNextResponse()
      }
      if (outcome.reason === 'lookup') {
        log.error('환불 판단 불가 — canceled 유지', { pledgeId: pledge.id })
        return ApiError.serviceUnavailable(
          '환불 결과를 확인하지 못했습니다. 토스 거래 내역을 확인한 뒤 같은 버튼을 다시 눌러 주세요. 이미 환불됐다면 그대로 기록만 맞춰집니다.'
        ).toNextResponse()
      }
      if (outcome.reason === 'rejected') {
        log.warn('환불 거절', { pledgeId: pledge.id, message: outcome.message })
        return ApiError.badRequest(
          `토스가 환불을 거절했습니다. (${outcome.message})`
        ).toNextResponse()
      }
      // 돈은 나갔는데 원장이 못 따라왔다. 손으로 고쳐야 하므로 시끄럽게 남긴다.
      logSecurityEvent(
        'FUNDING_OFFICE_REFUND_LEDGER_FAILED',
        { pledgeId: String(pledge.id), campaignId, detail: outcome.detail },
        'high'
      )
      log.error('환불 기록 실패 — 수동 처리 필요', { pledgeId: pledge.id, detail: outcome.detail })
      return ApiError.internalServerError(
        '환불은 처리됐으나 상태를 갱신하지 못했습니다. 즉시 사무국 담당자에게 알려 주세요.'
      ).toNextResponse()
    }

    // **후원자 통지를 먼저 예약한다.** 아래로는 기록·정산 재조회가 이어지고,
    // 그중 하나가 던지면 바깥 catch가 500을 만들어 `after()`까지 가지 못한다 —
    // 돈은 이미 나갔는데 후원자는 아무 말도 못 듣는 상태다. 예약 자체는
    // 아무것도 부르지 않으므로(응답 뒤에 돈다) 여기 두어도 순서가 흐트러지지
    // 않는다.
    after(() =>
      notifyOfficeRefunded(outcome.pledge, campaign).catch(e => log.error('환불 알림 실패', e))
    )

    // 기록은 기다린다 — 이 한 줄이 "누가 왜 남의 결제를 돌려줬는가"의 전부다.
    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'funding_pledge_canceled',
        target_type: 'funding_pledge',
        target_id: String(pledge.id),
        metadata: {
          action: 'office_refund',
          campaign_id: campaignId,
          campaign_status: campaign?.status ?? null,
          pledge_code: pledge.pledge_code ?? null,
          refund_amount: outcome.amount,
          // 후원자가 스스로 할 수 없었던 이유가 무엇이었는지 — 되짚을 때
          // 가장 먼저 보게 되는 두 값이다.
          fulfillment_status: pledge.fulfillment_status ?? null,
          settlement_status: settlementBefore?.status ?? null,
          acknowledged_settled_payout: settledAck,
          reason,
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (e) {
      logSecurityEvent(
        'FUNDING_OFFICE_REFUND_AUDIT_FAILED',
        {
          pledgeId: String(pledge.id),
          campaignId,
          error: e instanceof Error ? e.message : String(e),
        },
        'high'
      )
      log.error('사무국 환불 기록 실패', e)
    }

    // 확인을 받지 않고 지나왔는데 그사이 지급이 끝났다면, 정산서는 환불 전
    // 숫자로 굳었고 아무도 눈치채지 못한다(`isBasisStale`은 지급된 정산서를
    // 대조하지 않는다). 좁은 창이지만 조용히 지나가게 두지 않는다.
    let afterPayout = settledAck
    if (settledAck === false) {
      // **이 읽기가 실패해도 500으로 답하지 않는다.** 환불은 이미 나갔고,
      // 돈이 움직인 요청에 "환불을 처리하지 못했습니다"라고 답하는 것은
      // 거짓말이다(활동 기록 실패와 같은 판단). 무엇을 확인하지 못했는지만
      // 시끄럽게 남긴다.
      try {
        const settlementAfter = await getSettlementByCampaign(campaignId)
        if (settlementAfter?.status === 'paid') {
          afterPayout = true
          logSecurityEvent(
            'FUNDING_OFFICE_REFUND_AFTER_PAYOUT',
            { pledgeId: String(pledge.id), campaignId, refundAmount: outcome.amount },
            'high'
          )
        }
      } catch (e) {
        logSecurityEvent(
          'FUNDING_OFFICE_REFUND_AFTER_PAYOUT',
          {
            pledgeId: String(pledge.id),
            campaignId,
            refundAmount: outcome.amount,
            settlementLookupFailed: true,
            error: e instanceof Error ? e.message : String(e),
          },
          'high'
        )
        log.error('환불 뒤 정산 상태를 확인하지 못했다', e)
      }
    }

    // 지급까지 끝난 정산의 캠페인이었다면 개설자도 알아야 한다 — 이미 받은
    // 정산금 안에 방금 돌려준 돈이 들어 있다. 여기서 알리지 않으면 되돌려
    // 받아야 한다는 사실을 나중에 전화로 처음 듣게 된다. 막는 것은 아무것도
    // 바뀌지 않는다(확인 절차는 그대로다).
    if (afterPayout) {
      after(() =>
        notifyRefundAfterPayout(campaign, outcome.pledge).catch(e =>
          log.error('지급 뒤 환불 알림 실패', e)
        )
      )
    }

    log.info('사무국 대리 환불', { pledgeId: pledge.id, refundAmount: outcome.amount })
    return ApiSuccess.ok({
      refunded: true,
      refund_amount: outcome.amount,
      pledge_code: outcome.pledge.pledge_code,
      status: outcome.pledge.status,
    }).toNextResponse()
  } catch (error) {
    log.error('사무국 환불 실패:', error)
    return ApiError.internalServerError('환불을 처리하지 못했습니다.').toNextResponse()
  }
}
