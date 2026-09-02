/**
 * 내 예매 내역. 로그인 회원이 자기 예매만 본다.
 *
 * 비회원 예매는 여기 뜨지 않는다 — 계정에 연결되지 않았기 때문이다. 그 경우
 * 예매번호와 연락처로 현장에서 대조한다.
 */

import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { listReservationsByUser } from '@/db/queries/ticketing'
import { calculateTicketRefund } from '@/lib/payments/refundPolicy'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/tickets')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth

    const reservations = await listReservationsByUser(auth.user.id)

    // 취소 버튼을 누르기 전에 얼마가 돌아오는지 보여준다. 눌러 봐야 아는
    // 구조면 관객이 취소를 망설이고, 결국 사무국으로 전화가 온다.
    const withRefund = reservations.map(reservation => {
      if (reservation.status !== 'confirmed' || !reservation.starts_at) {
        return { ...reservation, refund: null }
      }
      const quote = calculateTicketRefund({
        totalAmount: Number(reservation.total_amount),
        showStartsAt: String(reservation.starts_at),
      })
      return {
        ...reservation,
        refund: {
          refundable: quote.refundable,
          refund_amount: quote.refundAmount,
          deduction_rate: quote.deductionRate,
          reason: quote.reason,
        },
      }
    })

    return ApiSuccess.ok({ reservations: withRefund }).toNextResponse()
  } catch (error) {
    log.error('예매 내역 조회 실패:', error)
    return ApiError.internalServerError('예매 내역을 불러오지 못했습니다.').toNextResponse()
  }
}
