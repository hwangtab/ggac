import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { deleteBoardDocument } from '@/lib/storage/privateProvider'
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

      // **DB 행을 먼저 지우고, 그 다음 Storage 파일을 지운다.** 순서가 중요하다
      // — 첨부 라우트(`src/app/api/posts/[id]/attachments/[attachmentId]/route.ts`)와
      // 같은 근거로 통일한다. 반대로 하면(예전 이 라우트의 순서) Storage 삭제
      // 성공 뒤 DB 삭제가 실패했을 때 파일은 사라졌는데 행은 남아 다운로드가
      // 404로 죽는다. 지금 순서에서 최악은 "DB에는 없는데 Storage에 파일만
      // 남는" 고아 파일인데, 이건 아무 화면도 깨뜨리지 않고 용량만 조금 쓴다 —
      // 되돌릴 수 없는 쪽이 아니라 되돌릴 수 있는 쪽으로 실패하게 만든다.
      try {
        await deleteDocument(id)
      } catch {
        throw ApiError.internalServerError('서류 삭제에 실패했습니다.')
      }

      // Storage에서 파일 삭제 (가능한 경우에만). 여기서 실패해도 사용자에게는
      // 삭제 성공이다 — DB 행이 이미 없으므로 화면에서는 사라졌다.
      if (isSafeBoardDocumentFilePath(doc.file_path)) {
        try {
          await deleteBoardDocument(doc.file_path)
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

      return ApiSuccess.ok({ id }, '서류가 삭제되었습니다.')
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
}
