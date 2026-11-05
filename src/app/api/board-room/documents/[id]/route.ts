import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, apiGet, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardRecordReader,
  visibilityScopeFor,
} from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { deleteBoardDocument } from '@/lib/storage/privateProvider'
import { validateUUID } from '@/utils/validation'
import { deleteDocument, getDocumentDetail, getDocumentForDelete } from '@/db/queries/board'
import { listBoardDocumentVersionPaths } from '@/db/queries/boardDocumentVersions'
import { removeBoardDocumentVersionFiles } from '@/lib/boardDocuments/cleanup'
import { removeBoardDocumentRenderCache } from '@work/lib/files/render-cache-cleanup'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

function validateDocumentId(id: string) {
  const validation = validateUUID(id, '서류 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 서류 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

/**
 * 서류 한 건의 본문까지 낸다. 열람 게이트이므로 조합원도 들어오는데,
 * **목록에서 걸렀으니 됐다고 보지 않고 여기서 다시 판정한다.** 권한 밖
 * 자료는 403이 아니라 404를 준다 — 존재 여부 자체를 알리지 않는다.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateDocumentId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardRecordReader()
  if (auth instanceof NextResponse) return auth
  const { user, isBoardMember } = auth

  return apiGet(
    async () => {
      const document = await getDocumentDetail(id)
      if (!document) throw ApiError.notFound('서류를 찾을 수 없습니다.')
      if (!visibilityScopeFor(isBoardMember).includes(document.visibility)) {
        throw ApiError.notFound('서류를 찾을 수 없습니다.')
      }
      return ApiSuccess.ok({ document })
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
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

      // 앱 편집 버전 기록(05 §6)의 객체 경로는 행이 CASCADE 로 지워지기 **전에** 읽어 둔다. 지우는 순서는 아래 주석과
      // 같다 — 행 먼저, 객체는 그 뒤(실패해도 고아 객체로만 남는다).
      let versionPaths: string[] = []
      try {
        versionPaths = await listBoardDocumentVersionPaths(id)
      } catch {
        throw ApiError.internalServerError('서류 삭제에 실패했습니다.')
      }

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

      // 앱 편집 버전 파일(`board-documents/versions/<id>/…` + v1 의 옛 경로)도 같은 이유·같은 순서로 지운다 — 행은 이미
      // 없다. 승격 전에 끊긴 저장본(행 없는 객체)도 접두로 찾아 함께 지운다. 실패해도 삭제는 성공이다(로그만 남긴다).
      await removeBoardDocumentVersionFiles(id, versionPaths, doc.file_path, storageErr => {
        log.error('버전 파일 삭제 실패', {
          id,
          error: storageErr instanceof Error ? storageErr.message : String(storageErr),
        })
      })

      // 자료실 미리보기 캐시(`board-work/renders/<id>-…`, 03 §10)도 지운다. 업무툴 저장소 계층을 거쳐
      // 이 서류 id 로 시작하는 캐시 키만 지우고(경로 가드 `isSafeBoardWorkPath`), 실패해도 삭제는 성공이다 —
      // 행이 없으니 미리보기 라우트가 그 캐시를 다시 열지 않는다(저장소에 남을 뿐이다).
      await removeBoardDocumentRenderCache(id, cacheErr => {
        log.warn('미리보기 캐시 삭제 실패', {
          id,
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        })
      })

      return ApiSuccess.ok({ id }, '서류가 삭제되었습니다.')
    },
    `/api/board-room/documents/${id}`,
    { userId: user.id }
  )
}
