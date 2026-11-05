import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import {
  countInboundSince,
  countOutboundRecipientsSince,
  getInboundEmail,
  insertReply,
  appendThreadReference,
  updateInboundStatus,
} from '@/db/queries/mailbox'
import { MailSendError, sendEmail } from '@/lib/mail/send'
import { parseAllowedRecipients } from '@/lib/mail/inboundRecipients'
import { buildReplyQuote, replyRecipients, replySubject } from '@/lib/mail/replyCompose'
import { dailyOutboundLimit, dailyTotalGuard, evaluateQuota } from '@/lib/mail/composeQuota'
import { sanitizePostHtml } from '@/utils/sanitizePostHtml'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: 받은 메일에 답장을 보내고 스레드를 잇는다.
// - 받는 사람은 `Reply-To`(없으면 보낸 사람), `reply_all`이면 원본의 받는 사람·참조를 참조로 넣는다(우리 주소는 뺀다).
//   **서버가 정한다** — 화면은 같은 함수(`replyRecipients`)로 미리 보여 줄 뿐 받는 사람을 보내지 않는다.
// - `include_quote`(기본 켬)면 원문 평문을 인용으로 붙인다. 받은 HTML은 다시 내보내지 않는다(`buildReplyQuote`).
export const POST = defineApiRoute<{
  body_html?: string
  reply_all?: boolean
  include_quote?: boolean
}>({
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

    const recipients = replyRecipients(
      {
        from_address: String(email.from_address ?? ''),
        headers: email.headers,
        to_addresses: email.to_addresses,
        cc_addresses: email.cc_addresses,
        received_for: email.received_for,
      },
      {
        all: body?.reply_all === true,
        ownAddresses: parseAllowedRecipients(process.env.MAILBOX_ALLOWED_RECIPIENTS),
      }
    )
    if (!recipients) {
      throw ApiError.badRequest('답장을 받을 주소를 알 수 없습니다.')
    }

    // 일일 상한 — 새 메일 작성과 **같은 쿼터**다. 답장은 한도에 세어지기만 하고 스스로는 막히지 않던 것을
    // 바로잡는다(Resend 하루 쿼터는 인증·다이제스트 메일과 공유한다). 답장은 발송 전에 행을 쓰지 않으므로
    // 이번 답장의 받는 사람 수(전체 답장이면 참조까지)를 더해서 판정한다.
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000
    const [outboundCount, inboundCount] = await Promise.all([
      countOutboundRecipientsSince(sinceMs),
      countInboundSince(sinceMs),
    ])
    const verdict = evaluateQuota(outboundCount + recipients.recipientCount, inboundCount, {
      outbound: dailyOutboundLimit(),
      total: dailyTotalGuard(),
    })
    if (verdict.allowed === false) {
      logSecurityEvent(
        'MAILBOX_COMPOSE_DAILY_LIMIT_REACHED',
        { via: 'reply', reason: verdict.reason, outboundCount, inboundCount },
        'high'
      )
      throw ApiError.tooManyRequests(
        '오늘 보낼 수 있는 메일 한도에 도달했습니다. 내일 다시 시도해 주세요.'
      )
    }

    const subject = replySubject(email.subject as string | null)

    // 관리자가 쓴 HTML이지만 그대로 내보내지 않는다 — 편집기에서 붙여 넣은
    // 외부 마크업이 그대로 나가면 수신자 쪽에서 문제가 된다.
    // 저장소에 이미 있는 정화기를 쓴다(`src/utils/sanitizePostHtml.ts`) —
    // 메일 전용 옵션을 새로 만들 이유가 없다.
    // 인용은 정화 **뒤에** 붙인다 — 전부 이스케이프한 우리 HTML이라 정화할 것이 없고, 정화기가 인용 테두리
    // 스타일을 지우지 않게 한다.
    const quote =
      body?.include_quote === false
        ? null
        : buildReplyQuote({
            from_address: String(email.from_address ?? ''),
            received_at: (email.received_at as string | null) ?? null,
            body_text: (email.body_text as string | null) ?? null,
          })
    const html = sanitizePostHtml(rawHtml) + (quote ?? '')

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
    // 여기서 던져 재시도를 유도하는 것이 옳다. 상태를 `replied`로 옮기는 것도
    // 회신 원장에 줄을 남기는 것도 이 await 뒤에만 일어난다 — 나간 것이
    // 확인된 메일만 "답장함"이 된다.
    let resendMessageId: string | null
    try {
      resendMessageId = await sendEmail({
        to: recipients.to,
        ...(recipients.cc.length > 0 ? { cc: recipients.cc } : {}),
        subject,
        html,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })
    } catch (error) {
      // 타임아웃·네트워크 오류는 요청이 Resend에 닿았는지 모른다 — 메일이 이미 나갔을 수 있다.
      // 실패(500)로 돌려주면 화면이 "실패"를 보여 주고 관리자가 다시 눌러 같은 답장이 한 번 더
      // 나간다. 그래서 던지지 않고 "확인 필요"로 돌려주며, 여기서는 기록도 남기지 않는다(나갔는지
      // 모르는 메일을 "답장함"으로 만들지 않는다). 키 누락·HTTP 거절은 안 나간 것이 확실하므로
      // 예전처럼 던져 재시도를 유도한다.
      if (error instanceof MailSendError && error.kind === 'unknown') {
        logSecurityEvent(
          'MAILBOX_REPLY_SEND_UNKNOWN',
          { emailId: id, error: error.message },
          'high'
        )
        return ApiSuccess.ok({
          id,
          subject,
          to: recipients.to,
          cc: recipients.cc,
          recorded: false,
          status: 'unknown',
        })
      }
      throw error
    }

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
        // Resend가 매긴 식별자. 지금까지 null로 박아 넣고 있어서, 발송한
        // 답장을 Resend 쪽 기록과 맞춰 볼 수단이 없었다.
        resend_message_id: resendMessageId,
        to_address: recipients.to,
        cc_addresses: recipients.cc,
        recipient_count: recipients.recipientCount,
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

    return ApiSuccess.ok({
      id,
      subject,
      to: recipients.to,
      cc: recipients.cc,
      recorded,
      status: 'sent',
    })
  },
})
