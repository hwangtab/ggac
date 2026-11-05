/**
 * 받은 메일을 대화(스레드)로 묶는 규칙 — 헤더에서 "이 메일이 가리키는 앞 메일"의 Message-ID를 뽑는다.
 *
 * 단서는 `In-Reply-To`와 `References`다. 상대가 **우리 답장**에 다시 답하면 `In-Reply-To`에는 우리 답장의
 * Message-ID가 들어오는데 그 값은 Resend가 정해 우리가 모른다. 대신 우리 답장이 `References`에 원본 메일의
 * Message-ID를 실어 보내므로(reply 라우트) 상대 답장의 `References`에 그 값이 남는다. 그래서 둘 다 본다.
 * 운영 사본 리허설(2026-11-05): 468통 중 4통이 대화 3개로 묶였고, 넷 다 제목(`Re:`)·발신자가 이어지는 진짜
 * 답장이었다.
 *
 * 묶는 쪽 규칙(`assignThread`, 0038 백필): 뽑은 ID와 `message_id`가 같은 **다른** 받은 메일 중 가장 먼저 받은
 * 것의 대화에 넣는다. 없으면 자기 자신이 대화의 시작이다.
 *
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 */

/** 한 메일에서 따라갈 ID 상한. `References`가 비정상적으로 길어도 조회가 커지지 않게 한다. */
export const MAX_REFERENCED_IDS = 50

function headerValue(headers: Record<string, unknown>, name: string): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  if (!entry) return ''
  const value = entry[1]
  return Array.isArray(value) ? value.map(String).join(' ') : typeof value === 'string' ? value : ''
}

/**
 * 헤더(JSON 문자열 또는 객체)에서 `<...>` 꼴 Message-ID를 뽑는다. `In-Reply-To`가 앞, `References`는 뒤에서부터
 * (가까운 조상부터) 모은다. 중복은 뺀다. 헤더가 깨졌거나 없으면 빈 배열 — 던지지 않는다.
 */
export function referencedMessageIds(headers: unknown): string[] {
  let parsed: unknown = headers
  if (typeof headers === 'string') {
    try {
      parsed = JSON.parse(headers)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const record = parsed as Record<string, unknown>
  const pick = (text: string) => text.match(/<[^<>\s]+>/g) ?? []
  const ids = [
    ...pick(headerValue(record, 'in-reply-to')),
    ...pick(headerValue(record, 'references')).reverse(),
  ]
  return [...new Set(ids)].slice(0, MAX_REFERENCED_IDS)
}
