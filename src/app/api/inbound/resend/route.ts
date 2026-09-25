/**
 * Resend Inbound 웹훅.
 *
 * `defineApiRoute` 밖에서 POST를 직접 export하는 이유: Svix 검증이 **원문 body**를
 * 요구해 `request.text()`로 받아야 한다. 서명 검증 자체가 이 라우트의 게이트다.
 *
 * **응답 코드는 "Resend가 이 메일을 다시 보내야 하는가"만 답한다.**
 *
 * - 서명 실패·비밀 미설정 → 401. 재시도해도 같은 답이므로 거절이 맞다.
 * - 우리가 다루지 않는 이벤트, 화이트리스트 밖 수신자, 파싱 불가한 본문,
 *   이미 저장한 메일 → 200. 다시 받아도 결과가 같아서 재시도가 쿼터만 먹는다.
 * - 저장에 실패한 경우 → **500**. 여기서 200을 주면 Resend는 배달에 성공한
 *   것으로 알고 다시 보내지 않으며, 그 메일은 어디에도 남지 않은 채 사라진다.
 *   쿼터 한 통보다 유실된 메일이 비싸다.
 *
 * 본문·첨부를 당겨 오는 단계(`ingestInboundEmail`)는 스스로 던지지 않는다 —
 * 실패하면 행이 `pending`으로 남고 백필 크론이 다시 가져간다. 그래서 그 단계
 * 때문에 재시도를 부를 일은 없다.
 *
 * **`ingestInboundEmail`은 응답 뒤 `after()`에서 돈다.** Svix는 이 라우트의
 * `maxDuration`(300초)과 무관하게 **15초**에서 응답을 기다리다 타임아웃시켜
 * 실패로 기록한다. 본문 조회 1건 + 첨부 목록 1건 + 첨부 N건을 응답 전에
 * inline으로 await하던 옛 코드는 첨부가 몇 개만 있어도 15초를 넘겨 Svix
 * 쪽에서는 "실패"로 찍히면서 Resend가 똑같은 메일을 또 보내는 사고를 만들 수
 * 있었다(우리 쪽은 이미 저장에 성공했는데도). 서명 검증·중복 판정처럼
 * "다시 시도해야 하는가"에 직접 영향을 주는 부분만 응답 전에 동기로 끝내고,
 * 나머지 무거운 네트워크 왕복은 응답을 먼저 보낸 뒤로 미룬다.
 */
import { NextRequest, after } from 'next/server'

import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'
import { verifySvixSignature } from '@/lib/mail/svixSignature'
import { parseAllowedRecipients, isAllowedRecipient } from '@/lib/mail/inboundRecipients'
import { ingestInboundEmail } from '@/lib/mail/ingestInbound'
import { insertInboundEmail, countInboundSince } from '@/db/queries/mailbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 응답은 먼저 나가지만, 뒤이은 after()가 본문 조회 1건 + 첨부 목록 1건 +
// 첨부 N건을 이어서 돈다 — 이 예산은 여전히 그 after() 몫이다. 각 Resend
// 호출은 15초 타임아웃(`inboundClient.ts`)이고 첨부 개수는 이론상
// `listReceivedAttachments`의 limit=100까지 갈 수 있다. `/api/internal/uploads/cleanup`
// (같은 형태 — 최대 100건의 개별 네트워크 왕복 루프)과 같은 예산인 300을 쓴다.
export const maxDuration = 300

const DAILY_ALERT_DEFAULT = 60

const log = createLogger('api/inbound/resend')

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

    // 파싱 불가는 재시도해도 같은 바이트가 다시 온다 — 200으로 닫는다.
    // 서명은 이미 통과했으므로 남의 요청은 아니고, 우리가 모르는 모양의
    // 이벤트일 뿐이다.
    let event: { type?: string; data?: Record<string, unknown> }
    try {
      event = JSON.parse(rawBody) as { type?: string; data?: Record<string, unknown> }
    } catch {
      logSecurityEvent('MAILBOX_WEBHOOK_UNEXPECTED_ERROR', { reason: 'body not json' }, 'medium')
      return ApiSuccess.ok({ ignored: true, reason: 'body not json' }).toNextResponse()
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
      // 파싱 불가면 Invalid Date가 되어 삽입 자체가 실패하고, 바깥 catch가
      // 200으로 삼켜 메일이 조용히 사라진다 — 그 대신 수신 시각으로 떨어진다.
      received_at: (() => {
        const parsed = data.created_at ? new Date(String(data.created_at)) : null
        return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
      })(),
    })

    // 이미 있던 메일이다 — 재전송이므로 아무것도 더 하지 않는다.
    if (!row) {
      return ApiSuccess.ok({ duplicate: true }).toNextResponse()
    }

    // 서명 검증·중복 판정은 이미 끝났다 — 여기부터는 "다시 시도해야 하는가"에
    // 영향을 주지 않으므로 응답을 먼저 보내고 뒤에서 마저 한다. Svix는 15초
    // 안에 응답이 없으면 이 배달을 실패로 기록하는데, 첨부가 여러 개면 그
    // 안에 다 못 끝낼 수 있다. ingestInboundEmail은 스스로 던지지 않아
    // after() 안에서도 안전하다(실패는 로그·pending 상태로만 남는다).
    after(() => ingestInboundEmail(resendEmailId, String(row.id)))
    after(() => warnIfQuotaPressure())

    return ApiSuccess.ok({ id: row.id }).toNextResponse()
  } catch (error) {
    // 여기까지 오는 예외는 "받은 메일을 저장하지 못했다"는 뜻이다(본문·첨부
    // 당겨오기는 스스로 삼키고, 파싱 실패는 위에서 걸러진다). 옛 코드는 이
    // 자리에서 200을 줬는데, 그러면 Resend는 배달 성공으로 알고 다시 보내지
    // 않는다 — Turso가 잠깐 흔들린 사이에 들어온 메일이 영구히 사라졌다.
    // 500을 줘서 재시도를 받는다. 재시도가 쿼터를 한 통 더 먹지만, 이미
    // 저장된 메일은 `insertInboundEmail`이 중복으로 걸러 200을 주므로 같은
    // 메일이 두 번 쌓이지는 않는다.
    //
    // logSecurityEvent 자체가 던지면(예: SECURITY_WEBHOOK_URL 관련 코드가
    // 동기적으로 실패하는 경우) 그 예외가 여기서 새 나가 응답을 만들지 못한다
    // — 그래서 로그를 자체 try/catch로 한 번 더 감싼다.
    try {
      // 크론·웹훅 로그는 Vercel 런타임 로그가 유일하게 확실히 닿는 통로다.
      log.error('받은 메일 저장 실패 — Resend 재시도를 받는다', error)
      logSecurityEvent(
        'MAILBOX_WEBHOOK_UNEXPECTED_ERROR',
        { error: error instanceof Error ? error.message : 'unknown' },
        'high'
      )
    } catch {
      // 로그 실패가 응답을 막지 않는다.
    }
    return ApiError.internalServerError(
      '메일을 저장하지 못했습니다. 다시 보내 주세요.'
    ).toNextResponse()
  }
}

/**
 * Free 플랜은 일 100통이고 수신이 발신 쿼터를 함께 먹는다. 한도에 닿으면
 * 회원가입 인증 메일과 비밀번호 재설정 메일이 같이 멈추므로, 그 전에 알아채야 한다.
 * 알림 메일은 보내지 않는다 — 그것도 쿼터를 먹는다.
 *
 * **이 카운트는 저장된 것만 세는 하한선이다.** `countInboundSince`는
 * `inbound_emails` 표의 행을 세는데, 화이트리스트(`MAILBOX_ALLOWED_RECIPIENTS`)에
 * 걸러진 메일은 저장 자체를 하지 않는다 — 그런데 그 메일도 Resend 쪽에서는
 * 이미 수신 처리돼 쿼터를 먹은 뒤다. 즉 스팸이 화이트리스트 밖 주소로 하루
 * 100통을 채우는 경로에서는 이 경보가 한 번도 울리지 않을 수 있다. 완전한
 * 해법(서명 직후 별도 카운터)은 이 문제 크기에 비해 무겁다고 판단해 채택하지
 * 않았다 — 대신 실제 사용량은 반드시 Resend 대시보드(Settings → Usage)에서
 * 확인해야 한다(`docs/mailbox-cutover.md` 4·5단계 체크박스).
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
