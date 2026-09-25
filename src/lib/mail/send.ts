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

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  /** `List-Unsubscribe` 같은 추가 헤더. */
  headers?: Record<string, string>
}

/**
 * @returns Resend가 매긴 메시지 식별자. 응답을 읽지 못하면 `null`이다 —
 *   메일은 이미 나갔으므로 식별자를 못 읽었다고 던지지 않는다.
 * @throws 키 누락·HTTP 실패는 던진다. 호출부가 실패를 세고 관리자에게 알린다.
 */
export async function sendEmail(input: SendEmailInput): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY가 설정되지 않았습니다.')
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...replyToPayload(),
      ...(input.headers ? { headers: input.headers } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    // 본문에 API 키가 들어가지 않는다 — 상태 코드와 Resend의 오류 메시지만 남긴다.
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend 발송 실패 (${response.status}): ${detail.slice(0, 200)}`)
  }

  // 식별자를 돌려준다. 이것이 없으면 우리가 보낸 메일과 Resend 대시보드의 한
  // 줄을 맞춰 볼 방법이 없다 — "답장을 보냈다는데 상대는 못 받았다"를 물어올
  // 때 댈 근거가 우리 원장의 '보냈음' 한 칸뿐이게 된다.
  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null
  return typeof payload?.id === 'string' ? payload.id : null
}
