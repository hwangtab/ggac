/**
 * 후원 준비 — 재고를 먼저 잡고 결제창을 연다. 티켓 `prepare`와 같은 순서.
 * 금액은 서버가 계산한다(`computePledgeTotal`). 클라이언트 금액은 받지 않는다.
 *
 * 여기서 하는 사전 계산은 **사용자에게 보여줄 검증 오류**를 만들기 위해서일
 * 뿐이다. 결제 원장에 넘기는 금액과 응답에 싣는 금액은 `holdPledge`가 자기
 * 트랜잭션 안에서 다시 읽은 리워드로 계산해 선점 행에 새긴 값을 쓴다 —
 * 두 번 읽는 사이에 리워드 가격이 바뀌어도 결제 승인 단계의 금액 대조가
 * 어긋나지 않는다.
 */
import { NextRequest } from 'next/server'

import { getOptionalUser } from '@/lib/server/memberAuth'
import { getCampaignById, getReward } from '@/db/queries/funding'
import {
  holdPledge,
  RewardSoldOutError,
  TooManyPendingHoldsError,
} from '@/db/queries/fundingPledges'
import { createPendingPayment } from '@/db/queries/payments'
import { PledgeAmountError, computePledgeTotal } from '@/lib/funding/amounts'
import { generateOrderId, buildCustomerKey } from '@/lib/payments/toss/protocol'
import { isPaymentEnabled, getPublicClientKey } from '@/lib/payments/toss/config'
import { getFundingSettings } from '@/lib/funding/settings'
import { FUNDING_TERMS_REVISION } from '@/lib/funding/terms'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/pledges/prepare')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 동의 기록에 남길 판본 — 후원자가 실제로 본 문서(`/funding/terms`)의
// 시행일과 같은 상수를 읽는다.
const FUNDING_TERMS_VERSION = FUNDING_TERMS_REVISION

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function normalizePhone(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^0-9]/g, '') : ''
}

export async function POST(request: NextRequest) {
  try {
    const fundingSettings = await getFundingSettings()
    if (!isPaymentEnabled() || !fundingSettings.enabled) {
      return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
    }
    // 선점은 돈 없이 재고를 줄인다. 429만 막고 503은 통과(티켓과 같은 이유).
    //
    // 빈도 제한만으로는 재고를 지키지 못한다 — 분산 환경에서 Upstash 설정이
    // 없으면 인스턴스별 메모리로 떨어지고, 애초에 "얼마나 자주 묻는가"는
    // "동시에 얼마나 쥐고 있는가"와 다른 값이다. 실제 경계는 선점
    // 트랜잭션(`holdPledge`)이 신원별로 DB에서 거는 상한이고, 아래 둘은 그
    // 앞에서 요청 수 자체를 줄이는 역할이다.
    //
    // 짧은 창(1분)은 순간 폭주만 깎는다. 아래 긴 창과 같은 비율(분당 120건)로
    // 두어 이쪽이 먼저 걸리는 일이 없게 한다 — 두 값이 어긋나면 긴 창을
    // 넉넉히 잡아도 실제로 후원자를 막는 것은 이쪽이 된다.
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_prepare',
      windowMs: 60_000,
      maxRequests: 120,
      message:
        '같은 인터넷 회선에서 후원 요청이 한꺼번에 몰려 잠시 접수를 멈췄습니다. 1분 뒤에 다시 후원해 주세요.',
      keyGenerator: createIPKeyGenerator('funding-prepare'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

    // 선점 한 벌이 살아 있는 시간(hold_minutes)을 창으로 잡는다 — 같은 곳에서
    // 신원만 갈아 가며 선점을 쌓는 경우를 이 창 안에서 묶어 준다.
    //
    // **상한이 200인 이유.** 이 열쇠는 IP다. 한국 이동통신 3사는 CGNAT를
    // 폭넓게 쓰고, 조합의 공개 행사는 사무실 회선 하나에서 돈다 — 열 명이
    // 넘는 순간 막히는 값이면 막히는 사람은 공격자가 아니라 오픈 당일
    // 피크의 열한 번째 후원자다. 그 자리가 이 프로젝트에서 가장 비싼 10분이다.
    // 반대쪽을 보면, 같은 창에서 이 값을 낮게 유지해 얻는 것은 크지 않다:
    // 이 제한은 Upstash 설정이 없으면 인스턴스별 메모리로 떨어져 Vercel에서는
    // 사실상 0이고, 열쇠도 요청자가 고를 수 있는 `x-forwarded-for` 첫 홉이며,
    // 진짜로 재고를 지키는 것은 DB 트랜잭션 안의 신원별 상한이다. 그래서
    // 이것은 **재고 방어선이 아니라 폭주 완충**으로 보고, 한 회선 뒤의 군중이
    // 걸리지 않을 만큼 넉넉히(10분에 200건 = 초당 0.33건) 잡는다.
    const holdWindow = await applyRouteRateLimit(request, {
      name: 'funding_prepare_holds',
      windowMs: fundingSettings.hold_minutes * 60_000,
      maxRequests: 200,
      message:
        '같은 인터넷 회선에서 후원 요청이 한꺼번에 몰려 잠시 접수를 멈췄습니다. 1~2분 뒤에 다시 후원해 주세요. 계속 막히면 휴대전화 데이터로 바꿔 접속하시거나 사무국(contact@ggac.kr)으로 알려 주시면 바로 도와드리겠습니다.',
      keyGenerator: createIPKeyGenerator('funding-prepare-holds'),
    })
    if (!holdWindow.success && holdWindow.response?.status === 429) return holdWindow.response

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const campaignId = str(body.campaignId, 64)
    const rewardId = str(body.rewardId, 64)
    const quantity = Number(body.quantity)
    const additionalAmount = Number(body.additionalAmount ?? 0)
    const backerName = str(body.backerName, 50)
    const backerEmail = str(body.backerEmail, 254)
    const backerPhone = normalizePhone(body.backerPhone)
    const supporterMessage = str(body.supporterMessage, 300) || null
    const agreedTerms = body.agreedTerms === true
    const agreedPrivacy = body.agreedPrivacy === true

    if (!campaignId || !rewardId)
      return ApiError.badRequest('리워드를 선택해 주세요.').toNextResponse()
    if (!backerName) return ApiError.badRequest('이름을 입력해 주세요.').toNextResponse()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backerEmail)) {
      return ApiError.badRequest('이메일을 정확히 입력해 주세요.').toNextResponse()
    }
    if (!agreedTerms || !agreedPrivacy) {
      return ApiError.badRequest('약관과 개인정보 처리에 동의해 주세요.').toNextResponse()
    }

    const [campaign, reward] = await Promise.all([getCampaignById(campaignId), getReward(rewardId)])
    if (!campaign || !reward || reward.campaign_id !== campaign.id) {
      return ApiError.badRequest('리워드가 올바르지 않습니다.').toNextResponse()
    }
    // 공개 목록은 active만 내보내지만 id를 아는 사람은 여기로 바로 온다.
    if (campaign.status !== 'active') {
      return ApiError.badRequest('지금은 후원할 수 없는 프로젝트입니다.').toNextResponse()
    }

    // 사용자에게 보여줄 검증 오류만 여기서 만든다. 실제로 쓰이는 금액은
    // 선점 트랜잭션이 다시 계산해 pledge에 새긴 값이다(아래 totalAmount 참고).
    try {
      computePledgeTotal({ unitAmount: Number(reward.amount), quantity, additionalAmount })
    } catch (error) {
      if (error instanceof PledgeAmountError)
        return ApiError.badRequest(error.message).toNextResponse()
      throw error
    }

    let shipping: {
      name: string
      phone: string
      postcode: string
      address1: string
      address2: string | null
      memo: string | null
    } | null = null
    if (reward.requires_shipping) {
      const s = (body.shipping ?? {}) as Record<string, unknown>
      shipping = {
        name: str(s.name, 50) || backerName,
        phone: normalizePhone(s.phone) || backerPhone,
        postcode: str(s.postcode, 10),
        address1: str(s.address1, 200),
        address2: str(s.address2, 200) || null,
        memo: str(s.memo, 200) || null,
      }
      if (
        !shipping.phone ||
        shipping.phone.length < 9 ||
        !shipping.postcode ||
        !shipping.address1
      ) {
        return ApiError.badRequest('배송지를 정확히 입력해 주세요.').toNextResponse()
      }
    }

    const user = await getOptionalUser()
    const orderId = generateOrderId('funding')

    let pledge
    try {
      pledge = await holdPledge({
        order_id: orderId,
        campaign_id: String(campaign.id),
        reward_id: String(reward.id),
        user_id: user?.id ?? null,
        quantity,
        additional_amount: additionalAmount,
        backer_name: backerName,
        backer_email: backerEmail,
        backer_phone: backerPhone || null,
        is_anonymous: body.isAnonymous === true,
        supporter_message: supporterMessage,
        message_public: body.messagePublic === true,
        shipping,
        terms_version: FUNDING_TERMS_VERSION,
        hold_minutes: fundingSettings.hold_minutes,
      })
    } catch (error) {
      if (error instanceof RewardSoldOutError)
        return ApiError.badRequest(error.message).toNextResponse()
      // 한 신원이 결제 없이 선점만 쌓는 것을 막은 경우. 사용자가 할 수 있는
      // 일이 문구에 들어 있으므로 그대로 보인다.
      if (error instanceof TooManyPendingHoldsError)
        return ApiError.badRequest(error.message).toNextResponse()
      log.warn('후원 선점 실패', {
        rewardId,
        error: error instanceof Error ? error.message : error,
      })
      return ApiError.serviceUnavailable(
        '후원이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.'
      ).toNextResponse()
    }

    // 결제 원장·응답에는 pledge 자신이 트랜잭션 안에서 계산해 저장한 금액을
    // 쓴다. 위 사전 계산은 검증 오류를 빨리 돌려주기 위한 것일 뿐, 값의 출처는
    // 아니다 — 두 계산 사이 리워드 가격이 바뀌어도 confirm의 금액 대조가
    // 항상 이 pledge 자신의 총액과 맞는다.
    const totalAmount = Number(pledge.total_amount)

    const orderName = `${String(campaign.title).slice(0, 30)} · ${String(reward.title).slice(0, 20)} ${quantity}개`
    await createPendingPayment({
      orderId,
      userId: user?.id ?? null,
      kind: 'funding',
      orderName,
      amount: totalAmount,
      payerName: backerName,
      payerEmail: backerEmail,
    })

    log.info('후원 준비', { campaignId, pledgeId: pledge.id, orderId })
    return ApiSuccess.ok({
      orderId,
      orderName,
      amount: totalAmount,
      pledgeId: pledge.id,
      pledgeCode: pledge.pledge_code,
      holdExpiresAt: pledge.hold_expires_at,
      clientKey: getPublicClientKey(),
      customerKey: user
        ? buildCustomerKey(user.id)
        : `g_${String(pledge.id).replace(/-/g, '')}`.slice(0, 50),
      customerName: backerName,
      customerEmail: backerEmail,
    }).toNextResponse()
  } catch (error) {
    log.error('후원 준비 실패:', error)
    return ApiError.internalServerError('후원을 준비하지 못했습니다.').toNextResponse()
  }
}
