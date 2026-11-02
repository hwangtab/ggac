/**
 * 메모 본문 속 GFM 표를 **원문 줄 번호**로 찾아 행을 더하고 고치고 지우는 순수 함수.
 * 렌더된 표(react-markdown 노드 position.start.line, 1부터)와 원문을 잇는 데 쓴다.
 * 줄바꿈(LF/CRLF)과 끝 개행 유무는 그대로 보존한다. 본문 내용은 로그에 남기지 않는다.
 */

export interface MdTableRow {
  /** 원문 줄 번호(1부터) */
  line: number
  /** 칸 원문(앞뒤 공백 제거, 이스케이프 그대로) */
  cells: string[]
}

export interface MdTable {
  headerLine: number
  separatorLine: number
  /** 머리글 칸 원문 */
  headers: string[]
  rows: MdTableRow[]
  /** 표의 마지막 줄(본문 행이 없으면 구분선 줄) */
  lastLine: number
}

interface Line {
  text: string
  /** 이 줄 뒤의 줄바꿈('' 이면 파일 끝) */
  eol: string
}

function splitLines(body: string): Line[] {
  const parts = body.split(/(\r\n|\n)/)
  const out: Line[] = []
  for (let i = 0; i < parts.length; i += 2) {
    out.push({ text: parts[i], eol: parts[i + 1] ?? '' })
  }
  return out
}

function joinLines(lines: Line[]): string {
  return lines.map(l => l.text + l.eol).join('')
}

function defaultEol(lines: Line[]): string {
  return lines.find(l => l.eol)?.eol ?? '\n'
}

function endsWithEscapedPipe(s: string): boolean {
  let n = 0
  for (let i = s.length - 2; i >= 0 && s[i] === '\\'; i--) n++
  return n % 2 === 1
}

/** 이스케이프되지 않은 `|` 로 나눈다. 앞뒤 파이프는 떼고 칸은 trim. */
export function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !endsWithEscapedPipe(s)) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1]
      i++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '|') return true
  }
  return false
}

function isSeparator(line: string, columns: number): boolean {
  if (!line.includes('|') || /^ {4,}/.test(line)) return false
  const cells = splitCells(line)
  return cells.length === columns && cells.every(c => /^:?-+:?$/.test(c))
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** 본문의 모든 표(코드 울타리 안은 제외). */
export function parseTables(body: string): MdTable[] {
  const lines = splitLines(body).map(l => l.text)
  const tables: MdTable[] = []
  let fence: { ch: string; len: number } | null = null
  let i = 0
  while (i < lines.length) {
    const text = lines[i]
    const fm = FENCE.exec(text)
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && text.trim() === fm[1]) {
        fence = null
      }
      i++
      continue
    }
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length }
      i++
      continue
    }
    if (
      text.trim() !== '' &&
      !/^ {4,}/.test(text) &&
      hasUnescapedPipe(text) &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1], splitCells(text).length)
    ) {
      const headers = splitCells(text)
      const rows: MdTableRow[] = []
      let j = i + 2
      while (
        j < lines.length &&
        lines[j].trim() !== '' &&
        !FENCE.test(lines[j]) &&
        hasUnescapedPipe(lines[j])
      ) {
        rows.push({ line: j + 1, cells: splitCells(lines[j]) })
        j++
      }
      tables.push({ headerLine: i + 1, separatorLine: i + 2, headers, rows, lastLine: j })
      i = j
      continue
    }
    i++
  }
  return tables
}

/** 머리글 줄 번호로 표를 찾는다. */
export function findTableAt(body: string, headerLine: number): MdTable | null {
  return parseTables(body).find(t => t.headerLine === headerLine) ?? null
}

/** 본문 행 줄 번호로 그 행이 든 표와 행을 찾는다. */
export function findRowAt(
  body: string,
  rowLine: number
): { table: MdTable; row: MdTableRow } | null {
  for (const table of parseTables(body)) {
    const row = table.rows.find(r => r.line === rowLine)
    if (row) return { table, row }
  }
  return null
}

const CODE_SPAN = /^`([^`]+)`$/

/** 칸 원문 → 사용자가 보는 평문(`\|` 복원, 바깥 인라인 코드 한 쌍 제거). */
export function cellToPlain(cell: string): string {
  const unescaped = cell.trim().replace(/\\\|/g, '|')
  const m = CODE_SPAN.exec(unescaped)
  return m ? m[1] : unescaped
}

/** 평문 → 칸 원문. 줄바꿈은 공백으로, `|` 는 이스케이프, wrapCode 면 백틱으로 감싼다(값에 백틱이 있으면 감싸지 않음). */
export function plainToCell(value: string, wrapCode = false): string {
  const v = value.replace(/\r\n|\r|\n/g, ' ').trim()
  if (v === '') return ''
  const escaped = v.replace(/\|/g, '\\|')
  return wrapCode && !v.includes('`') ? `\`${escaped}\`` : escaped
}

/** 열별로, 비지 않은 본문 칸의 과반이 인라인 코드 한 덩어리이면 true. */
export function codeColumns(table: MdTable): boolean[] {
  return table.headers.map((_, col) => {
    let filled = 0
    let code = 0
    for (const r of table.rows) {
      const c = (r.cells[col] ?? '').trim()
      if (c === '') continue
      filled++
      if (CODE_SPAN.test(c)) code++
    }
    return filled > 0 && code * 2 > filled
  })
}

function formatRow(table: MdTable, values: string[]): string {
  const wrap = codeColumns(table)
  const cells = table.headers.map((_, i) => plainToCell(values[i] ?? '', wrap[i]))
  return `| ${cells.join(' | ')} |`
}

/** 표 마지막 줄 뒤에 새 행을 더한다. values 는 열 순서의 평문. */
export function appendRow(body: string, table: MdTable, values: string[]): string {
  const lines = splitLines(body)
  const idx = table.lastLine - 1
  if (idx < 0 || idx >= lines.length) return body
  const prev = lines[idx]
  const next: Line = { text: formatRow(table, values), eol: prev.eol }
  if (prev.eol === '') prev.eol = defaultEol(lines)
  lines.splice(idx + 1, 0, next)
  return joinLines(lines)
}

/** 본문 행(줄 번호)의 값을 바꾼다. 행을 못 찾으면 null. */
export function replaceRow(body: string, rowLine: number, values: string[]): string | null {
  const found = findRowAt(body, rowLine)
  if (!found) return null
  const lines = splitLines(body)
  lines[rowLine - 1].text = formatRow(found.table, values)
  return joinLines(lines)
}

/** 본문 행(줄 번호)을 지운다. 행을 못 찾으면 null. */
export function deleteRow(body: string, rowLine: number): string | null {
  if (!findRowAt(body, rowLine)) return null
  const lines = splitLines(body)
  const [removed] = lines.splice(rowLine - 1, 1)
  if (removed.eol === '' && lines.length > 0) lines[lines.length - 1].eol = ''
  return joinLines(lines)
}
