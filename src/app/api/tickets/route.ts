/**
 * 예매 가능한 공연 목록·상세 (공개).
 *
 * 로그인을 요구하지 않는다 — 공연은 일반 관객이 대상이고, 표를 사려면
 * 먼저 조합원이 되어야 한다면 아무도 사지 않는다.
 */

import { NextRequest } from 'next/server'

import { listOpenPerformances, getPerformanceDetail } from '@/db/queries/ticketing'
import { isPaymentEnabled } from '@/lib/payments/toss/config'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/tickets')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get('slug')

    if (slug) {
      const detail = await getPerformanceDetail(slug)
      if (!detail || detail.status === 'draft') {
        return ApiError.notFound('공연을 찾을 수 없습니다.').toNextResponse()
      }
      return ApiSuccess.ok({
        paymentEnabled: isPaymentEnabled(),
        performance: detail,
      }).toNextResponse()
    }

    return ApiSuccess.ok({
      paymentEnabled: isPaymentEnabled(),
      performances: await listOpenPerformances(),
    }).toNextResponse()
  } catch (error) {
    log.error('공연 조회 실패:', error)
    return ApiError.internalServerError('공연 정보를 불러오지 못했습니다.').toNextResponse()
  }
}
