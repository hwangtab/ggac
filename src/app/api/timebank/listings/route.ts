/**
 * 타임뱅크 게시판 — 목록(GET)과 등록(POST) (스펙 §7.1).
 *
 * - 읽기: 승인 조합원(`requireTimebankReader`). 꺼져 있어도 읽는다(§7.2).
 * - 쓰기: `requireTimebankParticipant` — 켜짐 + 현재 판 동의 + 탈퇴 신청 중 아님.
 * - **POST는 `kind ∈ {offer, request}`만** 받는다. 조합 업무(`coop_task`)는 관리자
 *   라우트로만 만든다(스펙 §15 H "coop_task가 조합원 라우트 분기").
 *
 * 장터와 같은 이유로 CDN 캐시 헤더를 붙이지 않는다(조합원끼리의 자리).
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  MAX_OPEN_TIMEBANK_LISTINGS,
  requireTimebankParticipant,
  requireTimebankReader,
  timebankRateLimit,
} from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { FEATURE_DISABLED_MESSAGES, isBoardEnabled } from '@/lib/features/settings'
import { parseListingInput, parseListingQuery } from '@/lib/timebank/validate'
import {
  countOpenListingsByAuthor,
  createTimebankListing,
  listTimebankListings,
} from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export async function GET(request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const query = parseListingQuery(request.nextUrl.searchParams)
      const { rows, hasNext } = await listTimebankListings({
        kind: query.kind,
        category: query.category,
        status: query.status,
        authorId: query.mine ? user.id : undefined,
        offset: (query.page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      return ApiSuccess.ok({ listings: rows, page: query.page, has_next: hasNext })
    },
    '/api/timebank/listings',
    { userId: user.id }
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const rl = await applyRouteRateLimit(request, timebankRateLimit('listing', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  // 타임뱅크 게시판도 게시판의 일부다. 게시판 새 글 스위치를 내리면 함께 멈춘다(장터와 같다).
  if ((await isBoardEnabled()) === false) {
    return ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.board).toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const parsed = parseListingInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

      if ((await countOpenListingsByAuthor(user.id)) >= MAX_OPEN_TIMEBANK_LISTINGS) {
        throw ApiError.badRequest(
          `열린 글은 ${MAX_OPEN_TIMEBANK_LISTINGS}개까지 둘 수 있습니다. 끝난 글을 닫아 주세요.`
        )
      }

      const { id } = await createTimebankListing(user.id, parsed.value)
      return ApiSuccess.created({ id }, '글이 등록되었습니다.')
    },
    '/api/timebank/listings',
    { userId: user.id }
  )
}
