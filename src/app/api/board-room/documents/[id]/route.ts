import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'
import { isSafeBoardDocumentStoragePath } from '@/utils/boardDocumentStoragePath'
import { validateUUID } from '@/utils/validation'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

const BUCKET = 'board-documents'

function validateDocumentId(id: string) {
  const validation = validateUUID(id, '서류 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 서류 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateDocumentId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
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
      const safeFilePath = isSafeBoardDocumentStoragePath(doc.file_path, doc.uploaded_by)
        ? doc.file_path
        : null

      if (safeFilePath) {
        const { error: storageErr } = await db.storage.from(BUCKET).remove([safeFilePath])
        if (storageErr) {
          log.error('storage 객체 삭제 실패', {
            id,
            path: safeFilePath,
            error: storageErr.message,
          })
        }
      } else {
        log.error('안전하지 않은 서류 file_path 삭제 건너뜀', {
          id,
          path: doc.file_path,
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
