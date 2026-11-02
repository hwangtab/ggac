/**
 * 작성자 표시 라벨 — 검색·다이제스트·푸시가 같은 규칙을 쓴다(채팅 화면 MessageItem 과 같은 모양).
 *  - 사람(staff 조회 성공): display_name
 *  - bot: `"<이름> (봇)"` — 이름은 본문 첫 `**[이름]**` 토큰(수신 웹훅 renderBotBody 규약), 없으면 "봇".
 *    웹훅 username 은 아무 값이나 넣을 수 있으므로 "(봇)" 을 반드시 붙여 사람 이름 사칭을 막는다.
 *  - system: "시스템"(작성자 이름이 있어도)
 *  - 그 외(탈퇴 등으로 작성자를 못 찾음): "알 수 없음"
 */

export const UNKNOWN_AUTHOR_LABEL = '알 수 없음'
export const SYSTEM_AUTHOR_LABEL = '시스템'
export const BOT_AUTHOR_LABEL = '봇'

const BOT_NAME_RE = /^\s*\*\*\[([^\]\n]{1,100})\]\*\*/

/** 봇 메시지 본문 앞의 `**[이름]**` 에서 이름을 꺼낸다. 없으면 null. */
export function botNameFromBody(body: string | null | undefined): string | null {
  const m = BOT_NAME_RE.exec(body ?? '')
  const name = m?.[1].trim()
  return name ? name : null
}

export function authorLabel(input: {
  kind?: string | null
  authorName?: string | null
  body?: string | null
}): string {
  if (input.kind === 'system') return SYSTEM_AUTHOR_LABEL
  const raw = input.authorName?.trim()
  const name = raw && raw !== UNKNOWN_AUTHOR_LABEL ? raw : null
  if (input.kind === 'bot') {
    const base = name ?? botNameFromBody(input.body)
    return base ? `${base} (봇)` : BOT_AUTHOR_LABEL
  }
  return name ?? UNKNOWN_AUTHOR_LABEL
}
