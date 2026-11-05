import { NextRequest, NextResponse } from 'next/server'
import {
  getBoardDocumentForEdit,
  getBoardDocumentVersion,
} from '@/db/queries/boardDocumentVersions'
import { requireBoardMember, visibilityScopeFor } from '@/lib/server/boardRoomAuth'
import { boardDocumentNotFound, isUuid } from '@/lib/server/boardDocumentEditRoute'
import { rateLimit } from '@/lib/server/rateLimit'
import {
  contentDispositionAttachment,
  isSafeBoardDocumentFilePath,
} from '@/lib/storage/boardDocuments'
import { getBoardDocumentStream } from '@/lib/storage/privateProvider'
import { ApiError } from '@/utils/apiWrapper'
import { logSecurityEvent } from '@/utils/security'

export const runtime = 'nodejs'

/**
 * GET /api/board-room/documents/<서류 id>/versions/<버전 id>/download — 지나간 버전 내려받기
 * (docs/board-work/05-이사회-서류-앱-편집.md §4). 최신 버전은 기존 `/download`가 그대로 낸다.
 *
 * 게이트: requireBoardMember — **조합원은 403**(조합원 공개 서류도 지금 파일만 본다 — 지나간 버전은 이사회 안의 기록).
 * 버전은 **이 서류의 것만** 찾는다(서류 id 를 WHERE 에 함께 넣는다 — 남의 서류 버전 id 는 404). 서류가 없거나 이사회에도
 * 보이지 않는 등급이면 404. 경로는 DB 행에서만 오고 봉쇄 판정(`isSafeBoardDocumentFilePath`)을 지나야 스트리밍한다 —
 * 같은 비공개 저장소에 DB 백업이 있다. 응답 모양은 기존 다운로드 라우트와 같다(첨부·캐시 금지·nosniff).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> }
) {
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { id, versionId } = await ctx.params
  if (!isUuid(id) || !isUuid(versionId)) return boardDocumentNotFound()

  let doc: Awaited<ReturnType<typeof getBoardDocumentForEdit>>
  let version: Awaited<ReturnType<typeof getBoardDocumentVersion>>
  try {
    ;[doc, version] = await Promise.all([
      getBoardDocumentForEdit(id),
      getBoardDocumentVersion(id, versionId),
    ])
  } catch {
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }
  if (!doc || !visibilityScopeFor(true).includes(doc.visibility)) return boardDocumentNotFound()
  if (!version) return boardDocumentNotFound('버전을 찾을 수 없습니다.')
  if (!isSafeBoardDocumentFilePath(version.filePath)) {
    logSecurityEvent('BOARD_DOCUMENT_VERSION_PATH_REJECTED', { documentId: id }, 'high')
    return boardDocumentNotFound('버전을 찾을 수 없습니다.')
  }

  let object: Awaited<ReturnType<typeof getBoardDocumentStream>>
  try {
    object = await getBoardDocumentStream(
      version.filePath,
      request.headers.get('if-none-match') ?? undefined
    )
  } catch {
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }
  if (!object) return ApiError.notFound('서류 파일을 찾을 수 없습니다.').toNextResponse()

  const headers = new Headers()
  headers.set('Content-Type', version.mimeType || object.contentType || 'application/octet-stream')
  headers.set('Content-Disposition', contentDispositionAttachment(version.fileName))
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (object.etag) headers.set('ETag', object.etag)
  if (object.statusCode === 304) return new NextResponse(null, { status: 304, headers })
  if (!object.stream) {
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }
  return new NextResponse(object.stream, { status: 200, headers })
}
