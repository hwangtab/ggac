/**
 * 유찰된 경매 다시 열기 — **판매자 본인만**, 입찰 없이 끝난 경매만.
 *
 * 같은 매물에서 시작가·호가·기간을 새로 받아 다시 시작한다. 사진·설명·댓글은
 * 그대로다. 낙찰된 경매는 열 수 없다(낙찰자에게 한 약속이다) — 낙찰자와 거래가
 * 안 되면 판매자는 거래 상태를 바꾸고 댓글로 다른 입찰자와 이어간다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseAuctionInput } from '@/lib/market/validate'
import { getMarketListingOwner } from '@/db/queries/market'
import { relistNoBidAuction } from '@/db/queries/marketAuction'
import { closeAuctionAndNotify } from '@/lib/server/marketAuctionClose'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const validation = validateUUID(id, '매물 ID')
  if (!validation.isValid) {
    return ApiError.badRequest(
      validation.errors[0] || '잘못된 매물 ID 형식입니다.'
    ).toNextResponse()
  }
  const listingId = validation.sanitized

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      // 마감은 지났는데 아직 안 닫힌 경매면 먼저 닫는다 — 그래야 "유찰"로 보인다.
      await closeAuctionAndNotify(listingId)
      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      if (owner.seller_id !== user.id) throw ApiError.forbidden('수정 권한이 없습니다.')
      if (owner.deal_type !== 'auction' || owner.auction_state !== 'no_bids') {
        throw ApiError.badRequest('입찰 없이 끝난 경매만 다시 열 수 있습니다.')
      }

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const auction = parseAuctionInput(body)
      if (auction.error !== null) throw ApiError.badRequest(auction.error)

      const reopened = await relistNoBidAuction(listingId, auction.value, new Date())
      if (!reopened) throw ApiError.badRequest('입찰 없이 끝난 경매만 다시 열 수 있습니다.')
      return ApiSuccess.ok({ id: listingId }, '경매를 다시 열었습니다.')
    },
    `/api/market/${listingId}/relist`,
    { userId: user.id }
  )
}
