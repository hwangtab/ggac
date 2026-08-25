import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { rateLimit } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import {
  contentDispositionAttachment,
  isSafeBoardDocumentFilePath,
} from '@/lib/storage/boardDocuments'
import { getBoardDocumentStream } from '@/lib/storage/privateProvider'
import { getDocumentForDownload } from '@/db/queries/board'

const log = createLogger('boardRoom/documents/download')

export const runtime = 'nodejs'

/**
 * 이사회 서류 다운로드.
 *
 * 예전에는 목록 API가 300초짜리 Supabase 서명 URL을 만들어 브라우저에 넘겼다.
 * 그 방식은 발급 후 5분 동안 **권한을 잃은 사람에게도 유효하다** — 이사에서
 * 해임된 계정이 목록을 한 번 열어두면 그 URL이 계속 산다. 여기서는 매 요청마다
 * requireBoardMember()를 통과해야 하므로 권한 회수가 즉시 반영된다.
 *
 * 신뢰 경계: 사용자가 넘기는 값은 문서 id(UUID) 하나뿐이다. 저장소 경로는
 * DB 행에서만 온다. 그 값도 그대로 믿지 않고 봉쇄 판정을 한 번 더 통과시킨다 —
 * 비공개 저장소에 조합 DB 덤프가 함께 살기 때문이다.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const params = await context.params
  const validation = validateUUID(params.id, '서류 ID')
  if (!validation.isValid) {
    return ApiError.badRequest(
      validation.errors[0] || '잘못된 서류 ID 형식입니다.'
    ).toNextResponse()
  }
  const id = validation.sanitized

  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // Task 4: board_documents 권위가 Turso로 옮겨졌다 — 조회는
  // getDocumentForDownload(id)로 바뀌었지만 권한 재검증(requireBoardMember()가
  // 이 DB 조회보다 먼저 실행됨)과 봉쇄 판정 순서는 그대로다.
  const doc = await getDocumentForDownload(id)

  if (!doc) {
    return ApiError.notFound('서류를 찾을 수 없습니다.').toNextResponse()
  }

  if (!isSafeBoardDocumentFilePath(doc.file_path)) {
    log.error('안전하지 않은 서류 경로 차단', { id, userId: user.id })
    return ApiError.notFound('서류를 찾을 수 없습니다.').toNextResponse()
  }

  const ifNoneMatch = request.headers.get('if-none-match') ?? undefined

  let object
  try {
    object = await getBoardDocumentStream(doc.file_path, ifNoneMatch)
  } catch (streamError) {
    log.error('서류 스트리밍 실패', {
      id,
      error: streamError instanceof Error ? streamError.message : String(streamError),
    })
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }

  if (!object) {
    log.error('저장소에 서류 객체 없음', { id, path: doc.file_path })
    return ApiError.notFound('서류 파일을 찾을 수 없습니다.').toNextResponse()
  }

  const headers = new Headers()
  headers.set('Content-Type', doc.mime_type || object.contentType || 'application/octet-stream')
  headers.set('Content-Disposition', contentDispositionAttachment(doc.file_name))
  // 이사회 전용 문서다. 어떤 공유 캐시에도 남기지 않는다.
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (object.etag) headers.set('ETag', object.etag)

  if (object.statusCode === 304) {
    return new NextResponse(null, { status: 304, headers })
  }

  if (!object.stream) {
    log.error('스트림이 비어 있음', { id, statusCode: object.statusCode })
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }

  return new NextResponse(object.stream, { status: 200, headers })
}
