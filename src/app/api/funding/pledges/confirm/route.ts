/**
 * 후원 결제 승인 확정. 티켓 `confirm`과 같은 규칙 — 금액은 원장과 대조하고,
 * 토스에는 저장값을 넘기며, 판단할 수 없는 실패는 실패로 확정하지 않는다.
 * 주문과 후원의 짝은 아직 확정 전이면 선점 때 새긴 `order_id`로, 이미
 * 확정된 뒤(재시도)라면 확정 때 새긴 `payment_id`로 본다 — 아래 두 검사가
 * 각각 그 역할이다.
 */
import { NextRequest, after } from 'next/server'

import { getPaymentByOrderId, markPaymentFailed, recordPaymentKey } from '@/db/queries/payments'
import { getPledgeById, finalizePledgePayment, cancelPendingPledge } from '@/db/queries/fundingPledges'
import { getCampaignById } from '@/db/queries/funding'
import { assertAmountMatches, AmountMismatchError } from '@/lib/payments/toss/protocol'
import { confirmPayment, cancelPayment, lookupPayment, TossApiError, TossLookupError } from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { notifyPledgePaid } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/pledges/confirm')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled()) return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    const paymentKey = typeof body.paymentKey === 'string' ? body.paymentKey : ''
    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    const pledgeId = typeof body.pledgeId === 'string' ? body.pledgeId : ''
    if (!paymentKey || !orderId || !pledgeId) return ApiError.badRequest('결제 정보가 올바르지 않습니다.').toNextResponse()

    // 여기서 막힌 사람은 이미 카드가 긁힌 상태다. 429만 막는다.
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_confirm', windowMs: 60_000, maxRequests: 20,
      message: '결제 확인 요청이 너무 잦습니다.',
      keyGenerator: createIPKeyGenerator('funding-confirm'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

    const [payment, pledge] = await Promise.all([getPaymentByOrderId(orderId), getPledgeById(pledgeId)])
    if (!payment) return ApiError.notFound('결제 내역을 찾을 수 없습니다.').toNextResponse()
    if (!pledge) return ApiError.notFound('후원 내역을 찾을 수 없습니다.').toNextResponse()

    // 새로고침 멱등. 짝은 payment_id로 본다.
    if (payment.status === 'done' && pledge.status === 'paid' && pledge.payment_id === payment.id) {
      return ApiSuccess.ok({ orderId, pledgeCode: pledge.pledge_code, amount: payment.amount }).toNextResponse()
    }

    if (pledge.order_id !== orderId) {
      log.error('후원·결제 불일치', { orderId, pledgeId })
      return ApiError.badRequest('결제 정보와 후원 정보가 일치하지 않습니다.').toNextResponse()
    }
    if (Number(pledge.total_amount) !== Number(payment.amount)) {
      log.error('후원 금액과 주문 금액 불일치', { orderId })
      return ApiError.badRequest('결제 금액을 확인할 수 없습니다. 사무국으로 문의해 주세요.').toNextResponse()
    }
    if (pledge.status === 'expired' || pledge.status === 'canceled') {
      await markPaymentFailed(orderId, { code: 'PLEDGE_EXPIRED', message: '결제 시간이 지나 후원이 취소되었습니다.' })
      return ApiError.badRequest('결제 시간이 지났습니다. 다시 후원해 주세요.').toNextResponse()
    }

    // 선점 상태는 아직 'pending'이어도 hold가 지났으면 만료 크론 눈에는 이미
    // 재고 계산에서 빠진 후원이다. 이 창에서 다른 사람이 마지막 한 개를
    // 선점해 결제까지 끝낼 수 있으므로, 승인 요청을 보내기 전에 여기서도
    // 같은 판정을 한다 — 돈이 나가기 전에 막아야 의미가 있다.
    const holdExpiresAt = pledge.hold_expires_at ? new Date(String(pledge.hold_expires_at)) : null
    if (pledge.status === 'pending' && holdExpiresAt && holdExpiresAt.getTime() <= Date.now()) {
      await markPaymentFailed(orderId, { code: 'PLEDGE_EXPIRED', message: '결제 시간이 지나 후원이 취소되었습니다.' })
      return ApiError.badRequest('결제 시간이 지났습니다. 다시 후원해 주세요.').toNextResponse()
    }

    // 캠페인이 그새 마감·중단됐으면 재고 계산의 전제 자체가 없다. 이 역시
    // 승인 전에 막는다.
    const campaign = await getCampaignById(String(pledge.campaign_id))
    if (!campaign || campaign.status !== 'active') {
      await markPaymentFailed(orderId, { code: 'PLEDGE_EXPIRED', message: '결제 시간이 지나 후원이 취소되었습니다.' })
      return ApiError.badRequest('결제 시간이 지났습니다. 다시 후원해 주세요.').toNextResponse()
    }

    const storedAmount = Number(payment.amount)
    try {
      assertAmountMatches(storedAmount, body.amount)
    } catch (error) {
      if (error instanceof AmountMismatchError) {
        log.error('후원 금액 불일치', { orderId, expected: error.expected, received: String(error.received) })
        await markPaymentFailed(orderId, { code: 'AMOUNT_MISMATCH', message: '결제 금액이 주문 금액과 일치하지 않습니다.' })
        await cancelPendingPledge(pledgeId, orderId)
        return ApiError.badRequest('결제 금액이 일치하지 않아 승인하지 않았습니다.').toNextResponse()
      }
      throw error
    }

    const { secretKey } = getServerPaymentConfig()
    // 승인 호출 *전에* 결제 식별자를 원장에 새긴다 — 이 확인의 이유는
    // `recordPaymentKey`의 주석 참고. 확정 함수 안에서 다시 같은 값을
    // 적으므로(멱등) 여기서 실패해도 뒤가 깨지지 않는다.
    await recordPaymentKey(orderId, paymentKey)
    let approved: Record<string, unknown>
    try {
      approved = await confirmPayment({ paymentKey, orderId, amount: storedAmount }, { secretKey })
    } catch (error) {
      // `ALREADY_PROCESSED_PAYMENT`는 거절이 아니다 — 우리 쪽 승인 응답이
      // 유실되고 나서 이 라우트가 재시도(재전송 버튼)됐을 때 정확히 이
      // 코드가 온다. 이 시점에 돈은 이미 승인돼 있다. 다른 거절과 같이
      // 취급해 취소해 버리면 승인은 됐는데 후원은 취소돼 돈만 잃는다.
      // 그래서 이 코드만 따로 떼어 토스에 다시 물어보고, 정말 이 주문·이
      // 금액의 승인이 맞을 때만 성공 경로로 넘긴다. 확인이 안 되면(다른
      // 결제이거나 조회 자체가 안 되면) 절대 취소하지 않고 "확인 중"
      // 응답으로 물러난다 — 취소는 되돌릴 수 없지만 재확인은 다음 기회가
      // 있다.
      if (error instanceof TossApiError && error.code === 'ALREADY_PROCESSED_PAYMENT') {
        let recheck: Record<string, unknown> | null = null
        try {
          recheck = await lookupPayment(paymentKey, { secretKey })
        } catch {
          recheck = null
        }
        const belongsToThisOrder =
          recheck !== null &&
          String(recheck.status) === 'DONE' &&
          recheck.orderId === orderId &&
          Number(recheck.totalAmount) === storedAmount
        if (belongsToThisOrder && recheck) {
          approved = recheck
        } else {
          log.error('이미 처리된 결제 재확인 실패 — 취소하지 않고 보류', {
            orderId,
            receivedOrderId: recheck ? recheck.orderId : undefined,
            receivedAmount: recheck ? recheck.totalAmount : undefined,
            expectedAmount: storedAmount,
          })
          return ApiError.serviceUnavailable('결제 결과를 확인하는 중입니다. 잠시 후 후원 내역을 확인해 주세요.').toNextResponse()
        }
      } else if (error instanceof TossApiError) {
        await markPaymentFailed(orderId, { code: error.code, message: error.message })
        await cancelPendingPledge(pledgeId, orderId)
        log.warn('후원 결제 거절', { orderId, code: error.code })
        return ApiError.badRequest(error.message).toNextResponse()
      } else if (error instanceof TossLookupError) {
        // 승인됐는지 모른다. 아무것도 건드리지 않는다 — 만료 크론이 토스를 다시 본다.
        log.error('후원 결제 판단 불가', { orderId, message: error.message })
        return ApiError.serviceUnavailable('결제 결과를 확인하는 중입니다. 잠시 후 후원 내역을 확인해 주세요.').toNextResponse()
      } else {
        throw error
      }
    }

    const approvedAtRaw = typeof approved.approvedAt === 'string' ? approved.approvedAt : new Date().toISOString()
    const approvedAt = new Date(approvedAtRaw)
    const confirmed = await finalizePledgePayment({
      orderId, pledgeId, paymentKey,
      method: typeof approved.method === 'string' ? approved.method : null,
      approvedAt: Number.isNaN(approvedAt.getTime()) ? new Date() : approvedAt,
      raw: approved,
    })

    if (!confirmed || confirmed.status !== 'paid') {
      // 승인은 끝났는데 확정을 못 했다(마감·짝 불일치). 돈만 받는 것이 최악이므로 즉시 환불.
      log.error('후원 확정 실패 — 환불 시도', { orderId, pledgeId })
      try {
        await cancelPayment(paymentKey, { cancelReason: '후원 확정 실패', orderId }, { secretKey })
      } catch (refundError) {
        log.error('자동 환불 실패 — 수동 처리 필요', { orderId, error: refundError instanceof Error ? refundError.message : refundError })
      }
      return ApiError.internalServerError('후원을 확정하지 못해 결제를 취소했습니다. 사무국으로 문의해 주세요.').toNextResponse()
    }

    after(() => notifyPledgePaid(confirmed).catch(e => log.error('후원 알림 실패', { orderId, e })))

    log.info('후원 확정', { orderId, pledgeCode: confirmed.pledge_code })
    return ApiSuccess.ok({ orderId, pledgeCode: confirmed.pledge_code, amount: storedAmount }).toNextResponse()
  } catch (error) {
    log.error('후원 확정 실패:', error)
    return ApiError.internalServerError('후원을 확정하지 못했습니다.').toNextResponse()
  }
}
