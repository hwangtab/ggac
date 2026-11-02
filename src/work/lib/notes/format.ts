/**
 * 메모 편집기 마크다운 서식 단추(순수). 텍스트와 선택 범위를 받아 새 텍스트와 새 선택 범위를 돌려준다.
 * 감싸는 서식(굵게·기울임·코드·링크)은 선택이 없으면 자리표시 글자를 넣고 그것을 선택한다.
 * 줄 머리 서식(제목·목록·번호·체크·인용)은 선택이 걸친 모든 줄에 붙이고, 이미 모두 붙어 있으면 뗀다.
 */

export type NoteFormat =
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'heading'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'

export type FormatResult = { text: string; start: number; end: number }

const WRAP: Record<'bold' | 'italic' | 'code', { mark: string; placeholder: string }> = {
  bold: { mark: '**', placeholder: '굵은 글씨' },
  italic: { mark: '*', placeholder: '기울인 글씨' },
  code: { mark: '`', placeholder: '코드' },
}

const LINE_PREFIX: Record<'heading' | 'bullet' | 'task' | 'quote', string> = {
  heading: '## ',
  bullet: '- ',
  task: '- [ ] ',
  quote: '> ',
}

export function applyFormat(
  text: string,
  selStart: number,
  selEnd: number,
  format: NoteFormat
): FormatResult {
  const start = Math.max(0, Math.min(selStart, selEnd, text.length))
  const end = Math.max(0, Math.min(Math.max(selStart, selEnd), text.length))

  if (format === 'bold' || format === 'italic' || format === 'code') {
    const { mark, placeholder } = WRAP[format]
    const picked = text.slice(start, end) || placeholder
    const next = text.slice(0, start) + mark + picked + mark + text.slice(end)
    return { text: next, start: start + mark.length, end: start + mark.length + picked.length }
  }

  if (format === 'link') {
    const picked = text.slice(start, end) || '링크 이름'
    const url = 'https://'
    const next = text.slice(0, start) + `[${picked}](${url})` + text.slice(end)
    const urlStart = start + picked.length + 3
    return { text: next, start: urlStart, end: urlStart + url.length }
  }

  // 줄 머리 서식: 선택이 걸친 줄 전체
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl === -1 ? text.length : nl
  const lines = text.slice(lineStart, lineEnd).split('\n')

  let out: string[]
  if (format === 'ordered') {
    const has = lines.every(l => /^\d+\. /.test(l))
    out = has ? lines.map(l => l.replace(/^\d+\. /, '')) : lines.map((l, i) => `${i + 1}. ${l}`)
  } else {
    const prefix = LINE_PREFIX[format]
    const has = lines.every(l => l.startsWith(prefix))
    out = has ? lines.map(l => l.slice(prefix.length)) : lines.map(l => prefix + l)
  }
  const replaced = out.join('\n')
  return {
    text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + replaced.length,
  }
}
