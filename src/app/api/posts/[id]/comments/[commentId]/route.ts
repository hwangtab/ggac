import { NextRequest, NextResponse } from 'next/server'
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
    return NextResponse.json({ success: false, error: postIdValidation.errors[0] }, { status: 400 })
  }
  const commentIdValidation = validateUUID(commentId, '댓글 ID')
  if (!commentIdValidation.isValid) {
    return NextResponse.json(
      { success: false, error: commentIdValidation.errors[0] },
      { status: 400 }
    )
  }

  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id
    if (!userId)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    // Verify ownership (or admin if needed)
    const { data: comment } = await supabase
      .from('comments')
      .select('id, author_id')
      .eq('id', commentId)
      .maybeSingle()
    if (!comment) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    if ((comment as any).author_id !== userId) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 })
    }

    const { error } = await supabase.from('comments').delete().eq('id', commentId)
    if (error) {
      console.error('[API] 댓글 삭제 실패:', error)
      return NextResponse.json(
        { success: false, error: '댓글 삭제에 실패했습니다.' },
        { status: 500 }
      )
    }

    try {
      revalidateTag(`comments-post-${postId}`)
      revalidateTag(`attachments-post-${postId}`)
      revalidateTag('board-post')
      revalidateTag(postId)
    } catch {}

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[API] 댓글 삭제 예외 발생:', e)
    return NextResponse.json(
      { success: false, error: '요청 처리에 실패했습니다.' },
      { status: 500 }
    )
  }
}
