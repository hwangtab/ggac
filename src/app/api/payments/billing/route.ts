/**
 * 자동결제 카드 등록·해지.
 *
 * POST — 결제창이 돌려준 인증키를 빌링키로 바꿔 저장한다.
 * DELETE — 자동결제를 해지한다.
 *
 * **빌링키는 어느 응답에도 싣지 않는다.** 이 키와 구매자 식별값이 있으면
 * 그 카드로 결제를 걸 수 있다.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { saveBillingKey, deactivateBillingKey, getActiveBillingKey } from '@/db/queries/billingKeys'
import {
  issueBillingKey,
  deleteBillingKey,
  TossApiError,
  TossLookupError,
} from '@/lib/payments/toss/client'
import { buildCustomerKey } from '@/lib/payments/toss/protocol'
import { getBillingConfig, isBillingEnabled, isPaymentEnabled } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/payments/billing')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled() || !isBillingEnabled()) {
      return ApiError.serviceUnavailable('자동결제를 준비 중입니다.').toNextResponse()
    }

    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const authKey = typeof body.authKey === 'string' ? body.authKey : ''
    const customerKey = typeof body.customerKey === 'string' ? body.customerKey : ''
    if (!authKey || !customerKey) {
      return ApiError.badRequest('카드 등록 정보가 올바르지 않습니다.').toNextResponse()
    }

    // 남의 구매자 식별값으로 빌링키를 발급받아 자기 계정에 붙이는 경로를 막는다.
    // 이 값은 회원 id에서 결정적으로 만들어지므로 서버가 다시 계산해 대조할 수 있다.
    if (customerKey !== buildCustomerKey(user.id)) {
      log.warn('구매자 식별값 불일치', { userId: maskId(user.id) })
      return ApiError.forbidden('카드 등록 정보가 올바르지 않습니다.').toNextResponse()
    }

    const profile = await getProfileById(user.id)
    const { secretKey } = getBillingConfig()

    let billing: Record<string, unknown>
    try {
      billing = await issueBillingKey({ authKey, customerKey }, { secretKey })
    } catch (error) {
      if (error instanceof TossApiError) {
        log.warn('빌링키 발급 거절', { userId: maskId(user.id), code: error.code })
        return ApiError.badRequest(
          '카드를 등록하지 못했습니다. 다시 시도하거나 다른 카드를 사용해 주세요.'
        ).toNextResponse()
      }
      if (error instanceof TossLookupError) {
        log.error('빌링키 발급 판단 불가', { userId: maskId(user.id), message: error.message })
        return ApiError.serviceUnavailable(
          '카드 등록 결과를 확인하지 못했습니다. 잠시 후 마이페이지에서 등록 상태를 확인해 주세요.'
        ).toNextResponse()
      }
      throw error
    }

    const billingKey = typeof billing.billingKey === 'string' ? billing.billingKey : ''
    if (!billingKey) {
      log.error('빌링키가 응답에 없음', { userId: maskId(user.id) })
      return ApiError.internalServerError('카드 등록에 실패했습니다.').toNextResponse()
    }

    // 빌링키는 다시 조회할 수 없다. 저장이 끝난 뒤에만 성공을 알린다.
    const card = (billing.card ?? {}) as Record<string, unknown>
    await saveBillingKey({
      userId: user.id,
      billingKey,
      customerKey,
      cardIssuerCode: typeof card.issuerCode === 'string' ? card.issuerCode : null,
      cardNumberMasked: typeof card.number === 'string' ? card.number : null,
      cardType: typeof card.cardType === 'string' ? card.cardType : null,
    })

    log.info('자동결제 카드 등록', { userId: maskId(user.id) })

    // 빌링키는 싣지 않는다. 화면에 필요한 건 카드사와 마스킹된 번호뿐이다.
    return ApiSuccess.ok({
      registered: true,
      cardNumberMasked: typeof card.number === 'string' ? card.number : null,
      cardType: typeof card.cardType === 'string' ? card.cardType : null,
      payerName: profile?.display_name ?? null,
    }).toNextResponse()
  } catch (error) {
    log.error('자동결제 카드 등록 실패:', error)
    return ApiError.internalServerError('카드를 등록하지 못했습니다.').toNextResponse()
  }
}

export async function DELETE() {
  try {
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const current = await getActiveBillingKey(user.id)
    if (!current) {
      return ApiSuccess.ok({
        deactivated: false,
        message: '등록된 자동결제가 없습니다.',
      }).toNextResponse()
    }

    // 우리 쪽을 먼저 내린다. 토스 삭제가 실패해도 **청구는 멈춰야** 한다 —
    // 순서를 뒤집으면 토스 장애 때 해지가 통째로 실패하고 다음 달에 또 청구된다.
    const deactivated = await deactivateBillingKey(user.id)
    log.info('자동결제 해지', { userId: maskId(user.id) })

    if (deactivated && isBillingEnabled()) {
      try {
        const { secretKey } = getBillingConfig()
        await deleteBillingKey(String(deactivated.billing_key), { secretKey })
      } catch (error) {
        // 토스 쪽 삭제 실패는 회원에게 알리지 않는다. 우리가 청구하지 않으면
        // 결제는 일어나지 않고, 남은 빌링키는 유효기간이 지나면 만료된다.
        log.error('토스 빌링키 삭제 실패(해지는 완료됨)', {
          userId: maskId(user.id),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return ApiSuccess.ok({ deactivated: true }).toNextResponse()
  } catch (error) {
    log.error('자동결제 해지 실패:', error)
    return ApiError.internalServerError('자동결제를 해지하지 못했습니다.').toNextResponse()
  }
}
