import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import {
  getInboundEmail,
  insertReply,
  appendThreadReference,
  updateInboundStatus,
} from '@/db/queries/mailbox'
import { sendEmail } from '@/lib/mail/send'
import { sanitizePostHtml } from '@/utils/sanitizePostHtml'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: 받은 메일에 답장을 보내고 스레드를 잇는다
export const POST = defineApiRoute<{ body_html?: string }>({
  method: 'POST',
  name: 'api/admin/mailbox/[id]/reply',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox_reply'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body, params, auth }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized
    const rawHtml = String(body?.body_html ?? '').trim()
    if (!rawHtml) {
      throw ApiError.badRequest('답장 내용이 비어 있습니다.')
    }
    if (rawHtml.length > 200_000) {
      throw ApiError.badRequest('답장이 너무 깁니다.')
    }

    const email = await getInboundEmail(id)
    if (!email) {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }

    const originalSubject = String(email.subject ?? '(제목 없음)')
    const subject = originalSubject.startsWith('Re: ') ? originalSubject : `Re: ${originalSubject}`

    // 관리자가 쓴 HTML이지만 그대로 내보내지 않는다 — 편집기에서 붙여 넣은
    // 외부 마크업이 그대로 나가면 수신자 쪽에서 문제가 된다.
    // 저장소에 이미 있는 정화기를 쓴다(`src/utils/sanitizePostHtml.ts`) —
    // 메일 전용 옵션을 새로 만들 이유가 없다.
    const html = sanitizePostHtml(rawHtml)

    const messageId = email.message_id ? String(email.message_id) : null
    const references = String(email.thread_references ?? '')
      .split(' ')
      .filter(Boolean)
    if (messageId && !references.includes(messageId)) {
      references.push(messageId)
    }

    const headers: Record<string, string> = {}
    if (messageId) headers['In-Reply-To'] = messageId
    if (references.length > 0) headers['References'] = references.join(' ')

    // 발송 자체가 실패하면(키 누락·Resend HTTP 오류) 메일이 안 나갔으니
    // 여기서 던져 재시도를 유도하는 것이 옳다.
    await sendEmail({
      to: String(email.from_address),
      subject,
      html,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    // 여기서부터는 메일이 이미 나간 뒤다 — 발송은 되돌릴 수 없다. 아래
    // 기록(회신 원장·스레드 참조·상태 전이) 중 하나가 실패해도 던지지
    // 않는다. 던지면 라우트가 500을 내고, 화면은 "실패"로 보여주며, 관리자는
    // 당연히 다시 누른다 — 그러면 이미 나간 메일이 수신자에게 한 번 더
    // 간다. 되돌릴 수 없는 일이 성공한 뒤의 부수 기록 실패는 "발송 성공,
    // 기록만 실패"로 감사하고 200을 준다. 화면(Task 13)이 `recorded`를 보고
    // 사람이 확인해야 한다는 것을 표시한다.
    let recorded = true
    try {
      await insertReply({
        email_id: id,
        sent_by: auth?.user?.id ?? null,
        subject,
        body_html: html,
        resend_message_id: null,
      })
      if (messageId) {
        await appendThreadReference(id, messageId)
      }
      // 상태를 replied로 옮긴다. 이미 다른 상태여도 답장 사실이 우선이다.
      await updateInboundStatus(id, String(email.status), 'replied')
    } catch (error) {
      recorded = false
      logSecurityEvent(
        'MAILBOX_REPLY_RECORD_FAILED',
        {
          emailId: id,
          error: error instanceof Error ? error.message : String(error),
        },
        'high'
      )
    }

    return ApiSuccess.ok({ id, subject, recorded })
  },
})
