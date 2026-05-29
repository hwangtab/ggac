import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'

export const runtime = 'nodejs'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiDelete(
    async () => {
      const { data: doc, error: loadErr } = await db
        .from('board_documents')
        .select('uploaded_by')
        .eq('id', id)
        .single()
      if (loadErr || !doc) throw ApiError.notFound('서류를 찾을 수 없습니다.')
      if (doc.uploaded_by !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')
      const { error } = await db.from('board_documents').delete().eq('id', id)
      if (error) throw ApiError.internalServerError('서류 삭제에 실패했습니다.')
      return ApiSuccess.ok({ id }, '서류가 삭제되었습니다.')
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
}
