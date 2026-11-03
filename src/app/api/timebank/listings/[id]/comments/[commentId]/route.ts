/**
 * 타임뱅크 댓글 삭제. 작성자 본인 또는 관리자(`canRemoveTimebankItem`).
 *
 * 글쓴이에게 남의 댓글을 지울 권한은 주지 않는다 — 약속·분쟁의 기록이 글쓴이
 * 편집본이 되면 안 된다(장터와 같다). 지우는 것은 노출을 줄이는 쪽이라 꺼짐·
 * 미동의·탈퇴 신청 중에도 막지 않는다(`requireTimebankReader`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireTimebankReader } from '@/lib/server/timebankAuth'
import { canRemoveTimebankItem } from '@/lib/server/authz'
import { validateUUID } from '@/utils/validation'
import { getTimebankCommentOwner, softDeleteTimebankComment } from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const params = await context.params
  const listingCheck = validateUUID(params.id, '글 ID')
  const commentCheck = validateUUID(params.commentId, '댓글 ID')
  if (!listingCheck.isValid || !commentCheck.isValid) {
    return ApiError.badRequest('잘못된 ID 형식입니다.').toNextResponse()
  }
  const listingId = listingCheck.sanitized
  const commentId = commentCheck.sanitized

  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  return apiDelete(
    async () => {
      const comment = await getTimebankCommentOwner(commentId)
      // 다른 글 경로로 이 댓글을 지우려는 요청은 "없는 댓글"과 같게 404다.
      if (!comment || comment.listing_id !== listingId || comment.is_deleted) {
        throw ApiError.notFound('댓글을 찾을 수 없습니다.')
      }
      if (!canRemoveTimebankItem(profile, user.id, comment.author_id)) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }

      await softDeleteTimebankComment(commentId)
      return ApiSuccess.ok({ id: commentId }, '댓글이 삭제되었습니다.')
    },
    `/api/timebank/listings/${listingId}/comments/${commentId}`,
    { userId: user.id }
  )
}
