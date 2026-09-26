/**
 * 사무국 예매 목록 — 대리 환불(`[id]/refund`)이 받을 **id를 찾는 자리**.
 *
 * 환불 라우트만 있고 이 목록이 없던 동안, 사무국이 예매 id를 얻는 길은 DB
 * 콘솔뿐이었다. 그 길을 걷느니 토스 콘솔에서 환불하는 편이 빠르고, 그건
 * 환불 라우트가 막으려던 바로 그 경로다(원장이 모르는 환불).
 *
 * ## 결제 키는 나가지 않는다
 *
 * 화면이 알아야 하는 것은 "돌려줄 결제가 있는가"와 "얼마가 남았는가"다.
 * `payment_key`는 둘 중 어느 것도 아니고, 그 값 하나면 토스 API로 우리
 * 시스템 밖에서 결제를 취소할 수 있다. 쿼리 계층이 아예 SELECT 하지 않으므로
 * (`listReservationsForAdmin`) 여기서 지울 것도 없다.
 *
 * ## 예매자 정보는 가리지 않는다
 *
 * 관객이 전화로 이름과 연락처를 말하면 사무국은 그것으로 예매를 찾아야 한다.
 * 가운데를 별표로 덮으면 대조가 불가능해지고, 그러면 화면이 있으나 마나다.
 * 대신 이 목록은 관리자만 열 수 있고(`requireAdmin`), 실제로 돈을 움직이는
 * 동작은 그 자체로 활동 기록을 남긴다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { listPerformanceOptions, listReservationsForAdmin } from '@/db/queries/ticketing'
import { parseReservationListQuery, refundableWon } from '@/lib/payments/ticketReservationList'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/tickets/reservations')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  try {
    const query = parseReservationListQuery(request.nextUrl.searchParams)
    const [{ rows, total }, performances] = await Promise.all([
      listReservationsForAdmin(query),
      // 고르개는 목록과 함께 한 번에 내려보낸다. 화면이 조회를 두 번 쏘면
      // 필터를 바꿀 때마다 공연 목록까지 다시 받는다.
      listPerformanceOptions(),
    ])

    const reservations = rows.map(row => {
      // 원장 두 칸은 뺄셈만 남기고 버린다 — 화면이 필요한 것은 남은 금액이다.
      const { payment_amount, payment_canceled_amount, ...rest } = row
      return {
        ...rest,
        refundable_amount: refundableWon(payment_amount, payment_canceled_amount),
      }
    })

    return ApiSuccess.ok({
      reservations,
      total,
      limit: query.limit,
      offset: query.offset,
      performances,
    }).toNextResponse()
  } catch (error) {
    log.error('사무국 예매 목록 조회 실패:', error)
    return ApiError.internalServerError('예매 목록을 불러오지 못했습니다.').toNextResponse()
  }
}
