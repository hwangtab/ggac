import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/utils/apiWrapper'
import { requireAdmin } from '@/lib/server/adminAuth'
import { rateLimit } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'
import {
  contentDispositionAttachment,
  isSafeMailboxAttachmentPath,
} from '@/lib/storage/mailboxAttachments'
import { getPrivateObject } from '@/lib/storage/blob'
import { getAttachment } from '@/db/queries/mailbox'

const log = createLogger('admin/mailbox/attachments/download')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 메일함 첨부 다운로드.
 *
 * 서명 URL을 발급하지 않는다 — 이사회 서류 다운로드와 같은 이유다. 매 요청마다
 * requireAdmin()을 통과해야 하므로 관리자 권한 회수가 즉시 반영된다.
 *
 * 신뢰 경계: 사용자가 넘기는 값은 첨부 id(UUID) 하나뿐이다. 저장소 경로는
 * DB 행에서만 온다. 그 값도 그대로 믿지 않고 봉쇄 판정을 한 번 더 통과시킨다 —
 * 같은 비공개 저장소에 `backups/` 접두어로 조합 DB 전체 덤프가 함께 살기
 * 때문이다. 경로가 봉쇄를 벗어나면 관리자 인가만 통과한 요청이 그 덤프를
 * 내려받을 수 있다.
 *
 * 스트리밍 응답이라 `defineApiRoute` 래퍼 밖에서 GET을 직접 export한다 —
 * 던져진 예외를 앱 형식 JSON으로 바꿔 줄 상위 계층이 없으므로 모든 예외를
 * 손으로 감싼다.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const rl = await rateLimit(request, 'GENERAL_API')
    if (!rl.success) {
      return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    const params = await context.params
    const validation = validateUUID(params.id, '첨부 ID')
    if (!validation.isValid) {
      return ApiError.badRequest(
        validation.errors[0] || '잘못된 첨부 ID 형식입니다.'
      ).toNextResponse()
    }
    const id = validation.sanitized

    const gate = await requireAdmin()
    if (gate instanceof NextResponse) return gate

    let attachment: Awaited<ReturnType<typeof getAttachment>>
    try {
      attachment = await getAttachment(id)
    } catch (queryError) {
      log.error('첨부 조회 실패', {
        id,
        error: queryError instanceof Error ? queryError.message : String(queryError),
      })
      return ApiError.internalServerError('첨부를 조회할 수 없습니다.').toNextResponse()
    }

    if (!attachment) {
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    // 저장소 경로는 DB에서만 온다. 그래도 다시 검증한다 —
    // 비공개 저장소에는 조합 DB 전체 덤프가 함께 산다.
    const path = String(attachment.blob_path ?? '')
    if (!isSafeMailboxAttachmentPath(path)) {
      logSecurityEvent('MAILBOX_ATTACHMENT_PATH_REJECTED', { id }, 'high')
      log.error('안전하지 않은 첨부 경로 차단', { id })
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    const ifNoneMatch = request.headers.get('if-none-match') ?? undefined

    let object
    try {
      object = await getPrivateObject(path, ifNoneMatch)
    } catch (streamError) {
      log.error('첨부 스트리밍 실패', {
        id,
        error: streamError instanceof Error ? streamError.message : String(streamError),
      })
      return ApiError.internalServerError('첨부를 불러올 수 없습니다.').toNextResponse()
    }

    if (!object) {
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    const headers = new Headers()
    headers.set('Content-Type', object.contentType || 'application/octet-stream')
    headers.set(
      'Content-Disposition',
      contentDispositionAttachment(String(attachment.filename ?? 'attachment'))
    )
    // 비공개 자원이다. 어떤 공유 캐시에도 남기지 않는다.
    headers.set('Cache-Control', 'private, no-store')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (object.etag) headers.set('ETag', object.etag)

    if (object.statusCode === 304) {
      return new NextResponse(null, { status: 304, headers })
    }

    if (!object.stream) {
      log.error('스트림이 비어 있음', { id, statusCode: object.statusCode })
      return ApiError.internalServerError('첨부를 불러올 수 없습니다.').toNextResponse()
    }

    return new NextResponse(object.stream, { status: 200, headers })
  } catch (error) {
    log.error('첨부 다운로드 처리 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
    return ApiError.internalServerError('첨부를 내려받을 수 없습니다.').toNextResponse()
  }
}
