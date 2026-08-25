import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { deleteComment, getCommentById } from '@/db/queries/comments'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id: postId, commentId } = await context.params

  const postIdValidation = validateUUID(postId, '게시글 ID')
  if (!postIdValidation.isValid) {
    return ApiError.badRequest(postIdValidation.errors[0]).toNextResponse()
  }
  const validPostId = postIdValidation.sanitized
  const commentIdValidation = validateUUID(commentId, '댓글 ID')
  if (!commentIdValidation.isValid) {
    return ApiError.badRequest(commentIdValidation.errors[0]).toNextResponse()
  }
  const validCommentId = commentIdValidation.sanitized

  try {
    // 댓글 삭제는 로그인만 확인한다(승인 여부는 보지 않음). 소유자 판정은
    // 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth
    const userId = user.id

    // Verify ownership (or admin if needed)
    const comment = await getCommentById(validCommentId, validPostId)
    if (!comment) return ApiError.notFound('Not found').toNextResponse()
    if (comment.author_id !== userId) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    await deleteComment(validCommentId, validPostId)

    try {
      revalidateTag(`comments-post-${validPostId}`)
      revalidateTag(`attachments-post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag(validPostId)
    } catch {}

    return ApiSuccess.ok(null).toNextResponse()
  } catch (e: any) {
    console.error('[API] 댓글 삭제 예외 발생:', e)
    return ApiError.internalServerError('요청 처리에 실패했습니다.').toNextResponse()
  }
}
