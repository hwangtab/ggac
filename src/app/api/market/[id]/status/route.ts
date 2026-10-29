/**
 * 장터 매물 거래 상태(판매중 · 예약중 · 거래완료) 바꾸기.
 *
 * 전체 수정(`PATCH /api/market/[id]`)과 따로 둔 이유: 상태는 상세 화면의
 * 드롭다운 하나로 자주 바꾸는데, 그때마다 제목·설명·사진을 다시 보내게 하면
 * 다른 탭에서 고친 내용을 옛 값으로 덮어쓴다.
 *
 * 판매자 본인만 바꾼다. 관리자도 남의 거래 상태를 바꾸지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseMarketStatus } from '@/lib/market/validate'
import { getMarketListingOwner, updateMarketListingStatus } from '@/db/queries/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  return apiPatch(
    async () => {
      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      if (owner.seller_id !== user.id) throw ApiError.forbidden('수정 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      const status = parseMarketStatus(body?.status)
      if (!status) throw ApiError.badRequest('거래 상태 값이 올바르지 않습니다.')

      if (status !== owner.status) await updateMarketListingStatus(listingId, status)
      return ApiSuccess.ok({ id: listingId, status }, '거래 상태가 바뀌었습니다.')
    },
    `/api/market/${listingId}/status`,
    { userId: user.id }
  )
}
