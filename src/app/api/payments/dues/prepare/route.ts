/**
 * 조합비 결제 준비.
 *
 * **결제창을 띄우기 전에 반드시 거치는 관문이다.** 여기서 주문번호를 만들고
 * 금액을 원장에 먼저 새긴다. 순서를 뒤집어 결제창을 먼저 띄우면 "토스에는
 * 승인됐는데 우리 원장에는 없는" 건이 생기고, 그건 사후에 찾을 방법이 없다 —
 * 우리가 만든 주문번호를 모르니 조회할 것도 없다.
 *
 * 금액은 **클라이언트가 보낸 값을 절대 쓰지 않는다.** 회원의 회비 설정에서
 * 서버가 정한다.
 */

import { NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { createPendingPayment, ensureDues, getDues } from '@/db/queries/payments'
import { planDuesPayment, DuesPlanError } from '@/lib/payments/dues'
import { generateOrderId, buildCustomerKey } from '@/lib/payments/toss/protocol'
import {
  currentBillingMonth,
  isPaymentEnabled,
  getPublicClientKey,
} from '@/lib/payments/toss/config'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/payments/dues/prepare')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    if (!isPaymentEnabled()) {
      return ApiError.serviceUnavailable(
        '결제 기능이 준비 중입니다. 잠시 후 다시 시도해 주세요.'
      ).toNextResponse()
    }

    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 세션 프로필은 권한 판정용 5개 필드로 좁혀져 있어 회비 금액이 없다.
    // 금액은 결제의 핵심이므로 여기서 원본을 다시 읽는다.
    const profile = await getProfileById(user.id)
    if (!profile) {
      return ApiError.notFound('조합원 정보를 찾을 수 없습니다.').toNextResponse()
    }

    const billingMonth = currentBillingMonth()
    const existingDues = await getDues(user.id, billingMonth)

    let plan
    try {
      plan = planDuesPayment({ profile, billingMonth, existingDues })
    } catch (error) {
      if (error instanceof DuesPlanError) {
        // 이미 낸 달을 다시 결제하려는 건 사용자 잘못이 아니라 화면이 낡은
        // 것이므로, 무엇이 문제인지 그대로 알려 준다.
        return ApiError.badRequest(error.message).toNextResponse()
      }
      throw error
    }

    // 청구 행을 먼저 확정한다. 이미 있으면 그대로 둔다(금액을 덮어쓰지 않는다).
    await ensureDues({ userId: user.id, billingMonth, amount: plan.amount })

    const orderId = generateOrderId('dues')
    await createPendingPayment({
      orderId,
      userId: user.id,
      kind: 'dues',
      orderName: plan.orderName,
      amount: plan.amount,
      payerName: profile.display_name ?? null,
      payerEmail: profile.email ?? null,
    })

    log.info('조합비 결제 준비', { userId: maskId(user.id), billingMonth, orderId })

    return ApiSuccess.ok({
      orderId,
      orderName: plan.orderName,
      amount: plan.amount,
      billingMonth,
      // 결제창 초기화에 필요한 값. 공개 키와 해시된 식별값이라 노출돼도 된다.
      clientKey: getPublicClientKey(),
      customerKey: buildCustomerKey(user.id),
      customerName: profile.display_name ?? undefined,
      customerEmail: profile.email ?? undefined,
    }).toNextResponse()
  } catch (error) {
    log.error('조합비 결제 준비 실패:', error)
    return ApiError.internalServerError('결제를 준비하지 못했습니다.').toNextResponse()
  }
}
