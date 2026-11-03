import type {
  EditBlock,
  EditBlockInput,
  EditCell,
  FormFieldInfo,
  FormSchemaInfo,
} from '@work/lib/files/doc-edit-types'

/** 문서 편집 화면의 순수 도우미(상태 변환·찾기 바꾸기) — docs/10 §2 */

// ── 양식 채우기 ────────────────────────────────────────────────────────────

/** 칸 입력 상태: 문자열(체크박스는 'true'|'') */
export type FillState = Record<string, string>

const BOX = /[□☐]/

/** 천 단위 쉼표(숫자만 남기고 다시 찍는다). 숫자가 없으면 '' */
export function formatAmount(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('en-US')
}

/** 체크 상태에서 문서에 넣을 값 — 원래 칸의 □ 만 ☑ 로 바꿔 칸 글자가 남게 한다 */
export function checkboxValue(original: string, checked: boolean): string {
  if (!checked) return ''
  return BOX.test(original) ? original.replace(BOX, '☑') : '☑'
}

/**
 * 입력 상태 → 채우기 값(라벨/누름틀 이름 → 값). 비운 칸은 빼서 문서 값을 건드리지 않는다.
 * 체크박스는 체크했을 때만 ☑ 로 보낸다.
 */
export function toFillValues(schema: FormSchemaInfo, state: FillState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of schema.fields) {
    const v = (state[fieldKey(f.label)] ?? '').trim()
    if (f.kind === 'checkbox') {
      const sent = checkboxValue(f.value, v === 'true')
      if (sent) out[f.label] = sent
    } else if (v) {
      out[f.label] = f.kind === 'amount' ? formatAmount(v) : v
    }
  }
  for (const c of schema.clickHere) {
    const v = (state[clickHereKey(c.name)] ?? '').trim()
    if (v) out[c.name] = v
  }
  return out
}

export const fieldKey = (label: string) => `f:${label}`
export const clickHereKey = (name: string) => `c:${name}`

/** 채울 값이 하나라도 있나 */
export function hasFillValues(values: Record<string, string>): boolean {
  return Object.keys(values).length > 0
}

/** 새 파일 이름 제안에 쓰는 "첫 번째 텍스트 칸"의 입력값 */
export function firstTextInput(fields: readonly FormFieldInfo[], state: FillState): string | null {
  for (const f of fields) {
    if (f.kind !== 'text') continue
    const v = (state[fieldKey(f.label)] ?? '').trim()
    if (v) return v
  }
  return null
}

// ── 문구 고치기 ────────────────────────────────────────────────────────────

export type EditorBlock =
  | {
      key: string
      src: number | null
      kind: 'heading' | 'paragraph' | 'list'
      level?: number
      text: string
      /** 원본 글(새 문단은 null) */
      original: string | null
    }
  | {
      key: string
      src: number
      kind: 'table'
      cells: EditCell[][]
      /** 원본 셀 글 */
      originals: string[][]
    }
  | { key: string; src: number; kind: 'readonly'; label: string }

let seq = 0
export const newKey = () => `b${++seq}`

export function initEditorBlocks(blocks: readonly EditBlock[]): EditorBlock[] {
  return blocks.map((b): EditorBlock => {
    if (b.kind === 'readonly')
      return { key: newKey(), src: b.src, kind: 'readonly', label: b.label }
    if (b.kind === 'table') {
      return {
        key: newKey(),
        src: b.src,
        kind: 'table',
        cells: b.cells.map(r => r.map(c => ({ ...c }))),
        originals: b.cells.map(r => r.map(c => c.text)),
      }
    }
    return {
      key: newKey(),
      src: b.src,
      kind: b.kind,
      level: b.kind === 'heading' ? b.level : undefined,
      text: b.text,
      original: b.text,
    }
  })
}

/** 편집 상태 → 서버 요청 블록 */
export function toBlockInputs(blocks: readonly EditorBlock[]): EditBlockInput[] {
  return blocks.map((b): EditBlockInput => {
    if (b.kind === 'readonly') return { src: b.src, kind: 'readonly' }
    if (b.kind === 'table') {
      return { src: b.src, kind: 'table', cells: b.cells.map(r => r.map(c => c.text)) }
    }
    return { src: b.src, kind: b.kind, text: b.text }
  })
}

export function isBlockChanged(b: EditorBlock): boolean {
  if (b.kind === 'readonly') return false
  if (b.kind === 'table') {
    return b.cells.some((r, ri) => r.some((c, ci) => c.editable && c.text !== b.originals[ri][ci]))
  }
  return b.src === null || b.text !== b.original
}

/**
 * 공문의 끝 표시("끝.") 문단인가 — 원본 글 기준. 공문은 "끝." 뒤에 본문이 오면 안 되므로
 * 이 문단에서는 문단 추가·삭제를 막고 글자 고치기만 둔다(위 문단에서 추가한다).
 */
export function isEndMarkBlock(b: EditorBlock): boolean {
  return (
    b.kind !== 'table' &&
    b.kind !== 'readonly' &&
    b.src !== null &&
    /^\s*끝\.\s*$/.test(b.original ?? '')
  )
}

export type ChangeSummary = { edited: number; added: number; removed: number }

/** 고친 블록 수·추가한 문단 수·지운 블록 수 */
export function summarizeChanges(
  blocks: readonly EditorBlock[],
  originalSrcCount: number
): ChangeSummary {
  let edited = 0
  let added = 0
  const present = new Set<number>()
  for (const b of blocks) {
    if (b.src === null) {
      added += 1
      continue
    }
    present.add(b.src)
    if (isBlockChanged(b)) edited += 1
  }
  return { edited, added, removed: Math.max(0, originalSrcCount - present.size) }
}

export function hasChanges(s: ChangeSummary): boolean {
  return s.edited + s.added + s.removed > 0
}

function countIn(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    n += 1
  }
  return n
}

/** 찾기 — 문서 전체(고칠 수 있는 글자)에서 몇 군데인가 */
export function countMatches(blocks: readonly EditorBlock[], find: string): number {
  if (!find) return 0
  let n = 0
  for (const b of blocks) {
    if (b.kind === 'readonly') continue
    if (b.kind === 'table') {
      for (const row of b.cells) for (const c of row) if (c.editable) n += countIn(c.text, find)
    } else {
      n += countIn(b.text, find)
    }
  }
  return n
}

/** 모두 바꾸기 — 바뀐 블록 목록과 바꾼 군데 수 */
export function replaceAllIn(
  blocks: readonly EditorBlock[],
  find: string,
  replacement: string
): { blocks: EditorBlock[]; count: number } {
  if (!find) return { blocks: [...blocks], count: 0 }
  let count = 0
  const swap = (s: string) => {
    const n = countIn(s, find)
    if (n === 0) return s
    count += n
    return s.split(find).join(replacement)
  }
  const next = blocks.map((b): EditorBlock => {
    if (b.kind === 'readonly') return b
    if (b.kind === 'table') {
      return {
        ...b,
        cells: b.cells.map(r => r.map(c => (c.editable ? { ...c, text: swap(c.text) } : c))),
      }
    }
    return { ...b, text: swap(b.text) }
  })
  return { blocks: next, count }
}

/** 쪽 그림 주소 */
export function draftPageUrl(attachmentId: string, uploadId: string, page: number): string {
  return `/api/board-room/work/files/${attachmentId}/drafts/${uploadId}/render?view=layout&page=${page}`
}

/** 새 한글 문서 첫 저장본(원본 없음, docs/18)의 쪽 그림 주소 */
export function newDraftPageUrl(uploadId: string, page: number): string {
  return `/api/board-room/work/files/new-drafts/${uploadId}/render?view=layout&page=${page}`
}
