/**
 * 조합원 장터 — 목록(GET)과 등록(POST).
 *
 * **읽기도 승인 조합원만이다.** 게시판(`/api/posts`)은 비회원도 읽지만 장터는
 * 가격·지역·거래 대화가 오가는 조합원끼리의 자리라 바깥에 내놓지 않는다.
 * 그래서 GET도 `requireActiveMember`이고 CDN 캐시 헤더를 붙이지 않는다 —
 * 공용 캐시에 한 번 실리면 그 응답은 누구에게나 나간다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { applyRouteRateLimit, createIPKeyGenerator, RATE_LIMITS } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { FEATURE_DISABLED_MESSAGES, isBoardEnabled } from '@/lib/features/settings'
import { parseMarketListingInput, parseMarketListQuery } from '@/lib/market/validate'
import {
  countOpenListingsBySeller,
  createMarketListing,
  listMarketListings,
} from '@/db/queries/market'
import { filterUploadsOwnedBy } from '@/db/queries/uploads'
import { MARKET_PAGE_SIZE } from '@/constants/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 한 사람이 동시에 걸어 둘 수 있는 매물 수(판매중·예약중). 도배 방지. */
const MAX_OPEN_LISTINGS_PER_SELLER = 30

export async function GET(request: NextRequest) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const query = parseMarketListQuery(request.nextUrl.searchParams)
      const mine = request.nextUrl.searchParams.get('mine') === '1'
      const { rows, hasNext } = await listMarketListings({
        status: query.status,
        hideDone: query.hideDone,
        dealType: query.dealType,
        itemCategory: query.itemCategory,
        sellerId: mine ? user.id : undefined,
        offset: (query.page - 1) * MARKET_PAGE_SIZE,
        limit: MARKET_PAGE_SIZE,
      })
      return ApiSuccess.ok({ listings: rows, page: query.page, has_next: hasNext })
    },
    '/api/market',
    { userId: user.id }
  )
}

export async function POST(request: NextRequest) {
  // 게시판 글쓰기와 통을 나눈다 — 같은 `POST_CREATION` 이름을 쓰면 글 다섯 개를
  // 올린 조합원이 장터 첫 글에서 막힌다(`board-room` 토론 라우트와 같은 이유).
  const rl = await applyRouteRateLimit(request, {
    ...RATE_LIMITS.POST_CREATION,
    message: '매물을 너무 빠르게 올리고 있습니다. 잠시 후 다시 시도해주세요.',
    keyGenerator: createIPKeyGenerator('market-listing'),
  })
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // 장터는 게시판의 일부다. 게시판 새 글 스위치를 내리면 장터 등록도 멈춘다.
  if ((await isBoardEnabled()) === false) {
    return ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.board).toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const parsed = parseMarketListingInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

      const owned = await filterUploadsOwnedBy(parsed.value.images, user.id)
      if (owned.length !== parsed.value.images.length) {
        throw ApiError.badRequest('직접 올린 사진만 첨부할 수 있습니다.')
      }

      if ((await countOpenListingsBySeller(user.id)) >= MAX_OPEN_LISTINGS_PER_SELLER) {
        throw ApiError.badRequest(
          `판매중·예약중인 매물은 ${MAX_OPEN_LISTINGS_PER_SELLER}개까지 걸어 둘 수 있습니다. 거래가 끝난 매물을 정리해 주세요.`
        )
      }

      const { id } = await createMarketListing(user.id, parsed.value)
      return ApiSuccess.created({ id }, '매물이 등록되었습니다.')
    },
    '/api/market',
    { userId: user.id }
  )
}
