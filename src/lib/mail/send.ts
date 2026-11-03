/**
 * 범용 이메일 발송 (Resend HTTP API).
 *
 * **`src/lib/auth/email.ts`의 `sendAuthEmail`을 건드리지 않고 옆에 새로 만든다.**
 * 그 함수를 호출하는 Better Auth 훅은 내부에서 `runInBackgroundOrAwait()`로 실행되며
 * reject를 삼킨다 — 거기를 리팩터링하면 인증 메일 실패가 지금보다 더 안 보이게 된다.
 * 발신자·엔드포인트는 같은 값을 쓰되 코드는 분리한다.
 *
 * SMTP가 아니라 HTTP를 쓰는 이유: 서버리스 함수는 연결을 유지하지 못해 콜드 스타트마다
 * TLS 핸드셰이크를 새로 한다.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = '경기아트콜렉티브 <noreply@ggac.kr>'

/**
 * 회신을 받을 주소. `noreply@ggac.kr`로 회신이 가면 반송되거나 유실된다 —
 * 실제로 그것이 "Resend 회신을 확인할 수 없다"의 직접 원인이었다.
 * 값이 없으면 키를 아예 넣지 않는다(전환 전 동작 그대로).
 */
function replyToPayload(): { reply_to: string[] } | Record<string, never> {
  const value = process.env.MAILBOX_REPLY_TO?.trim()
  return value ? { reply_to: [value] } : {}
}

/**
 * E2E 픽스처(`authz-*@test.local`)로 가는 메일은 보내지 않는다. 실제 키로 나가면
 * 전부 반송되어 일일 한도를 먹고 발신 평판을 깎는다(2026-11-02 하루 176건).
 * 호출부는 성공으로 본다 — 알림 흐름 자체는 그대로 검증된다.
 */
export function isUndeliverableTestRecipient(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop() ?? ''
  return domain === 'test.local' || domain.endsWith('.test.local')
}

export interface SendEmailAttachment {
  filename: string
  /** 파일 본문. 이 함수가 base64로 바꿔 Resend에 넘긴다. */
  content: Buffer
}

export interface SendEmailInput {
  to: string | string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  /** `List-Unsubscribe` 같은 추가 헤더. */
  headers?: Record<string, string>
  attachments?: SendEmailAttachment[]
  /** Resend `Idempotency-Key`. 같은 키로 다시 보내도 Resend가 중복 발송을 걸러낸다. */
  idempotencyKey?: string
}

/**
 * 발송 실패의 종류. 호출부가 "메일이 안 나갔다"와 "나갔는지 모른다"를 가려야 한다 —
 * 후자를 실패로 보고 다시 누르면 같은 메일이 한 번 더 나간다.
 *
 * - `config`: 키가 없어 요청 자체를 보내지 않았다 → 안 나갔다.
 * - `rejected`: Resend가 HTTP 오류로 거절했다 → 안 나갔다.
 * - `unknown`: 타임아웃·네트워크 오류. 요청이 닿았는지 모른다.
 *
 * `Error`를 상속하고 메시지 형식도 그대로라 기존 `instanceof Error`·`(429)` 판별은 영향이 없다.
 */
export class MailSendError extends Error {
  readonly kind: 'config' | 'rejected' | 'unknown'
  readonly status?: number

  constructor(kind: 'config' | 'rejected' | 'unknown', message: string, status?: number) {
    super(message)
    this.name = 'MailSendError'
    this.kind = kind
    this.status = status
  }
}

/**
 * @returns Resend가 매긴 메시지 식별자. 응답을 읽지 못하면 `null`이다 —
 *   메일은 이미 나갔으므로 식별자를 못 읽었다고 던지지 않는다. 수신자가 전부
 *   `@test.local`이라 발송을 건너뛴 경우에도 `null`이다.
 * @throws `MailSendError`. 키 누락·HTTP 실패는 던진다. 호출부가 실패를 세고 관리자에게 알린다.
 */
export async function sendEmail(input: SendEmailInput): Promise<string | null> {
  const to = (Array.isArray(input.to) ? input.to : [input.to]).filter(
    a => !isUndeliverableTestRecipient(a)
  )
  if (to.length === 0) return null
  const cc = input.cc?.filter(a => !isUndeliverableTestRecipient(a))
  const bcc = input.bcc?.filter(a => !isUndeliverableTestRecipient(a))

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new MailSendError('config', 'RESEND_API_KEY가 설정되지 않았습니다.')
  }

  let response: Response
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: FROM,
        to,
        ...(cc && cc.length > 0 ? { cc } : {}),
        ...(bcc && bcc.length > 0 ? { bcc } : {}),
        subject: input.subject,
        html: input.html,
        ...replyToPayload(),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map(a => ({
                filename: a.filename,
                content: a.content.toString('base64'),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(input.attachments?.length ? 30_000 : 10_000),
    })
  } catch (error) {
    // 요청이 Resend에 닿았는지 알 수 없다.
    throw new MailSendError(
      'unknown',
      `Resend 요청 결과를 알 수 없습니다: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok) {
    // 본문에 API 키가 들어가지 않는다 — 상태 코드와 Resend의 오류 메시지만 남긴다.
    const detail = await response.text().catch(() => '')
    throw new MailSendError(
      'rejected',
      `Resend 발송 실패 (${response.status}): ${detail.slice(0, 200)}`,
      response.status
    )
  }

  // 식별자를 돌려준다. 이것이 없으면 우리가 보낸 메일과 Resend 대시보드의 한
  // 줄을 맞춰 볼 방법이 없다 — "답장을 보냈다는데 상대는 못 받았다"를 물어올
  // 때 댈 근거가 우리 원장의 '보냈음' 한 칸뿐이게 된다.
  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null
  return typeof payload?.id === 'string' ? payload.id : null
}
