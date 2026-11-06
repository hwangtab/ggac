/**
 * 보낸 메일에 실제로 붙은 `Message-ID`를 Resend에 물어본다.
 *
 * ## 왜 물어봐야 하나
 *
 * 상대가 우리 메일에 답장하면 그 답장의 `In-Reply-To`/`References`에 우리 메일의 `Message-ID`가 들어온다. 그 값으로
 * 답장을 원래 메일에 정확히 이을 수 있다 — 제목·수신자로 추측하지 않아도 된다.
 *
 * 그런데 그 값을 **우리가 정할 수 없다**. Resend는 SES로 보내고 SES가 커스텀 `Message-ID` 헤더를 덮어쓴다. 대신
 * Resend `GET /emails/:id`가 실제 값을 알려 준다(`message_id`, 2026-07 추가). 그래서 발송 뒤에 한 번 물어본다.
 *
 * **던지지 않는다.** 발송은 이미 끝났고, 이 값이 없으면 답장이 대화로 이어지지 않을 뿐이다. 못 받은 행은 메일함
 * 백필 크론이 다시 물어본다(`listSentWithoutMessageId`).
 *
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약(주입한 fetch로 단위 테스트한다).
 */

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails'

/** `<...@...>` 꼴만 받는다. 헤더가 아닌 값이 DB에 들어가면 대조가 조용히 빗나간다. */
export function isMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^<[^<>\s]+@[^<>\s]+>$/.test(value.trim())
}

/**
 * @returns 실제 `Message-ID`(꺾쇠 포함). 키 없음·거절·형식 오류·시간 초과면 `null`.
 */
export async function fetchSentMessageId(
  resendEmailId: string,
  deps: { fetch?: typeof fetch; apiKey?: string | null } = {}
): Promise<string | null> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) return null
  const doFetch = deps.fetch ?? fetch
  try {
    const response = await doFetch(
      `${RESEND_EMAIL_ENDPOINT}/${encodeURIComponent(resendEmailId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      }
    )
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as { message_id?: unknown } | null
    const value = payload?.message_id
    if (!isMessageId(value)) return null
    return value.trim()
  } catch {
    return null
  }
}
