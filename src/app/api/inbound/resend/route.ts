/**
 * Resend Inbound 웹훅.
 *
 * `defineApiRoute` 밖에서 POST를 직접 export하는 이유: Svix 검증이 **원문 body**를
 * 요구해 `request.text()`로 받아야 한다. 서명 검증 자체가 이 라우트의 게이트다.
 *
 * **어떤 경우에도 500을 내지 않는다**(서명 실패의 401만 예외). 500을 주면
 * Resend가 재시도하고, 그 재시도가 다시 쿼터를 먹는다.
 */
import type { NextRequest } from 'next/server'

import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { verifySvixSignature } from '@/lib/mail/svixSignature'
import { parseAllowedRecipients, isAllowedRecipient } from '@/lib/mail/inboundRecipients'
import { ingestInboundEmail } from '@/lib/mail/ingestInbound'
import { insertInboundEmail, countInboundSince } from '@/db/queries/mailbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 본문 조회 1건 + 첨부 목록 1건 + 첨부 N건을 인라인으로 await한다. 각 Resend
// 호출은 15초 타임아웃(`inboundClient.ts`)이고 첨부 개수는 이론상
// `listReceivedAttachments`의 limit=100까지 갈 수 있다. `/api/internal/uploads/cleanup`
// (같은 형태 — 최대 100건의 개별 네트워크 왕복 루프)과 같은 예산인 300을 쓴다.
export const maxDuration = 300

const DAILY_ALERT_DEFAULT = 60

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, 'GENERAL_API')
    if (!limited.success) {
      return limited.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    // 원문 body를 먼저 받는다 — 서명 검증이 정확히 이 바이트를 요구한다.
    // JSON.parse 후 JSON.stringify로 재직렬화한 문자열을 넘기면 바이트가
    // 달라져 서명이 깨진다.
    const rawBody = await request.text()
    const verdict = verifySvixSignature(
      rawBody,
      {
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
      process.env.RESEND_INBOUND_WEBHOOK_SECRET ?? ''
      // nowMs는 넘기지 않는다 — 기본값(Date.now())을 써야 NaN에 의한
      // fail-open을 피할 수 있다.
    )
    if (verdict.ok === false) {
      logSecurityEvent('MAILBOX_WEBHOOK_SIGNATURE_REJECTED', { reason: verdict.reason }, 'high')
      return ApiError.unauthorized('서명을 확인할 수 없습니다.').toNextResponse()
    }

    const event = JSON.parse(rawBody) as {
      type?: string
      data?: Record<string, unknown>
    }
    if (event.type !== 'email.received' || !event.data) {
      return ApiSuccess.ok({ ignored: true }).toNextResponse()
    }

    const data = event.data
    const resendEmailId = String(data.email_id ?? '')
    if (!resendEmailId) {
      return ApiSuccess.ok({ ignored: true }).toNextResponse()
    }

    const recipients = [
      ...(Array.isArray(data.received_for) ? data.received_for.map(String) : []),
      ...(Array.isArray(data.to) ? data.to.map(String) : []),
    ]
    const allowed = parseAllowedRecipients(process.env.MAILBOX_ALLOWED_RECIPIENTS)
    if (!isAllowedRecipient(recipients, allowed)) {
      // 저장은 하지 않지만 쿼터는 이미 깎였다. 그래서 200이되 기록은 남긴다.
      // isAllowedRecipient는 allowed가 비어 있어도 false를 돌려준다 —
      // MAILBOX_ALLOWED_RECIPIENTS를 빠뜨리거나 오타를 내면 들어오는 모든
      // 메일이 이 분기로 조용히 사라진다. 그 설정 사고를 놓치지 않도록 남긴다.
      logSecurityEvent(
        'MAILBOX_RECIPIENT_NOT_ALLOWED',
        { resendEmailId, recipients, allowedCount: allowed.length },
        'medium'
      )
      return ApiSuccess.ok({ ignored: true, reason: 'recipient not allowed' }).toNextResponse()
    }

    const row = await insertInboundEmail({
      resend_email_id: resendEmailId,
      message_id: data.message_id == null ? null : String(data.message_id),
      from_address: String(data.from ?? ''),
      to_addresses: Array.isArray(data.to) ? data.to.map(String) : [],
      cc_addresses: Array.isArray(data.cc) ? data.cc.map(String) : [],
      received_for: Array.isArray(data.received_for) ? data.received_for.map(String) : [],
      subject: data.subject == null ? null : String(data.subject),
      received_at: data.created_at ? new Date(String(data.created_at)) : new Date(),
    })

    // 이미 있던 메일이다 — 재전송이므로 아무것도 더 하지 않는다.
    if (!row) {
      return ApiSuccess.ok({ duplicate: true }).toNextResponse()
    }

    await ingestInboundEmail(resendEmailId, String(row.id))
    await warnIfQuotaPressure()

    return ApiSuccess.ok({ id: row.id }).toNextResponse()
  } catch (error) {
    // 여기서 500을 내면 Resend가 재시도하고 그 재시도가 쿼터를 먹는다.
    // logSecurityEvent 자체가 던지면(예: SECURITY_WEBHOOK_URL 관련 코드가
    // 동기적으로 실패하는 경우) 그 예외가 여기서 새 나가 파일 헤더가 금지한
    // 500을 만들 수 있다 — 그래서 로그를 자체 try/catch로 한 번 더 감싼다.
    try {
      logSecurityEvent(
        'MAILBOX_WEBHOOK_UNEXPECTED_ERROR',
        { error: error instanceof Error ? error.message : 'unknown' },
        'high'
      )
    } catch {
      // 로그 실패는 무시한다 — 응답은 반드시 200으로 나가야 한다.
    }
    return ApiSuccess.ok({ accepted: true }).toNextResponse()
  }
}

/**
 * Free 플랜은 일 100통이고 수신이 발신 쿼터를 함께 먹는다. 한도에 닿으면
 * 회원가입 인증 메일과 비밀번호 재설정 메일이 같이 멈추므로, 그 전에 알아채야 한다.
 * 알림 메일은 보내지 않는다 — 그것도 쿼터를 먹는다.
 */
async function warnIfQuotaPressure(): Promise<void> {
  try {
    const threshold = Number(process.env.MAILBOX_DAILY_INBOUND_ALERT ?? DAILY_ALERT_DEFAULT)
    if (!Number.isFinite(threshold) || threshold <= 0) return
    const count = await countInboundSince(Date.now() - 24 * 60 * 60 * 1000)
    if (count >= threshold) {
      logSecurityEvent('MAILBOX_INBOUND_QUOTA_PRESSURE', { count, threshold }, 'high')
    }
  } catch {
    // 감시가 실패해도 수신을 막지 않는다.
  }
}
