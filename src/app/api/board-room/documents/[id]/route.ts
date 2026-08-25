import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { deleteBoardDocumentEverywhere } from '@/lib/storage/privateProvider'
import { validateUUID } from '@/utils/validation'
import { deleteDocument, getDocumentForDelete } from '@/db/queries/board'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

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
  const { user, isAdmin } = auth

  return apiDelete(
    async () => {
      // Load row to get uploader and storage path
      const doc = await getDocumentForDelete(id)
      if (!doc) throw ApiError.notFound('서류를 찾을 수 없습니다.')

      // Authorization: uploader or admin only
      if (doc.uploaded_by !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')

      // 저장소 객체를 먼저 지운다. 실패해도 메타데이터 행 삭제는 진행한다 —
      // 지울 수 없는 레코드가 남는 쪽이 더 나쁘다.
      //
      // 양쪽 제공자에서 지우는 이유: 복사본이 Supabase와 Blob 양쪽에 남아 있는
      // 전환기라, 한쪽만 지우면 롤백 후 삭제한 문서가 되살아난다.
      if (isSafeBoardDocumentFilePath(doc.file_path)) {
        try {
          await deleteBoardDocumentEverywhere(doc.file_path)
        } catch (storageErr) {
          log.error('storage 객체 삭제 실패', {
            id,
            path: doc.file_path,
            error: storageErr instanceof Error ? storageErr.message : String(storageErr),
          })
        }
      } else {
        log.error('안전하지 않은 서류 file_path 삭제 건너뜀', {
          id,
          path: doc.file_path,
        })
      }

      // Delete metadata row
      try {
        await deleteDocument(id)
      } catch {
        throw ApiError.internalServerError('서류 삭제에 실패했습니다.')
      }

      return ApiSuccess.ok({ id }, '서류가 삭제되었습니다.')
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
}
