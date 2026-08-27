import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { deleteComment, getCommentById } from '@/db/queries/comments'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { isApprovedActiveAdmin } from '@/lib/server/authz'

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

    const comment = await getCommentById(validCommentId, validPostId)
    if (!comment) return ApiError.notFound('Not found').toNextResponse()

    // 작성자 본인 또는 관리자만 삭제할 수 있다.
    //
    // 예전에는 작성자만 허용했다(주석에 "or admin if needed"라고만 적혀
    // 있었다). Postgres 시절에는 `Admins can manage all comments` RLS 정책이
    // 있어서 **Supabase 대시보드**로 지웠는데, 컷오버로 그 대시보드가
    // 사라지면서 **스팸·비방 댓글을 지울 경로가 0개**가 됐다(적대 감사
    // 2026-08-27, 관리자 세션 DELETE → 403 실측). 게시글 삭제(`posts/[id]`)는
    // 이미 같은 규칙이므로 그쪽에 맞춘다.
    //
    // 조회 실패는 "관리자 아님"으로 흡수한다(fail-closed) — 형제 라우트와 같다.
    const isAdmin = isApprovedActiveAdmin(await getProfileById(userId).catch(() => null))
    if (comment.author_id !== userId && !isAdmin) {
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
