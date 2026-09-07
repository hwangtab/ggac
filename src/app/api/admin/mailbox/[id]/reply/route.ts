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
    const id = String(params.id ?? '')
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

    await sendEmail({
      to: String(email.from_address),
      subject,
      html,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

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

    return ApiSuccess.ok({ id, subject })
  },
})
