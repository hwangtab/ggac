/**
 * 후원자 본인 취소(전액). 캠페인이 active이고 배송 전일 때만.
 * 회원은 세션, 비회원은 후원번호+이메일로 본인 확인.
 * 순서: 후원 선점(paid→canceled) → 토스 환불 → 원장·후원 refunded.
 *
 * 환불 요청이 판단 불가(TossLookupError)로 끝나면 선점은 `canceled`로 남긴
 * 채 503을 돌려준다 — 이 상태를 쓸어가는 크론은 없다(만료 스윕은 `pending`만
 * 본다). 대신 이 라우트 자신이 재시도를 받는다: `canceled`이면서 결제
 * 연결(`payment_id`)이 남아 있는 후원은 이미 선점된 것으로 보고 선점 단계를
 * 건너뛰어 환불 요청부터 다시 시작한다. 그사이 실제로 환불이 나갔었다면
 * 토스 클라이언트가 "이미 취소됨"을 성공으로 바꿔 주므로 재시도는 그대로
 * 끝까지 간다.
 */
import { NextRequest, after } from 'next/server'

import { getOptionalUser } from '@/lib/server/memberAuth'
import { notifyPledgeSelfCanceled } from '@/lib/funding/notify'
import { getCampaignById } from '@/db/queries/funding'
import {
  getPledgeById,
  getPledgeByCodeAndEmail,
  claimPledgeForCancel,
  revertPledgeCancel,
  finalizePledgeRefund,
  PartialRefundUnsupportedError,
} from '@/db/queries/fundingPledges'
import { getPaymentById } from '@/db/queries/payments'
import { canViewPledge } from '@/lib/server/fundingAuth'
import { isPledgeCode } from '@/lib/funding/pledgeCode'
import { cancelPayment, TossApiError, TossLookupError } from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/pledges/cancel')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled())
      return ApiError.serviceUnavailable('결제 기능을 준비 중입니다.').toNextResponse()

    // 번호+이메일 추측을 막는다.
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_cancel',
      windowMs: 60_000,
      maxRequests: 10,
      message: '요청이 너무 잦습니다.',
      keyGenerator: createIPKeyGenerator('funding-cancel'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const user = await getOptionalUser()
    let pledge: Record<string, unknown> | null = null
    if (typeof body.pledgeId === 'string' && user) {
      const found = await getPledgeById(body.pledgeId)
      if (found && canViewPledge(user.id, found as { user_id: string | null })) pledge = found
    } else if (isPledgeCode(body.pledgeCode) && typeof body.email === 'string') {
      const found = await getPledgeByCodeAndEmail(body.pledgeCode, body.email.trim())
      // **번호+이메일은 인증할 수 없는 사람을 위한 길이지, 인증할 수 있는
      // 사람에게 열린 두 번째 문이 아니다.**
      //
      // 임자(`user_id`)가 있는 후원은 세션이 그 임자일 때만 지난다. 이 조건이
      // 없으면 위 `canViewPledge`가 아무것도 지키지 못한다 — 회원 후원의
      // 번호와 이메일을 아는 사람이 `pledgeId` 대신 그 둘을 보내 이 갈래로
      // 우회하면 그만이기 때문이다. 그리고 그 둘을 **함께 받는 사람**이
      // 실제로 있었다: 캠페인 개설자 화면이 결제 완료 후원의 번호를 전부
      // 주고, 배송 리워드면 이메일까지 줬다(그쪽도 이번에 이메일을 뺐다 —
      // `src/app/api/mypage/funding/campaigns/[id]/route.ts`). 한쪽만 고치면
      // 다른 쪽이 그대로 문이 된다.
      //
      // 임자가 없는 후원(비회원 후원)은 그대로 지난다 — 이 경로가 원래
      // 만들어진 경우다.
      const owned = (found as { user_id: string | null } | null)?.user_id ?? null
      if (found && (owned === null || canViewPledge(user?.id ?? null, { user_id: owned })))
        pledge = found
    }
    // 못 찾음과 남의 것을 구분하지 않는다 — 번호 존재 여부가 새면 추측이 쉬워진다.
    if (!pledge) return ApiError.notFound('후원 내역을 찾을 수 없습니다.').toNextResponse()

    // canceled이면서 결제 연결이 남아 있으면, 이전 요청이 선점까지 마치고
    // 환불에서 판단 불가로 끝난 재시도 건이다 — 아래에서 선점을 건너뛰고
    // 환불부터 다시 시작한다. `refunded`는 이미 끝난 건이므로 따로 안내한다.
    const isRetry = pledge.status === 'canceled' && Boolean(pledge.payment_id)
    if (pledge.status !== 'paid' && !isRetry) {
      return ApiError.badRequest(
        pledge.status === 'refunded' ? '이미 취소된 후원입니다.' : '취소할 수 있는 후원이 아닙니다.'
      ).toNextResponse()
    }

    // 재시도 건은 이 판정을 이전 요청에서 이미 통과했다. 그사이 캠페인이
    // 마감되거나 배송이 시작됐다는 이유로 다시 걸면, 실제로 나갔을 수도 있는
    // 환불을 기록하지 못한 채 후원만 영영 canceled로 남는다.
    if (!isRetry) {
      const campaign = await getCampaignById(String(pledge.campaign_id))
      if (!campaign || campaign.status !== 'active') {
        return ApiError.badRequest(
          '마감된 프로젝트의 후원은 사무국(contact@ggac.kr)으로 문의해 주세요.'
        ).toNextResponse()
      }
      if (pledge.fulfillment_status !== 'none') {
        return ApiError.badRequest(
          '리워드 준비가 시작된 후원은 사무국으로 문의해 주세요.'
        ).toNextResponse()
      }
    }
    const payment = pledge.payment_id ? await getPaymentById(String(pledge.payment_id)) : null
    if (!payment?.payment_key) {
      log.error('결제 연결이 없는 후원의 취소 요청', { pledgeId: pledge.id })
      return ApiError.badRequest(
        '결제 정보를 확인할 수 없습니다. 사무국으로 문의해 주세요.'
      ).toNextResponse()
    }

    // 1) 선점. 재시도 건은 이전 요청이 이미 선점해 두었으므로 건너뛴다.
    //    0행(신규 선점 실패)이면 다른 요청이 이미 잡았다.
    if (!isRetry) {
      const claimed = await claimPledgeForCancel(String(pledge.id), {
        requireFulfillmentNone: true,
      })
      if (!claimed) return ApiError.badRequest('이미 처리 중인 후원입니다.').toNextResponse()
    }

    const { secretKey } = getServerPaymentConfig()
    const refundAmount = Number(payment.amount)
    // 2) 환불.
    try {
      await cancelPayment(
        String(payment.payment_key),
        { orderId: String(payment.order_id), cancelReason: '후원자 취소' },
        { secretKey }
      )
    } catch (error) {
      if (error instanceof TossLookupError) {
        // 환불됐는지 모른다. canceled로 둔 채 그대로 돌려보낸다 — 후원자가
        // 다시 취소를 요청하면 위 isRetry 분기가 선점을 건너뛰고 이 환불
        // 요청부터 다시 시도한다.
        log.error('환불 판단 불가 — canceled 유지', { pledgeId: pledge.id, message: error.message })
        return ApiError.serviceUnavailable(
          '환불 처리를 확인하는 중입니다. 잠시 후 후원 내역을 다시 확인해 주세요.'
        ).toNextResponse()
      }
      if (error instanceof TossApiError) {
        if (error.code === 'ALREADY_CANCELED_PAYMENT') {
          // 토스 클라이언트(cancelPayment)가 이 코드를 응답 성공으로 바꿔서
          // 돌려주므로 여기로는 실제로 오지 않는다 — 클라이언트 동작이 바뀔
          // 경우에 대비한 안전망일 뿐이다.
        } else {
          await revertPledgeCancel(String(pledge.id))
          log.warn('환불 거절', { pledgeId: pledge.id, code: error.code })
          return ApiError.badRequest(
            `환불에 실패했습니다. 사무국으로 문의해 주세요. (${error.message})`
          ).toNextResponse()
        }
      } else {
        throw error
      }
    }

    // 3) 원장·후원. 이 시점이면 토스 환불은 이미 나갔거나(성공) 이미 취소된
    // 상태로 확인됐다 — 아래에서 무슨 일이 나든 되돌릴 수 없는 돈이다.
    let refunded
    try {
      refunded = await finalizePledgeRefund({
        orderId: String(payment.order_id),
        paymentId: String(payment.id),
        pledgeId: String(pledge.id),
        canceledAmount: refundAmount,
        raw: { canceledBy: user ? 'member' : 'guest' },
      })
    } catch (error) {
      if (error instanceof PartialRefundUnsupportedError) {
        // 확정(confirm) 단계가 결제·후원 금액을 같게 만들어 이 갈림길은
        // 정상적으로는 열리지 않는다. 그래도 열렸다면 환불은 이미 나간
        // 뒤이므로, 일반 500("취소하지 못했습니다")으로 답하면 실제와
        // 반대되는 안내가 된다 — 위 "기록 실패" 분기와 같은 모양으로 답한다.
        log.error('환불 기록 실패(부분 환불 불일치) — 수동 처리 필요', {
          pledgeId: pledge.id,
          totalAmount: error.totalAmount,
          canceledAmount: error.canceledAmount,
        })
        return ApiError.internalServerError(
          '환불은 처리됐으나 상태를 갱신하지 못했습니다. 사무국으로 문의해 주세요.'
        ).toNextResponse()
      }
      throw error
    }
    if (!refunded) {
      log.error('환불 기록 실패 — 수동 처리 필요', { pledgeId: pledge.id })
      return ApiError.internalServerError(
        '환불은 처리됐으나 상태를 갱신하지 못했습니다. 사무국으로 문의해 주세요.'
      ).toNextResponse()
    }

    // 돈은 돌아갔다. 지금까지 이 경로는 **아무에게도 말하지 않았다** —
    // 후원자는 화면에서 한 번 본 것이 전부라 통장에 언제 들어오는지 모르고,
    // 개설자는 모인 금액이 줄어든 것을 설명 없이 목록에서 발견한다.
    // 응답 뒤에 보낸다: 맨 promise로 두면 응답과 함께 함수가 얼어 통지가
    // 통째로 사라진다(확정 라우트와 같은 모양).
    after(() => notifyPledgeSelfCanceled(refunded).catch(e => log.error('후원 취소 알림 실패', e)))

    log.info('후원 취소', { pledgeId: pledge.id, refundAmount })
    return ApiSuccess.ok({
      canceled: true,
      refundAmount,
      pledgeCode: refunded.pledge_code,
    }).toNextResponse()
  } catch (error) {
    log.error('후원 취소 실패:', error)
    return ApiError.internalServerError('후원을 취소하지 못했습니다.').toNextResponse()
  }
}
