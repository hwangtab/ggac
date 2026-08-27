/**
 * 조합비 납부 현황 조회.
 *
 * 화면이 "이번 달 냈는가"를 물을 때 쓴다. **주문을 만들지 않는다** —
 * 준비 라우트(`prepare`)를 조회 용도로 쓰면 화면을 열 때마다 대기 주문이
 * 쌓인다.
 */

import { NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { getDues, listPaymentsByUser } from '@/db/queries/payments'
import { currentBillingMonth, isPaymentEnabled } from '@/lib/payments/toss/config'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/payments/dues')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const profile = await getProfileById(user.id)
    if (!profile) return ApiError.notFound('조합원 정보를 찾을 수 없습니다.').toNextResponse()

    const billingMonth = currentBillingMonth()
    const dues = await getDues(user.id, billingMonth)
    const payments = await listPaymentsByUser(user.id, 24)

    return ApiSuccess.ok({
      paymentEnabled: isPaymentEnabled(),
      billingMonth,
      monthlyFee: profile.monthly_fee ?? null,
      dues: dues
        ? { status: dues.status, amount: dues.amount, paid_at: dues.paid_at }
        : { status: 'unpaid', amount: profile.monthly_fee ?? null, paid_at: null },
      // 원장 전체가 아니라 화면에 필요한 필드만 내려보낸다.
      payments: payments
        .filter(
          p => p.status === 'done' || p.status === 'canceled' || p.status === 'partial_canceled'
        )
        .map(p => ({
          order_id: p.order_id,
          order_name: p.order_name,
          amount: p.amount,
          status: p.status,
          method: p.method,
          approved_at: p.approved_at,
          canceled_amount: p.canceled_amount,
        })),
    }).toNextResponse()
  } catch (error) {
    log.error('조합비 현황 조회 실패:', error)
    return ApiError.internalServerError('납부 현황을 불러오지 못했습니다.').toNextResponse()
  }
}
