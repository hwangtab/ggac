/**
 * 멘션 규약: 본문에 `@[표시이름](user:<uuid>)` 로 저장한다. `@channel` 은 채널 멤버 전원.
 *
 * 입력창에는 사람이 읽기 좋은 `@표시이름` 만 보이고, 전송할 때 고른 사람 목록으로 토큰을 만든다
 * (encodeMentions). 수정할 때는 반대로 토큰을 `@표시이름` 으로 풀어 입력창에 넣는다(decodeMentions).
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** 저장 형식 토큰. 그룹 1 = 이름, 2 = user_id */
export const MENTION_TOKEN_RE = new RegExp(`@\\[([^\\]\\n]{1,50})\\]\\(user:(${UUID})\\)`, 'g')

const CHANNEL_MENTION_RE = /(^|[^\w@])@channel(?![\w])/

export type MentionPick = { id: string; name: string }

/** 토큰 안에 들어가면 안 되는 문자를 이름에서 뺀다 */
function cleanName(name: string): string {
  return name
    .replace(/[[\]()\n]/g, '')
    .trim()
    .slice(0, 50)
}

export function formatMentionToken(name: string, userId: string): string {
  return `@[${cleanName(name)}](user:${userId})`
}

/**
 * 본문의 멘션 user_id(중복 제거, 소문자). 코드 블록·인라인 코드 안의 토큰은 화면에서도 멘션으로 그리지 않으므로
 * 알림 대상에서도 뺀다(hasChannelMention 과 같은 규칙 — 서버 기록과 표시가 어긋나지 않게).
 */
export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>()
  for (const m of stripCode(body).matchAll(MENTION_TOKEN_RE)) ids.add(m[2].toLowerCase())
  return [...ids]
}

export function hasChannelMention(body: string): boolean {
  return CHANNEL_MENTION_RE.test(stripCode(body))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 코드 블록·인라인 코드를 비운다(멘션 판정에서 제외) */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ')
}

/** 코드 밖의 텍스트 조각에만 fn 을 적용한다 */
function mapOutsideCode(body: string, fn: (text: string) => string): string {
  return body
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('')
}

/**
 * 입력창 텍스트의 `@이름` 을 고른 사람 토큰으로 바꾼다. 긴 이름부터 맞춘다(`@홍길` vs `@홍길동`).
 * 이미 토큰인 부분과 코드 안은 건드리지 않는다.
 */
export function encodeMentions(text: string, picks: MentionPick[]): string {
  const unique = new Map<string, MentionPick>()
  for (const p of picks) {
    const name = cleanName(p.name)
    if (name) unique.set(name, { id: p.id, name })
  }
  if (unique.size === 0) return text
  const names = [...unique.keys()].sort((a, b) => b.length - a.length)
  const re = new RegExp(`(^|[^\\w\\[])@(${names.map(escapeRegExp).join('|')})(?!\\]\\()`, 'g')
  return mapOutsideCode(text, part =>
    part.replace(re, (_m, pre: string, name: string) => {
      const pick = unique.get(name)!
      return `${pre}${formatMentionToken(pick.name, pick.id)}`
    })
  )
}

/** 저장된 본문 → 입력창 텍스트(`@이름`) + 그 안의 멘션 목록 */
export function decodeMentions(body: string): { text: string; picks: MentionPick[] } {
  const picks: MentionPick[] = []
  const text = body.replace(MENTION_TOKEN_RE, (_m, name: string, id: string) => {
    picks.push({ id: id.toLowerCase(), name })
    return `@${name}`
  })
  return { text, picks }
}

/**
 * 렌더 전용 멘션 링크 스킴. 본문에 직접 쓴 `[글](user:<uuid>)`·`[글](mention:channel)` 이 진짜 멘션처럼
 * 그려지지 않도록, toRenderMarkdown 이 만드는 링크만 **프로세스마다 무작위인 접두어**를 쓴다(작성자는 맞출 수 없다).
 * 접두어는 렌더 중간 표현일 뿐 화면 출력(span)에는 남지 않으므로 서버·클라이언트가 달라도 하이드레이션에 영향이 없다.
 */
const NONCE = (() => {
  try {
    const c = globalThis.crypto
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 16)
  } catch {
    // crypto 가 없는 환경 — 아래 폴백
  }
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
})()
const USER_SCHEME = `kwu${NONCE}:`
const CHANNEL_HREF = `kwc${NONCE}:channel`

export type MentionHref = { kind: 'user'; id: string } | { kind: 'channel' }

/** toRenderMarkdown 이 만든 멘션 링크인가(본문에 직접 쓴 링크는 null) */
export function parseMentionHref(href: string | undefined): MentionHref | null {
  if (!href) return null
  if (href === CHANNEL_HREF) return { kind: 'channel' }
  if (href.startsWith(USER_SCHEME)) {
    const id = href.slice(USER_SCHEME.length)
    if (UUID_ONLY_RE.test(id)) return { kind: 'user', id: id.toLowerCase() }
  }
  return null
}

const UUID_ONLY_RE = new RegExp(`^${UUID}$`)

/**
 * 렌더용 마크다운: 저장 형식 멘션 토큰(`@[이름](user:<uuid>)`)과 `@channel` 만 링크 문법으로 바꾼다.
 * 링크 주소는 위의 무작위 스킴이라 ChatMarkdown 은 parseMentionHref 로 진짜만 하이라이트로 그리고,
 * 본문에 직접 쓴 `user:`·`mention:` 링크는 일반 링크 규칙(허용 안 되는 스킴 → 글자만)을 탄다.
 */
export function toRenderMarkdown(body: string): string {
  return mapOutsideCode(body, part =>
    part
      .replace(MENTION_TOKEN_RE, (_m, _name: string, id: string) => `[@](${USER_SCHEME}${id})`)
      .replace(/(^|[^\w@[])@channel(?![\w])/g, `$1[@channel](${CHANNEL_HREF})`)
  )
}

/** 입력창에서 캐럿 앞의 `@검색어` (자동완성 트리거). 없으면 null */
export function activeMentionQuery(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(before)
  if (!m) return null
  return { query: m[2], start: caret - m[2].length - 1 }
}
