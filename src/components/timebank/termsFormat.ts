/**
 * 이용규칙 본문(`src/constants/timebankTerms.ts`) → 그릴 구조. HTML을 해석하지
 * 않는다 — 결과는 문자열 조각뿐이고 화면은 React 텍스트 노드로만 그린다.
 *
 * 본문 표기(의결본을 옮겨 적을 때 지킬 것):
 * - 빈 줄 = 문단 경계
 * - 줄머리(앞 공백 무시)가 `①`~`⑳`·`1.`·`※`이면 새 줄. 앞에 공백이 있으면 들여쓴다
 * - 그 밖의 줄은 앞 줄에 이어 붙인다(원문의 80자 줄바꿈은 문장 중간이다)
 * - `**…**` = 굵게(조 제목)
 */

export type TermsSegment = { text: string; bold: boolean }
export type TermsLine = { indent: boolean; segments: TermsSegment[] }
export type TermsBlock = TermsLine[]

const LINE_START = /^(?:[①-⑳]|\d+\.\s|※)/

function toSegments(text: string): TermsSegment[] {
  const segments: TermsSegment[] = []
  const pattern = /\*\*(.+?)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), bold: false })
    segments.push({ text: match[1], bold: true })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false })
  return segments
}

export function parseTermsText(source: string): TermsBlock[] {
  const blocks: TermsBlock[] = []
  for (const rawBlock of source.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines: Array<{ indent: boolean; text: string }> = []
    for (const rawLine of rawBlock.split('\n')) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue
      const current = lines[lines.length - 1]
      if (!current || LINE_START.test(trimmed)) {
        lines.push({ indent: /^\s/.test(rawLine), text: trimmed })
      } else {
        current.text = `${current.text} ${trimmed}`
      }
    }
    if (lines.length > 0) {
      blocks.push(lines.map(line => ({ indent: line.indent, segments: toSegments(line.text) })))
    }
  }
  return blocks
}
