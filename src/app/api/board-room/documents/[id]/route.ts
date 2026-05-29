import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

const BUCKET = 'board-documents'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiDelete(
    async () => {
      // Load row to get uploader and storage path
      const { data: doc, error: loadErr } = await db
        .from('board_documents')
        .select('uploaded_by, file_path')
        .eq('id', id)
        .single()
      if (loadErr || !doc) throw ApiError.notFound('서류를 찾을 수 없습니다.')

      // Authorization: uploader or admin only
      if (doc.uploaded_by !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')

      // Delete storage object first (log-and-continue on failure to avoid undeletable records)
      const { error: storageErr } = await db.storage.from(BUCKET).remove([doc.file_path])
      if (storageErr) {
        log.error('storage 객체 삭제 실패', {
          id,
          path: doc.file_path,
          error: storageErr.message,
        })
      }

      // Delete metadata row
      const { error: deleteErr } = await db.from('board_documents').delete().eq('id', id)
      if (deleteErr) throw ApiError.internalServerError('서류 삭제에 실패했습니다.')

      return ApiSuccess.ok({ id }, '서류가 삭제되었습니다.')
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
}
