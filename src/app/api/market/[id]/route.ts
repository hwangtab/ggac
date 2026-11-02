/**
 * 장터 매물 하나 — 읽기(GET) · 수정(PATCH) · 삭제(DELETE).
 *
 * 경계:
 *   - 읽기: 승인 조합원 누구나
 *   - 수정: **판매자 본인만.** 관리자도 남의 매물 문구·가격을 고치지 않는다 —
 *     고친 가격으로 거래가 이뤄지면 누가 한 약속인지가 흐려진다
 *   - 삭제: 판매자 본인 또는 관리자(부적절한 매물 내리기)
 *
 * 경매 매물에는 경매의 약속(`src/lib/market/auctionRules.ts`)이 더 걸린다 —
 * 입찰이 들어오면 판매자도 고치거나 내리지 못한다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, apiGet, apiPatch, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { canRemoveMarketItem } from '@/lib/server/authz'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseMarketListingInput } from '@/lib/market/validate'
import {
  getMarketListing,
  getMarketListingOwner,
  softDeleteMarketListing,
  updateMarketListing,
} from '@/db/queries/market'
import { filterUploadsOwnedBy } from '@/db/queries/uploads'
import { cancelLiveAuction, getAuction } from '@/db/queries/marketAuction'
import { blockEdit, blockSellerDelete } from '@/lib/market/auctionRules'
import { closeAuctionAndNotify } from '@/lib/server/marketAuctionClose'

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

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      // 마감이 지난 경매라면 읽기 전에 닫는다 — "진행 중"인 채로 보이면 안 된다.
      await closeAuctionAndNotify(listingId)
      const listing = await getMarketListing(listingId)
      if (!listing) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      const auction = listing.deal_type === 'auction' ? await getAuction(listingId) : null
      return ApiSuccess.ok({ listing, auction })
    },
    `/api/market/${listingId}`,
    { userId: user.id }
  )
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPatch(
    async () => {
      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      if (owner.seller_id !== user.id) throw ApiError.forbidden('수정 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const parsed = parseMarketListingInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

      const blocked = blockEdit(owner, parsed.value.deal_type)
      if (blocked) throw ApiError.badRequest(blocked)

      const owned = await filterUploadsOwnedBy(parsed.value.images, user.id)
      if (owned.length !== parsed.value.images.length) {
        throw ApiError.badRequest('직접 올린 사진만 첨부할 수 있습니다.')
      }

      // 경매의 가격 칸(시작가)은 경매 칸과 짝이라 수정으로 건드리지 않는다.
      await updateMarketListing(
        listingId,
        parsed.value.deal_type === 'auction' ? { ...parsed.value, price: undefined } : parsed.value
      )
      return ApiSuccess.ok({ id: listingId }, '매물이 수정되었습니다.')
    },
    `/api/market/${listingId}`,
    { userId: user.id }
  )
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  return apiDelete(
    async () => {
      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      if (!canRemoveMarketItem(profile, user.id, owner.seller_id)) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }
      const blocked = blockSellerDelete(owner, profile?.is_admin === true)
      if (blocked) throw ApiError.badRequest(blocked)

      // 경매를 먼저 취소해 둔다 — 지운 매물의 경매가 크론에 "낙찰"로 닫히면
      // 아무도 볼 수 없는 매물에 낙찰 알림이 나간다.
      if (owner.deal_type === 'auction') await cancelLiveAuction(listingId, new Date())
      await softDeleteMarketListing(listingId)
      return ApiSuccess.ok({ id: listingId }, '매물이 삭제되었습니다.')
    },
    `/api/market/${listingId}`,
    { userId: user.id }
  )
}
