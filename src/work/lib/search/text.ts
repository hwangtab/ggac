import { decodeMentions } from '@work/lib/messages/mentions'

/**
 * 검색 순수 헬퍼 — 쿼리 분해·ilike 이스케이프·스니펫·하이라이트 구간.
 * 하이라이트는 문자열 구간으로만 계산하고 렌더는 <mark> 요소로 한다(raw HTML 렌더 금지).
 */

/** pgroonga 질의 연산자·따옴표를 뺀 검색어 조각. 하이라이트·ilike 폴백이 쓴다. */
export function splitTerms(query: string): string[] {
  return query
    .replace(/[()"']/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^[-+]+/, '').trim())
    .filter(t => t.length > 0 && t.toUpperCase() !== 'OR' && t.toUpperCase() !== 'AND')
    .slice(0, 8)
}

/**
 * 사용자 입력 → pgroonga `&@~` 질의. 검색어마다 큰따옴표 구문("...")으로 감싸 AND 로 잇는다.
 * 원문을 그대로 넘기면 `(`·`"`·`col:`·선행 `-` 같은 질의 문법 때문에 오류가 나거나 의도와 다르게 해석된다.
 * 구문 안에서는 `\\` 와 `"` 만 이스케이프하면 된다. 검색어가 하나도 없으면 null(호출부가 검색을 건너뜀).
 */
export function toPgroongaQuery(input: string): string | null {
  const terms = splitTerms(input)
  if (terms.length === 0) return null
  return terms.map(t => `"${t.replace(/[\\"]/g, c => `\\${c}`)}"`).join(' ')
}

/** ilike 패턴 이스케이프(% _ \). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, c => `\\${c}`)
}

export type Segment = { text: string; match: boolean }

/** text 를 검색어 일치 구간으로 나눈다(대소문자 무시, 겹치는 구간 병합). */
export function highlightSegments(text: string, terms: string[]): Segment[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    const t = term.toLowerCase()
    if (!t) continue
    let from = 0
    for (let idx = lower.indexOf(t, from); idx !== -1; idx = lower.indexOf(t, from)) {
      ranges.push([idx, idx + t.length])
      from = idx + t.length
    }
  }
  if (ranges.length === 0) return [{ text, match: false }]
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  const out: Segment[] = []
  let pos = 0
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: text.slice(pos, s), match: false })
    out.push({ text: text.slice(s, e), match: true })
    pos = e
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false })
  return out
}

/**
 * 마크다운 기호를 가볍게 걷어 낸 한 줄 텍스트(미리보기용).
 * 인용(`>`)·제목(`#`) 표시는 **줄 머리에 있을 때만** 걷는다 — 본문 속 `a > b`, `<태그>`, `#3` 같은
 * 글자는 그대로 둔다(렌더는 React 텍스트 노드라 이스케이프된다. 메일 다이제스트는 따로 HTML 이스케이프).
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/[`*~]+/g, '')
    .replace(/(^|[\s(])_+|_+(?=[\s).,!?]|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 첫 일치 주변을 잘라 낸 스니펫(앞뒤 생략은 …). */
export function makeSnippet(body: string, terms: string[], max = 200): string {
  const plain = toPlainText(body)
  if (plain.length <= max) return plain
  const lower = plain.toLowerCase()
  let first = -1
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i !== -1 && (first === -1 || i < first)) first = i
  }
  if (first === -1) return `${plain.slice(0, max)}…`
  const start = Math.max(0, first - Math.floor(max / 3))
  const end = Math.min(plain.length, start + max)
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

/**
 * 메시지 본문 스니펫 — 저장 형식 멘션 `@[이름](user:<uuid>)` 을 사람이 읽는 `@이름` 으로 먼저 바꾼다
 * (uuid 가 스니펫 길이를 잡아먹거나 검색어 하이라이트에 걸리지 않게).
 */
export function messageSnippet(body: string, terms: string[], max = 200): string {
  return makeSnippet(decodeMentions(body).text, terms, max)
}
