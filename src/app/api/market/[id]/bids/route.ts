/**
 * 장터 경매 입찰 — 이력(GET)과 입찰(POST).
 *
 * 읽기·입찰 모두 승인 조합원이다. 입찰자 이름은 조합원 모두에게 활동명
 * (`display_name`)으로 보인다(2026-10-29 결정 — 조합원끼리의 경매다).
 *
 * 경매 규칙(마감·최소 호가·셀프 입찰 금지·막판 연장)은 `placeBid`가 한 트랜잭션
 * 안에서 지킨다. 여기는 권한·입력·응답만 한다.
 *
 * 게시판 스위치를 보지 않는다. 스위치가 끊는 것은 **새 글**이고, 이미 열린 경매의
 * 입찰을 막으면 경매가 중간에 얼어붙는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { applyRouteRateLimit, createIPKeyGenerator, RATE_LIMITS } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseBidAmount } from '@/lib/market/validate'
import { getAuction, listBids, placeBid } from '@/db/queries/marketAuction'
import { getMarketListingOwner } from '@/db/queries/market'
import { closeAuctionAndNotify } from '@/lib/server/marketAuctionClose'
import { notifyOutbid } from '@/lib/server/marketAuctionNotify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function readListingId(context: RouteContext) {
  const { id } = await context.params
  const validation = validateUUID(id, '매물 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 매물 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      await closeAuctionAndNotify(listingId)
      const auction = await getAuction(listingId)
      if (!auction) throw ApiError.notFound('경매를 찾을 수 없습니다.')
      const bids = await listBids(listingId)
      return ApiSuccess.ok({ auction, bids })
    },
    `/api/market/${listingId}/bids`,
    { userId: user.id }
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  // 매물·댓글과 통을 나눈다(`market-listing`·`market-comment`와 같은 이유).
  const rl = await applyRouteRateLimit(request, {
    ...RATE_LIMITS.POST_CREATION,
    message: '입찰을 너무 빠르게 하고 있습니다. 잠시 후 다시 시도해주세요.',
    keyGenerator: createIPKeyGenerator('market-bid'),
  })
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      const amount = parseBidAmount(body?.amount)
      if (amount === null) throw ApiError.badRequest('입찰 금액을 원 단위 숫자로 입력해 주세요.')

      const result = await placeBid({ listingId, bidderId: user.id, amount, now: new Date() })
      switch (result.error) {
        case null:
          break
        case 'not_found':
          throw ApiError.notFound('경매를 찾을 수 없습니다.')
        case 'self_bid':
          throw ApiError.forbidden('내 경매에는 입찰할 수 없습니다.')
        case 'ended':
          // 마감은 지났는데 아직 안 닫혔다 — 이 요청이 닫는다.
          await closeAuctionAndNotify(listingId)
          throw ApiError.badRequest('마감된 경매입니다.')
        case 'not_live':
          throw ApiError.badRequest('마감된 경매입니다.')
        case 'too_low':
          throw ApiError.badRequest(
            `${won(result.minimum ?? 0)} 이상으로 입찰해 주세요. 그 사이 다른 입찰이 들어왔을 수 있습니다.`
          )
      }

      if (result.outbid_bidder_id) {
        const owner = await getMarketListingOwner(listingId)
        await notifyOutbid({
          listingId,
          listingTitle: owner?.title ?? '경매',
          outbidUserId: result.outbid_bidder_id,
          newPrice: amount,
          actorId: user.id,
        })
      }

      return ApiSuccess.created(
        {
          id: result.bid_id,
          amount,
          ends_at: result.ends_at,
          extended: result.extended === true,
        },
        '입찰되었습니다.'
      )
    },
    `/api/market/${listingId}/bids`,
    { userId: user.id }
  )
}
