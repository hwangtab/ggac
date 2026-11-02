/**
 * 장터 경매 입찰 무효 처리 — **관리자만.** 오타 입찰(0 하나 더)·장난 입찰을
 * 걷어 내는 자리다. 입찰자 본인도 판매자도 하지 못한다: 입찰을 물릴 수 있으면
 * 값을 띄워 놓고 빠지는 장난이 열린다.
 *
 * 진행 중인 경매의 입찰만 무효로 한다. 닫힌 경매의 낙찰은 뒤집지 않는다.
 * 무효 처리 뒤 최고가·최고 입찰자는 남은 입찰에서 다시 계산된다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { isApprovedActiveAdmin } from '@/lib/server/authz'
import { validateUUID } from '@/utils/validation'
import { voidBid } from '@/db/queries/marketAuction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await context.params
  const listingCheck = validateUUID(params.id, '매물 ID')
  const bidCheck = validateUUID(params.bidId, '입찰 ID')
  if (!listingCheck.isValid || !bidCheck.isValid) {
    return ApiError.badRequest('잘못된 ID 형식입니다.').toNextResponse()
  }
  const listingId = listingCheck.sanitized
  const bidId = bidCheck.sanitized

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  return apiDelete(
    async () => {
      if (!isApprovedActiveAdmin(profile)) throw ApiError.forbidden('입찰 무효 권한이 없습니다.')

      const result = await voidBid({ bidId, listingId, actorId: user.id, now: new Date() })
      if (result.error === 'not_found') throw ApiError.notFound('입찰을 찾을 수 없습니다.')
      if (result.error === 'already_voided')
        throw ApiError.badRequest('이미 무효 처리된 입찰입니다.')
      if (result.error === 'closed') {
        throw ApiError.badRequest('마감된 경매의 입찰은 무효로 할 수 없습니다.')
      }
      return ApiSuccess.ok({ id: bidId }, '입찰을 무효 처리했습니다.')
    },
    `/api/market/${listingId}/bids/${bidId}`,
    { userId: user.id }
  )
}
