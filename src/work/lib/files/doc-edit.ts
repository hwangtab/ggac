import { createHash } from 'crypto'
import JSZip from 'jszip'
import type { IRBlock, IRCell, PatchResult } from 'kordoc'
import {
  cleanCell,
  cleanLine,
  BLOCKED_MESSAGE,
  hwpBlockDriftBlocked,
  type ClickHereInfo,
  type DocFormat,
  type DraftSkip,
  type DraftVerification,
  type EditBlock,
  type EditBlockInput,
  type EditCell,
  type EditableBlocks,
  type ObjectsDropped,
  type FormFieldInfo,
  type FormSchemaInfo,
} from './doc-edit-types'
import { DOC_EDIT_MAX_BLOCKS, DOC_EDIT_TIMEOUT_MS, RenderError } from './render-types'
import { guardZipBuffer, readZipText } from './zip-guard'

/**
 * HWP·HWPX 양식 채우기·문구 고치기 변환(docs/10 §3-2). kordoc 만 쓴다.
 * 서버 전용(Route Handler 에서만 import). 순수 입출력 — Storage·DB 를 모른다.
 *
 * 입력 값·문서 글자는 로그·오류 메시지에 담지 않는다(오류는 RenderError 코드만).
 * 경로: HWPX 채우기 = `fillHwpx`(누름틀 포함, 서식 보존) · HWP 채우기 = parse → fillFormFields → blocksToMarkdown → patchHwp.
 * 문구 고치기는 두 형식 모두 편집한 kordoc 블록 → blocksToMarkdown → patchHwpx/patchHwp (마크다운 문자열을 직접 이어 붙이지 않는다).
 */

type Kordoc = typeof import('kordoc')

/** 문서 구조를 읽을 때 쓰는 parse 옵션 — 읽기·패치 기준을 한곳에서 맞춘다(patchHwp/patchHwpx 가 내부에서 같은 기준으로 원본을 다시 읽는다) */
/**
 * 왕복 패치·양식 채우기는 원본 표 서수가 필요하다 — 테두리 없는 틀 표를 글로 풀면(기본 'visual')
 * patchHwp/patchHwpx 가 원본 위치를 못 찾아 실패한다(공문·양식에 흔함, 운영 실파일 점검에서 확인).
 */
const PARSE_OPTIONS = { layoutTables: 'keep' } as const

export type BuiltDraft = {
  format: DocFormat
  data: Buffer
  applied: number
  skipped: DraftSkip[]
  unmatched: string[]
  verification: DraftVerification | null
  warnings: string[]
  blocked: boolean
  blockedReason: string | null
}

export class DocEditError extends Error {
  readonly code: 'bad_request' | 'conflict' | 'unsupported'
  constructor(code: 'bad_request' | 'conflict' | 'unsupported', message: string) {
    super(message)
    this.name = 'DocEditError'
    this.code = code
  }
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength)
  new Uint8Array(out).set(b)
  return out
}

/**
 * 응답을 끊는 시간 제한. 한계: Promise.race 라 kordoc 의 동기 CPU 구간(HWP5 바이너리 파싱, 큰 표 처리 등)은
 * 중단하지 못한다 — 그 구간에서는 이벤트 루프가 막혀 타이머도 못 돈다. 그래서 원본 크기(DOC_EDIT_MAX_BYTES)·
 * 블록 수(DOC_EDIT_MAX_BLOCKS)·압축 해제량 상한을 먼저 걸고, 끝내 못 끊은 요청은 함수 maxDuration(60초)이
 * 끊는다(클라이언트는 504 를 안내 문구로 처리 — doc-edit-client.ts).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderError('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

function failureToError(r: { code?: string; error?: string }): RenderError {
  switch (r.code) {
    case 'UNSUPPORTED_FORMAT':
      return new RenderError('unsupported')
    case 'ENCRYPTED':
    case 'DRM_PROTECTED':
      return new RenderError('encrypted')
    case 'DECOMPRESSION_BOMB':
    case 'ZIP_BOMB':
    case 'OUTPUT_TOO_LARGE':
      return new RenderError('too_large')
    default:
      return new RenderError('corrupt')
  }
}

/** kordoc 가 던진 예외 → RenderError(문서 내용을 메시지에 싣지 않는다) */
function mapError(e: unknown): RenderError {
  if (e instanceof RenderError) return e
  const msg = e instanceof Error ? e.message : ''
  if (/암호|encrypt|password|DRM/i.test(msg)) return new RenderError('encrypted')
  if (/미지원|지원하지|unsupported/i.test(msg)) return new RenderError('unsupported')
  return new RenderError('corrupt')
}

/** 바이트로 형식을 판별한다(확장자를 믿지 않는다). HWP·HWPX 가 아니면 null */
export async function detectDocFormat(bytes: Uint8Array): Promise<DocFormat | null> {
  const k = await import('kordoc')
  const ab = toArrayBuffer(bytes.subarray(0, Math.min(bytes.byteLength, 4096)))
  if (k.isOldHwpFile(ab)) return 'hwp'
  if (k.isHwpxFile(ab)) return 'hwpx'
  return null
}

type Parsed = { k: Kordoc; format: DocFormat; blocks: IRBlock[] }

async function parseBlocks(bytes: Uint8Array): Promise<Parsed> {
  const format = await detectDocFormat(bytes)
  if (!format) throw new RenderError('unsupported')
  // HWPX 는 zip — 풀기 전에 실제 해제량을 검사한다(압축 폭탄)
  if (format === 'hwpx') await guardZipBuffer(Buffer.from(bytes), 'doc.hwpx')
  const k = await import('kordoc')
  let result
  try {
    result = await k.parse(toArrayBuffer(bytes), PARSE_OPTIONS)
  } catch (e) {
    throw mapError(e)
  }
  if (!result.success) throw failureToError(result)
  return { k, format, blocks: result.blocks }
}

function hashOf(k: Kordoc, blocks: IRBlock[]): string {
  return createHash('sha256').update(k.blocksToMarkdown(blocks)).digest('hex').slice(0, 32)
}

// ── 양식 칸 ────────────────────────────────────────────────────────────────

/** 양식 칸 스키마. HWPX 면 누름틀도 함께 */
export async function readFormSchema(bytes: Uint8Array): Promise<FormSchemaInfo> {
  const { k, format, blocks } = await withTimeout(parseBlocks(bytes), DOC_EDIT_TIMEOUT_MS)
  const schema = k.extractFormSchema(blocks)

  const counts = new Map<string, number>()
  for (const f of schema.fields) counts.set(f.label, (counts.get(f.label) ?? 0) + 1)
  const seen = new Set<string>()
  const fields: FormFieldInfo[] = []
  for (const f of schema.fields) {
    // 같은 라벨은 한 칸으로 합친다(같은 값 전체 채우기) — 첫 등장 기준
    if (seen.has(f.label)) continue
    seen.add(f.label)
    fields.push({
      label: f.label,
      kind: f.type,
      required: f.required === true,
      empty: f.empty,
      value: f.value,
      repeated: (counts.get(f.label) ?? 0) > 1,
    })
  }

  let clickHere: ClickHereInfo[] = []
  if (format === 'hwpx') {
    try {
      const raw = await k.extractClickHereFields(toArrayBuffer(bytes))
      const names = new Set<string>()
      for (const c of raw) {
        if (!c.name || names.has(c.name)) continue
        names.add(c.name)
        clickHere.push({ name: c.name, placeholder: c.placeholder ?? null, value: c.value })
      }
    } catch {
      clickHere = []
    }
  }

  return { format, fields, clickHere, confidence: schema.confidence }
}

// ── 채우기 ─────────────────────────────────────────────────────────────────

function cleanValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [label, v] of Object.entries(values)) {
    const key = cleanLine(label).trim()
    const val = cleanLine(v)
    if (!key || val === '') continue // 비운 칸은 건드리지 않는다
    out[key] = val
  }
  return out
}

function summarizePatch(r: PatchResult): {
  applied: number
  skipped: DraftSkip[]
  verification: DraftVerification | null
  warnings: string[]
} {
  const stats = r.verification?.stats
  return {
    applied: r.applied,
    skipped: r.skipped.map(s => ({
      reason: s.reason,
      before: s.before,
      after: s.after,
      partial: s.partial,
    })),
    verification: stats
      ? { modified: stats.modified, added: stats.added, removed: stats.removed }
      : null,
    warnings: r.warnings ?? [],
  }
}

/**
 * 결과 문서 검사(§2-4) — 재파싱 성공·HWPX 구조 검증·검증 잔차. 문제가 있으면 막힘 사유를 돌려준다.
 * 쪽 수 비교는 레이아웃 렌더가 필요해 호출부(Route Handler)가 한다.
 */
async function judge(
  k: Kordoc,
  format: DocFormat,
  data: Uint8Array,
  verification: DraftVerification | null
): Promise<string | null> {
  if (verification && verification.modified + verification.added + verification.removed > 0) {
    return BLOCKED_MESSAGE.residual
  }
  if (format === 'hwpx') {
    try {
      const v = await k.validateHwpx(toArrayBuffer(data))
      if (!v.ok) return BLOCKED_MESSAGE.invalid
    } catch {
      return BLOCKED_MESSAGE.invalid
    }
  }
  try {
    const re = await k.parse(toArrayBuffer(data), PARSE_OPTIONS)
    if (!re.success) return BLOCKED_MESSAGE.reparse
  } catch {
    return BLOCKED_MESSAGE.reparse
  }
  return null
}

/**
 * 양식 채우기 초안. `values` 는 라벨(또는 누름틀 이름) → 값. 비운 값은 보내지 않은 것으로 본다.
 * 실패는 RenderError.
 */
export async function buildFilledDraft(
  bytes: Uint8Array,
  values: Record<string, string>,
  opts: { timeoutMs?: number; allowHwp?: boolean } = {}
): Promise<BuiltDraft> {
  return withTimeout(
    fillInner(bytes, values, opts.allowHwp === true),
    opts.timeoutMs ?? DOC_EDIT_TIMEOUT_MS
  )
}

/** HWP 5.x 양식 채우기를 막을 때의 안내(문구 고치기의 표 칸 입력으로 같은 일을 할 수 있다) */
export const HWP_FILL_UNSUPPORTED_MESSAGE =
  'HWP 양식 채우기는 아직 안정적이지 않아 막아 두었습니다. 문구 고치기에서 표 칸을 직접 고쳐 주세요.'

async function fillInner(
  bytes: Uint8Array,
  rawValues: Record<string, string>,
  allowHwp: boolean
): Promise<BuiltDraft> {
  const clean = cleanValues(rawValues)
  const { k, format, blocks } = await parseBlocks(bytes)
  // 운영 실파일 점검(2026-10-26, HWP 18건)에서 fillFormFields → patchHwp 경로는 2건만 검증을 통과했다 —
  // 앱에서는 HWPX 만 연다. allowHwp 는 점검 스크립트(scripts/check-doc-edit.ts)가 계속 측정하려고 쓴다.
  if (format === 'hwp' && !allowHwp) {
    throw new DocEditError('unsupported', HWP_FILL_UNSUPPORTED_MESSAGE)
  }

  if (format === 'hwpx') {
    let res
    try {
      res = await k.fillHwpx(toArrayBuffer(bytes), clean)
    } catch (e) {
      throw mapError(e)
    }
    const data = Buffer.from(res.buffer)
    const blockedReason = await judge(k, format, data, null)
    return {
      format,
      data,
      applied: res.filled.length,
      skipped: [],
      unmatched: res.unmatched,
      verification: null,
      warnings: res.warnings ?? [],
      blocked: blockedReason !== null,
      blockedReason,
    }
  }

  // HWP 5.x — 서식 보존 채우기가 없어 채운 블록을 마크다운으로 만들어 글자 치환 패치한다.
  const fill = k.fillFormFields(blocks, clean)
  let patch: PatchResult
  try {
    patch = await k.patchHwp(bytes, k.blocksToMarkdown(fill.blocks))
  } catch (e) {
    throw mapError(e)
  }
  if (!patch.success || !patch.data) throw new RenderError('corrupt')
  const sum = summarizePatch(patch)
  const data = Buffer.from(patch.data)
  const blockedReason = await judge(k, format, data, sum.verification)
  return {
    format,
    data,
    applied: fill.filled.length,
    skipped: sum.skipped,
    unmatched: fill.unmatched,
    verification: sum.verification,
    warnings: [...sum.warnings, ...(fill.warnings ?? [])],
    blocked: blockedReason !== null,
    blockedReason,
  }
}

// ── 문구 고치기 ────────────────────────────────────────────────────────────

function isEditableCell(c: IRCell): boolean {
  return c.colSpan <= 1 && c.rowSpan <= 1 && !c.blocks
}

function countCells(blocks: IRBlock[]): number {
  let n = 0
  for (const b of blocks) {
    n += 1
    if (b.table) for (const row of b.table.cells) n += row.length
  }
  return n
}

function readonlyLabel(b: IRBlock): string {
  if (b.type === 'image') return '그림'
  if (b.type === 'separator') return '구분선'
  return b.type
}

/** 문구 고치기용 블록. 상한(5,000)을 넘으면 RenderError('too_large') */
export async function readEditableBlocks(bytes: Uint8Array): Promise<EditableBlocks> {
  const { k, format, blocks } = await withTimeout(parseBlocks(bytes), DOC_EDIT_TIMEOUT_MS)
  if (countCells(blocks) > DOC_EDIT_MAX_BLOCKS) throw new RenderError('too_large')

  const out: EditBlock[] = blocks.map((b, i): EditBlock => {
    if (b.type === 'heading')
      return { src: i, kind: 'heading', level: b.level ?? 1, text: b.text ?? '' }
    if (b.type === 'paragraph') return { src: i, kind: 'paragraph', text: b.text ?? '' }
    if (b.type === 'list') return { src: i, kind: 'list', text: b.text ?? '' }
    if (b.type === 'table' && b.table) {
      const cells: EditCell[][] = b.table.cells.map(row =>
        row.map(c => ({
          text: c.text,
          colSpan: c.colSpan,
          rowSpan: c.rowSpan,
          editable: isEditableCell(c),
        }))
      )
      return { src: i, kind: 'table', cells }
    }
    return { src: i, kind: 'readonly', label: readonlyLabel(b) }
  })

  return {
    format,
    blocks: out,
    baseHash: hashOf(k, blocks),
    canRestructure: format === 'hwpx',
  }
}

/** 클라이언트가 보낸 편집 블록을 원본 블록에 적용해 새 블록 목록을 만든다. 모양이 안 맞으면 DocEditError */
function applyEdits(
  original: IRBlock[],
  edits: EditBlockInput[],
  canRestructure: boolean
): { blocks: IRBlock[]; changed: boolean } {
  const used = new Set<number>()
  const result: IRBlock[] = []
  let changed = false
  let structural = false

  for (const e of edits) {
    if (e.src === null) {
      // 새 문단
      if (e.kind === 'table' || e.kind === 'readonly')
        throw new DocEditError('bad_request', '잘못된 블록입니다.')
      structural = true
      changed = true
      result.push({ type: e.kind === 'heading' ? 'paragraph' : e.kind, text: cleanLine(e.text) })
      continue
    }
    const src = original[e.src]
    if (!src || used.has(e.src)) throw new DocEditError('bad_request', '문서 구조가 맞지 않습니다.')
    used.add(e.src)

    if (e.kind === 'readonly') {
      result.push(src)
      continue
    }
    if (e.kind === 'table') {
      if (src.type !== 'table' || !src.table)
        throw new DocEditError('bad_request', '문서 구조가 맞지 않습니다.')
      const table = src.table
      if (e.cells.length !== table.cells.length)
        throw new DocEditError('bad_request', '표 모양이 맞지 않습니다.')
      let tableChanged = false
      const cells = table.cells.map((row, r) => {
        const inRow = e.cells[r]
        if (inRow.length !== row.length)
          throw new DocEditError('bad_request', '표 모양이 맞지 않습니다.')
        return row.map((c, ci) => {
          if (!isEditableCell(c)) return c
          const next = cleanCell(inRow[ci])
          if (next === c.text) return c
          tableChanged = true
          return { ...c, text: next }
        })
      })
      if (tableChanged) {
        changed = true
        result.push({ ...src, table: { ...table, cells } })
      } else {
        result.push(src)
      }
      continue
    }
    // heading | paragraph | list
    if (src.type !== e.kind) throw new DocEditError('bad_request', '문서 구조가 맞지 않습니다.')
    const next = cleanLine(e.text)
    if (next === (src.text ?? '')) {
      result.push(src)
    } else {
      changed = true
      // 글이 바뀌면 인라인 강조 구간(spans)이 어긋나므로 버린다
      result.push({ ...src, text: next, spans: undefined })
    }
  }

  if (used.size !== original.length) {
    structural = true // 빠진 블록 = 삭제
    changed = true
  }
  if (structural && !canRestructure) {
    throw new DocEditError(
      'unsupported',
      'HWP 문서는 문단 추가·삭제를 지원하지 않습니다. 글자만 고칠 수 있어요.'
    )
  }
  return { blocks: result, changed }
}

/** 문구 고치기 초안. `baseHash` 가 다르면 DocEditError('conflict') */
export async function buildPatchedDraft(
  bytes: Uint8Array,
  edits: EditBlockInput[],
  baseHash: string,
  opts: { timeoutMs?: number } = {}
): Promise<BuiltDraft> {
  return withTimeout(patchInner(bytes, edits, baseHash), opts.timeoutMs ?? DOC_EDIT_TIMEOUT_MS)
}

async function patchInner(
  bytes: Uint8Array,
  edits: EditBlockInput[],
  baseHash: string
): Promise<BuiltDraft> {
  const { k, format, blocks } = await parseBlocks(bytes)
  if (hashOf(k, blocks) !== baseHash) {
    throw new DocEditError('conflict', '문서 내용이 달라졌습니다. 새로 고친 뒤 다시 시도해 주세요.')
  }
  const { blocks: next } = applyEdits(blocks, edits, format === 'hwpx')
  const md = k.blocksToMarkdown(next)

  let patch: PatchResult
  try {
    patch = format === 'hwpx' ? await k.patchHwpx(bytes, md) : await k.patchHwp(bytes, md)
  } catch (e) {
    throw mapError(e)
  }
  if (!patch.success || !patch.data) throw new RenderError('corrupt')
  const sum = summarizePatch(patch)
  const data = Buffer.from(patch.data)
  const blockedReason = await judge(k, format, data, sum.verification)
  return {
    format,
    data,
    applied: sum.applied,
    skipped: sum.skipped,
    unmatched: [],
    verification: sum.verification,
    warnings: sum.warnings,
    blocked: blockedReason !== null,
    blockedReason,
  }
}

// ── HWP 앱 안 편집 저장본 검사(docs/12 §2-3) ───────────────────────────────

export type HwpSaveInspection = {
  /** 막힘 사유(없으면 통과). 문서 내용은 담지 않는다 */
  blockedReason: string | null
  originalBlocks: number | null
  draftBlocks: number | null
}

/**
 * 편집기(rhwp)가 내보낸 HWP 가 우리 쪽 변환기(kordoc)로 다시 읽히는지, 원본과 구조가 크게 어긋나지 않는지 본다.
 * 형식(HWP 5.x) → 다시 읽기(layoutTables 'keep') → 블록 수 변화 `max(5, 원본×20%)` 이하. 쪽 수 비교는 호출부(레이아웃 렌더)가 한다.
 * 원본을 못 읽으면(깨진 원본) 비교할 수 없어 막는다. 문서 글자는 로그·반환값에 담지 않는다.
 */
export async function inspectHwpEditorSave(
  original: Uint8Array,
  saved: Uint8Array,
  opts: { timeoutMs?: number } = {}
): Promise<HwpSaveInspection> {
  return withTimeout(inspectInner(original, saved), opts.timeoutMs ?? DOC_EDIT_TIMEOUT_MS)
}

async function inspectInner(original: Uint8Array, saved: Uint8Array): Promise<HwpSaveInspection> {
  if ((await detectDocFormat(saved)) !== 'hwp') {
    return { blockedReason: BLOCKED_MESSAGE.notHwp, originalBlocks: null, draftBlocks: null }
  }
  const k = await import('kordoc')
  let draftBlocks: number
  try {
    const re = await k.parse(toArrayBuffer(saved), PARSE_OPTIONS)
    if (!re.success) {
      return { blockedReason: BLOCKED_MESSAGE.reparse, originalBlocks: null, draftBlocks: null }
    }
    draftBlocks = re.blocks.length
  } catch {
    return { blockedReason: BLOCKED_MESSAGE.reparse, originalBlocks: null, draftBlocks: null }
  }
  let originalBlocks: number
  try {
    const o = await k.parse(toArrayBuffer(original), PARSE_OPTIONS)
    if (!o.success) {
      return { blockedReason: BLOCKED_MESSAGE.original, originalBlocks: null, draftBlocks }
    }
    originalBlocks = o.blocks.length
  } catch {
    return { blockedReason: BLOCKED_MESSAGE.original, originalBlocks: null, draftBlocks }
  }
  return {
    blockedReason: hwpBlockDriftBlocked(originalBlocks, draftBlocks) ? BLOCKED_MESSAGE.drift : null,
    originalBlocks,
    draftBlocks,
  }
}

// ── HWPX 앱 안 편집 저장본 검사(docs/18 §2) ────────────────────────────────

export type HwpxSaveInspection = {
  /** 막힘 사유(없으면 통과). 문서 내용은 담지 않는다 */
  blockedReason: string | null
  /** 원본이 있을 때만 — 원본보다 줄어든 개체(막지 않고 경고) */
  objectsDropped: ObjectsDropped | null
  clickHereBefore: number | null
  clickHereAfter: number | null
}

type ObjectCounts = { tables: number; pictures: number; shapes: number; equations: number }

const OBJECT_TAGS: readonly [keyof ObjectCounts, RegExp][] = [
  ['tables', /<hp:tbl[\s>/]/g],
  ['pictures', /<hp:pic[\s>/]/g],
  ['shapes', /<hp:(?:rect|ellipse|line|polygon|curve|arc|container)[\s>/]/g],
  ['equations', /<hp:equation[\s>/]/g],
]

/** section XML(`Contents/section*.xml`)의 개체 수 — 표·그림·도형·수식. 읽을 수 없으면 null */
async function countHwpxObjects(bytes: Uint8Array): Promise<ObjectCounts | null> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const counts: ObjectCounts = { tables: 0, pictures: 0, shapes: 0, equations: 0 }
    let budget = 100 * 1024 * 1024
    for (const name of Object.keys(zip.files)) {
      if (!/^Contents\/section\d+\.xml$/i.test(name)) continue
      const entry = zip.file(name)
      if (!entry) continue
      const { text, bytes: used } = await readZipText(entry, budget)
      budget -= used
      for (const [key, re] of OBJECT_TAGS) counts[key] += (text.match(re) ?? []).length
    }
    return counts
  } catch {
    return null
  }
}

export function droppedObjects(before: ObjectCounts, after: ObjectCounts): ObjectsDropped {
  return {
    tables: Math.max(0, before.tables - after.tables),
    pictures: Math.max(0, before.pictures - after.pictures),
    shapes: Math.max(0, before.shapes - after.shapes),
    equations: Math.max(0, before.equations - after.equations),
  }
}

async function clickHereCount(k: Kordoc, bytes: Uint8Array): Promise<number | null> {
  try {
    return (await k.extractClickHereFields(toArrayBuffer(bytes))).length
  } catch {
    return null
  }
}

/**
 * 편집기(rhwp)가 내보낸 HWPX 가 우리 쪽 변환기(kordoc)로 다시 읽히는지, 원본의 입력 칸·개체가 사라지지 않았는지 본다.
 * 형식(HWPX) → 압축 해제량 → `validateHwpx` → 재파싱 → (원본이 있으면) 누름틀 수가 줄지 않음. 개체(표·그림·도형·수식) 감소는 막지 않고
 * `objectsDropped` 로 알린다. **블록 수 변화는 막지 않는다** — 화면 편집은 내용을 크게 늘리고 줄이는 게 정상이다.
 * 쪽 수는 호출부(레이아웃 렌더)가 보여 줄 뿐 막지 않는다. `original` 이 null 이면 새 문서의 첫 저장본(비교 생략).
 * 문서 글자는 로그·반환값에 담지 않는다.
 */
export async function inspectHwpxEditorSave(
  original: Uint8Array | null,
  saved: Uint8Array,
  opts: { timeoutMs?: number } = {}
): Promise<HwpxSaveInspection> {
  return withTimeout(hwpxInspectInner(original, saved), opts.timeoutMs ?? DOC_EDIT_TIMEOUT_MS)
}

async function hwpxInspectInner(
  original: Uint8Array | null,
  saved: Uint8Array
): Promise<HwpxSaveInspection> {
  const blocked = (reason: string): HwpxSaveInspection => ({
    blockedReason: reason,
    objectsDropped: null,
    clickHereBefore: null,
    clickHereAfter: null,
  })
  if ((await detectDocFormat(saved)) !== 'hwpx') return blocked(BLOCKED_MESSAGE.notHwpx)
  try {
    await guardZipBuffer(Buffer.from(saved), 'doc.hwpx')
  } catch {
    return blocked(BLOCKED_MESSAGE.invalid)
  }
  const k = await import('kordoc')
  try {
    const v = await k.validateHwpx(toArrayBuffer(saved))
    if (!v.ok) return blocked(BLOCKED_MESSAGE.invalid)
  } catch {
    return blocked(BLOCKED_MESSAGE.invalid)
  }
  try {
    const re = await k.parse(toArrayBuffer(saved), PARSE_OPTIONS)
    if (!re.success) return blocked(BLOCKED_MESSAGE.reparse)
  } catch {
    return blocked(BLOCKED_MESSAGE.reparse)
  }
  if (!original) {
    return {
      blockedReason: null,
      objectsDropped: null,
      clickHereBefore: null,
      clickHereAfter: null,
    }
  }

  // 원본과 비교 — 원본을 못 읽으면 비교할 수 없어 막는다(HWP 와 같은 규칙)
  const before = await clickHereCount(k, original)
  const beforeObjects = await countHwpxObjects(original)
  if (before === null || beforeObjects === null) return blocked(BLOCKED_MESSAGE.original)
  const after = await clickHereCount(k, saved)
  const afterObjects = await countHwpxObjects(saved)
  if (after === null || afterObjects === null) return blocked(BLOCKED_MESSAGE.reparse)
  const dropped = droppedObjects(beforeObjects, afterObjects)
  return {
    blockedReason: after < before ? BLOCKED_MESSAGE.clickHere : null,
    objectsDropped:
      dropped.tables + dropped.pictures + dropped.shapes + dropped.equations > 0 ? dropped : null,
    clickHereBefore: before,
    clickHereAfter: after,
  }
}
