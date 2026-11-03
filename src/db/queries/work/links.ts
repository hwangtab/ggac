/**
 * 메시지 본문의 링크 추출 — 원본 `work.extract_message_urls`·`work.clean_message_url`(kosmart-work 0039)을
 * 그대로 옮긴 순수 함수. 원본은 `sync_message_links` AFTER 트리거가 불렀고, 여기서는 메시지 쓰기 함수가
 * 같은 트랜잭션에서 부른다(messages.ts).
 *
 * 규칙(0039 그대로):
 * - `https?://` 다음 `] 공백 < > " ' \` }`가 아닌 글자들(대소문자 무시)
 * - 앞에서부터 출력 가능한 ASCII(0x20~0x7E)까지만 남긴다 — 한글 등이 이어 붙으면 거기서 자른다
 * - 끝의 `. , ; : ! ? ' " * ~ _`를 떼고, 짝 없는 `)`를 뗀다. 바뀌지 않을 때까지 반복
 * - 길이 10~2000자만, 처음 나온 순서로 중복 없이 최대 20개
 */
const URL_PATTERN = /https?:\/\/[^\]\s<>"'`}]+/gi
const TRAILING_PUNCT = /[.,;:!?'"*~_]+$/
const PRINTABLE_PREFIX = /^[ -~]*/

export const MESSAGE_LINK_MIN = 10
export const MESSAGE_LINK_MAX = 2000
export const MESSAGE_LINKS_PER_MESSAGE = 20

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

export function cleanMessageUrl(raw: string): string {
  let u = PRINTABLE_PREFIX.exec(raw ?? '')?.[0] ?? ''
  for (;;) {
    const prev = u
    u = u.replace(TRAILING_PUNCT, '')
    while (u.endsWith(')') && count(u, ')') > count(u, '(')) u = u.slice(0, -1)
    if (u === prev) return u
  }
}

export function extractMessageUrls(body: string | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of (body ?? '').matchAll(URL_PATTERN)) {
    const u = cleanMessageUrl(m[0])
    if (u.length < MESSAGE_LINK_MIN || u.length > MESSAGE_LINK_MAX || seen.has(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= MESSAGE_LINKS_PER_MESSAGE) break
  }
  return out
}
