import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'

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
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id
    if (!userId) return ApiError.unauthorized('Unauthorized').toNextResponse()

    // Verify ownership (or admin if needed)
    const { data: comment } = await supabase
      .from('comments')
      .select('id, author_id')
      .eq('id', validCommentId)
      .eq('post_id', validPostId)
      .maybeSingle()
    if (!comment) return ApiError.notFound('Not found').toNextResponse()
    if ((comment as any).author_id !== userId) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', validCommentId)
      .eq('post_id', validPostId)
    if (error) {
      console.error('[API] 댓글 삭제 실패:', error)
      return ApiError.internalServerError('댓글 삭제에 실패했습니다.').toNextResponse()
    }

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
