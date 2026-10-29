/**
 * 장터 댓글 삭제. 작성자 본인 또는 관리자.
 *
 * 판매자에게 남의 문의 댓글을 지울 권한은 주지 않는다 — "가격 깎아 달라"는
 * 말이 불편하다고 지울 수 있으면 거래 대화의 기록이 판매자 편집본이 된다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { canRemoveMarketItem } from '@/lib/server/authz'
import { validateUUID } from '@/utils/validation'
import { getMarketCommentOwner, softDeleteMarketComment } from '@/db/queries/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const params = await context.params
  const listingCheck = validateUUID(params.id, '매물 ID')
  const commentCheck = validateUUID(params.commentId, '댓글 ID')
  if (!listingCheck.isValid || !commentCheck.isValid) {
    return ApiError.badRequest('잘못된 ID 형식입니다.').toNextResponse()
  }
  const listingId = listingCheck.sanitized
  const commentId = commentCheck.sanitized

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  return apiDelete(
    async () => {
      const comment = await getMarketCommentOwner(commentId)
      // 다른 매물 경로로 이 댓글을 지우려는 요청은 "없는 댓글"과 같게 404다.
      if (!comment || comment.listing_id !== listingId || comment.is_deleted) {
        throw ApiError.notFound('댓글을 찾을 수 없습니다.')
      }
      if (!canRemoveMarketItem(profile, user.id, comment.author_id)) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }

      await softDeleteMarketComment(commentId)
      return ApiSuccess.ok({ id: commentId }, '댓글이 삭제되었습니다.')
    },
    `/api/market/${listingId}/comments/${commentId}`,
    { userId: user.id }
  )
}
