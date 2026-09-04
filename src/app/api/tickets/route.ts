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

/**
 * 공개 응답에 실을 것만 골라 새 객체를 만든다.
 *
 * 쿼리 계층은 행을 키 변환만 해서 돌려주므로, 그대로 내보내면 공연을 만든
 * 관리자 id(`created_by`)와 회차 정원(`capacity`)까지 함께 나간다. 관객이
 * 알아야 하는 것은 **남은 좌석**이지 정원이 아니다.
 *
 * 화면(`src/app/[locale]/tickets/`)도 같은 방식으로 필드를 고른다. 두 곳이
 * 어긋나면 화면에서 가린 값이 이 API로 새므로 함께 봐야 한다.
 */
function toPublicPerformance(detail: Record<string, unknown>) {
  const shows = Array.isArray(detail.shows) ? (detail.shows as Record<string, unknown>[]) : []
  const types = Array.isArray(detail.ticket_types)
    ? (detail.ticket_types as Record<string, unknown>[])
    : []
  return {
    id: detail.id,
    slug: detail.slug,
    title: detail.title,
    summary: detail.summary ?? null,
    description: detail.description ?? null,
    venue: detail.venue ?? null,
    poster_image: detail.poster_image ?? null,
    notice_text: detail.notice_text ?? null,
    status: detail.status,
    shows: shows.map(show => ({
      id: show.id,
      starts_at: show.starts_at,
      remaining_seats: show.remaining_seats,
      is_past: show.is_past,
    })),
    ticket_types: types.map(type => ({
      id: type.id,
      name: type.name,
      price: type.price,
      max_per_order: type.max_per_order,
      members_only: type.members_only,
    })),
  }
}

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
        performance: toPublicPerformance(detail),
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
