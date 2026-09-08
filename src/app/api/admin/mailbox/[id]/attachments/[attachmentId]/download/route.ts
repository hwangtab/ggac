import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
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
import { logUserActivity } from '@/db/queries/activities'

const log = createLogger('admin/mailbox/[id]/attachments/[attachmentId]/download')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 메일함 첨부 다운로드 — 이사·감사·관리자 열람(브리프 A~C).
 *
 * 서명 URL을 발급하지 않는다 — 이사회 서류 다운로드와 같은 이유다. 매 요청마다
 * requireBoardMember()를 통과해야 하므로 권한 회수가 즉시 반영된다.
 *
 * 신뢰 경계: 사용자가 넘기는 값은 메일 id·첨부 id(둘 다 UUID)뿐이다. 저장소
 * 경로는 DB 행에서만 온다. 그 값도 그대로 믿지 않고 봉쇄 판정을 한 번 더
 * 통과시킨다 — 같은 비공개 저장소에 `backups/` 접두어로 조합 DB 전체 덤프가
 * 함께 살기 때문이다.
 *
 * 스코프 대조(브리프 B, 이번 변경의 핵심 보안 수정): 옛 경로는 첨부 id만으로
 * 찾고 그 첨부가 어느 메일 것인지 묻지 않았다. 관리자만 쓸 때는 무해했지만
 * 열람자가 이사·감사로 늘면 구멍이다 — 메일 A의 첨부 id를 메일 B의 경로에
 * 넣어도 통과해 버린다. 그래서 첨부 행의 email_id가 경로의 id와 같은지
 * 반드시 대조하고, 다르면 첨부가 없는 것과 같은 404를 준다(존재 여부를
 * 흘리지 않는다).
 *
 * 기록(브리프 C): 누가 언제 무엇을 받았는지 `logUserActivity`로 남긴다.
 * 스트리밍 시작 전에 남긴다 — 스트리밍 중 끊기면 기록이 안 남는 순서를
 * 피한다. 기록 실패는 다운로드를 막지 않는다 — try/catch로 감싸고 실패는
 * `logSecurityEvent`로만 남긴다.
 *
 * 스트리밍 응답이라 `defineApiRoute` 래퍼 밖에서 GET을 직접 export한다 —
 * 던져진 예외를 앱 형식 JSON으로 바꿔 줄 상위 계층이 없으므로 모든 예외를
 * 손으로 감싼다.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const rl = await rateLimit(request, 'GENERAL_API')
    if (!rl.success) {
      return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    const params = await context.params
    const emailIdValidation = validateUUID(params.id, '메일 ID')
    if (!emailIdValidation.isValid) {
      return ApiError.badRequest(
        emailIdValidation.errors[0] || '잘못된 메일 ID 형식입니다.'
      ).toNextResponse()
    }
    const emailId = emailIdValidation.sanitized

    const attachmentIdValidation = validateUUID(params.attachmentId, '첨부 ID')
    if (!attachmentIdValidation.isValid) {
      return ApiError.badRequest(
        attachmentIdValidation.errors[0] || '잘못된 첨부 ID 형식입니다.'
      ).toNextResponse()
    }
    const attachmentId = attachmentIdValidation.sanitized

    const gate = await requireBoardMember()
    if (gate instanceof NextResponse) return gate
    const { user, isAdmin } = gate

    let attachment: Awaited<ReturnType<typeof getAttachment>>
    try {
      attachment = await getAttachment(attachmentId)
    } catch (queryError) {
      log.error('첨부 조회 실패', {
        id: attachmentId,
        error: queryError instanceof Error ? queryError.message : String(queryError),
      })
      return ApiError.internalServerError('첨부를 조회할 수 없습니다.').toNextResponse()
    }

    if (!attachment) {
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    // 스코프 대조 — 첨부가 경로의 메일 것이 아니면 존재하지 않는 것과 같은
    // 404를 준다. 메일 A의 첨부 id를 메일 B의 경로에 넣는 시도를 막는다.
    if (String(attachment.email_id ?? '') !== emailId) {
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    // 저장소 경로는 DB에서만 온다. 그래도 다시 검증한다 —
    // 비공개 저장소에는 조합 DB 전체 덤프가 함께 산다.
    const path = String(attachment.blob_path ?? '')
    if (!isSafeMailboxAttachmentPath(path)) {
      logSecurityEvent('MAILBOX_ATTACHMENT_PATH_REJECTED', { id: attachmentId }, 'high')
      log.error('안전하지 않은 첨부 경로 차단', { id: attachmentId })
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    const ifNoneMatch = request.headers.get('if-none-match') ?? undefined

    let object
    try {
      object = await getPrivateObject(path, ifNoneMatch)
    } catch (streamError) {
      log.error('첨부 스트리밍 실패', {
        id: attachmentId,
        error: streamError instanceof Error ? streamError.message : String(streamError),
      })
      return ApiError.internalServerError('첨부를 불러올 수 없습니다.').toNextResponse()
    }

    if (!object) {
      return ApiError.notFound('첨부를 찾을 수 없습니다.').toNextResponse()
    }

    // 기록은 스트리밍 시작 전에 남긴다 — 스트리밍 중 끊기면 기록이 안 남는
    // 순서를 피한다. 실패해도 다운로드(본 작업)를 막지 않는다.
    try {
      await logUserActivity({
        user_id: user.id,
        action_type: 'attachment_downloaded',
        target_type: 'inbound_email_attachment',
        target_id: attachmentId,
        metadata: {
          email_id: emailId,
          filename: String(attachment.filename ?? ''),
          size_bytes: attachment.size_bytes ?? null,
          is_admin: isAdmin,
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (logError) {
      logSecurityEvent(
        'MAILBOX_DOWNLOAD_AUDIT_FAILED',
        {
          attachmentId,
          emailId,
          error: logError instanceof Error ? logError.message : String(logError),
        },
        'high'
      )
      log.error('첨부 다운로드 기록 실패', {
        id: attachmentId,
        error: logError instanceof Error ? logError.message : String(logError),
      })
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
      log.error('스트림이 비어 있음', { id: attachmentId, statusCode: object.statusCode })
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
