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
import { holdPledge, RewardSoldOutError } from '@/db/queries/fundingPledges'
import { createPendingPayment } from '@/db/queries/payments'
import { PledgeAmountError, computePledgeTotal } from '@/lib/funding/amounts'
import { generateOrderId, buildCustomerKey } from '@/lib/payments/toss/protocol'
import { isPaymentEnabled, getPublicClientKey } from '@/lib/payments/toss/config'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/pledges/prepare')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FUNDING_TERMS_VERSION = '2026-09-21'

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function normalizePhone(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^0-9]/g, '') : ''
}

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled() || !(await isFundingEnabled())) {
      return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
    }
    // 선점은 돈 없이 재고를 줄인다. 429만 막고 503은 통과(티켓과 같은 이유).
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_prepare',
      windowMs: 60_000,
      maxRequests: 20,
      message: '후원 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      keyGenerator: createIPKeyGenerator('funding-prepare'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

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

    if (!campaignId || !rewardId) return ApiError.badRequest('리워드를 선택해 주세요.').toNextResponse()
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
      if (error instanceof PledgeAmountError) return ApiError.badRequest(error.message).toNextResponse()
      throw error
    }

    let shipping: { name: string; phone: string; postcode: string; address1: string; address2: string | null; memo: string | null } | null = null
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
      if (!shipping.phone || shipping.phone.length < 9 || !shipping.postcode || !shipping.address1) {
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
      })
    } catch (error) {
      if (error instanceof RewardSoldOutError) return ApiError.badRequest(error.message).toNextResponse()
      log.warn('후원 선점 실패', { rewardId, error: error instanceof Error ? error.message : error })
      return ApiError.serviceUnavailable('후원이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.').toNextResponse()
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
      customerKey: user ? buildCustomerKey(user.id) : `g_${String(pledge.id).replace(/-/g, '')}`.slice(0, 50),
      customerName: backerName,
      customerEmail: backerEmail,
    }).toNextResponse()
  } catch (error) {
    log.error('후원 준비 실패:', error)
    return ApiError.internalServerError('후원을 준비하지 못했습니다.').toNextResponse()
  }
}
