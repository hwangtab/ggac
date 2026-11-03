import { z } from 'zod'
import { escapeMarkdownInline } from '@work/lib/tabs/schema'
import { DOC_EDIT_MAX_BLOCKS, DOC_EDIT_MAX_PAGE_DIFF } from './render-types'
import { boundedArray } from '@work/lib/validation/bounded-array'

/**
 * 문서 편집(HWP 양식 채우기·문구 고치기, docs/10)의 공용 타입·순수 규칙. kordoc 을 import 하지 않아
 * 화면(클라이언트)·Route Handler·서버 액션이 모두 쓸 수 있다.
 */

export type DocFormat = 'hwp' | 'hwpx'

// ── 양식 칸 ────────────────────────────────────────────────────────────────

export type FormFieldKind = 'text' | 'date' | 'phone' | 'email' | 'amount' | 'checkbox' | 'idnum'

export type FormFieldInfo = {
  /** 채우기 키(= 문서의 라벨) */
  label: string
  kind: FormFieldKind
  required: boolean
  /** 지금 칸이 비어 있나 */
  empty: boolean
  /** 원래 값(회색 표시용) */
  value: string
  /** 같은 라벨이 문서에 여러 번 나온다(같은 값으로 전부 채워진다) */
  repeated: boolean
}

export type ClickHereInfo = {
  /** 채우기 키(누름틀 이름) */
  name: string
  placeholder: string | null
  value: string
}

export type FormSchemaInfo = {
  format: DocFormat
  fields: FormFieldInfo[]
  clickHere: ClickHereInfo[]
  /** 0~1. 낮으면 화면이 "칸을 잘못 찾았을 수 있어요" 안내 */
  confidence: number
}

/** 이보다 낮으면 화면이 칸 인식 경고를 띄운다 */
export const FORM_LOW_CONFIDENCE = 0.4

// ── 문구 고치기 블록 ───────────────────────────────────────────────────────

export type EditCell = {
  text: string
  colSpan: number
  rowSpan: number
  /** false 면 읽기 전용 칸(병합 셀·표/그림이 든 셀) */
  editable: boolean
}

/** 서버가 내려주는 블록(문서 순서). `src` 는 원본 블록 번호 */
export type EditBlock =
  | { src: number; kind: 'heading'; level: number; text: string }
  | { src: number; kind: 'paragraph'; text: string }
  | { src: number; kind: 'list'; text: string }
  | { src: number; kind: 'table'; cells: EditCell[][] }
  | { src: number; kind: 'readonly'; label: string }

export type EditableBlocks = {
  format: DocFormat
  blocks: EditBlock[]
  /** 원본 구조의 해시 — 초안 만들 때 같이 보내 동시 수정·다른 문서를 가린다 */
  baseHash: string
  /** HWP 5.x 는 문단 추가·삭제를 못 한다 */
  canRestructure: boolean
}

// ── 초안 요청(zod) ─────────────────────────────────────────────────────────

/** 제어문자(탭·줄바꿈 제외)를 지운다 — 문서 글자로만 들어가야 한다 */
export function stripControlChars(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** 단일 줄 텍스트(문단·제목·채우기 값): 제어문자 제거 + 줄바꿈은 공백 */
export function cleanLine(s: string): string {
  return stripControlChars(s.normalize('NFC')).replace(/\s*[\r\n]+\s*/g, ' ')
}

/** 표 셀 텍스트: 제어문자 제거 + 줄바꿈 통일(여러 줄 허용) */
export function cleanCell(s: string): string {
  return stripControlChars(s.normalize('NFC')).replace(/\r\n?/g, '\n')
}

const MAX_TEXT = 20_000
const MAX_VALUE = 2_000
const MAX_FILL_KEYS = 500

const uuid = z.string().uuid('잘못된 식별자입니다.')

export const fillValuesSchema = z
  .record(z.string().min(1).max(200), z.string().max(MAX_VALUE))
  .refine(v => Object.keys(v).length <= MAX_FILL_KEYS, '칸이 너무 많습니다.')

const editBlockInputSchema = z.union([
  z.object({
    src: z.number().int().min(0).nullable(),
    kind: z.enum(['heading', 'paragraph', 'list']),
    text: z.string().max(MAX_TEXT),
  }),
  z.object({
    src: z.number().int().min(0),
    kind: z.literal('table'),
    cells: boundedArray(boundedArray(z.string().max(MAX_TEXT), { max: 200 }), { max: 2000 }),
  }),
  z.object({ src: z.number().int().min(0), kind: z.literal('readonly') }),
])

export type EditBlockInput = z.infer<typeof editBlockInputSchema>

export const draftRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fill'),
    values: fillValuesSchema,
    /** 직전 초안 — 새 초안을 만들 때 지운다(임시 업로드 상한 보호) */
    previousUploadId: uuid.optional(),
  }),
  z.object({
    mode: z.literal('patch'),
    blocks: boundedArray(editBlockInputSchema, { max: DOC_EDIT_MAX_BLOCKS }),
    baseHash: z.string().min(8).max(64),
    previousUploadId: uuid.optional(),
  }),
])

export type DraftRequest = z.infer<typeof draftRequestSchema>

// ── 초안 결과 ──────────────────────────────────────────────────────────────

export type DraftSkip = {
  reason: string
  before?: string
  after?: string
  partial?: boolean
}

export type DraftVerification = { modified: number; added: number; removed: number }

/** 초안 종류 — 'hwp-editor' 는 HWP 앱 안 편집(docs/12)이 올린 저장본의 검증 결과 */
export type DraftMode = 'fill' | 'patch' | 'hwp-editor'

/** 개체 종류별로 원본보다 줄어든 개수(0 이면 줄지 않음). 편집기가 낸 HWPX 의 section XML 을 센 값 */
export type ObjectsDropped = {
  tables: number
  pictures: number
  shapes: number
  equations: number
}

export function hasObjectsDropped(d: ObjectsDropped | undefined | null): d is ObjectsDropped {
  return !!d && d.tables + d.pictures + d.shapes + d.equations > 0
}

/** "표 1개·그림 1개가 줄었습니다 — 직접 지운 게 맞나요?" */
export function objectsDroppedMessage(d: ObjectsDropped): string {
  const parts: string[] = []
  if (d.tables > 0) parts.push(`표 ${d.tables}개`)
  if (d.pictures > 0) parts.push(`그림 ${d.pictures}개`)
  if (d.shapes > 0) parts.push(`도형 ${d.shapes}개`)
  if (d.equations > 0) parts.push(`수식 ${d.equations}개`)
  return `${parts.join('·')}가 줄었습니다 — 직접 지운 게 맞나요?`
}

export type DraftOutcome = {
  uploadId: string
  mode: DraftMode
  format: DocFormat
  applied: number
  skipped: DraftSkip[]
  /** 채우기: 문서에서 못 찾은 라벨 */
  unmatched: string[]
  verification: DraftVerification | null
  /** kordoc 경고(변경 추적 표시 끔 등) */
  warnings: string[]
  /** HWPX 앱 안 편집(docs/18) — 원본보다 줄어든 개체(표·그림·도형·수식). 막지 않고 저장 전에 확인을 받는다 */
  objectsDropped?: ObjectsDropped
  pageCount: number | null
  originalPageCount: number | null
  /** 쪽 그림을 만들 수 있나 */
  previewAvailable: boolean
  /** 저장해 둔 미리보기 쪽 수(DRAFT_PREVIEW_MAX_PAGES 로 잘리면 pageCount 보다 작다). 없으면 pageCount 전부 */
  previewPages?: number
  blocked: boolean
  blockedReason: string | null
}

/** 초안 미리보기로 저장하는 쪽 수 상한(문서 뷰어의 300쪽보다 훨씬 작게 — 초안은 24시간 안에 사라지는 임시 파일) */
export const DRAFT_PREVIEW_MAX_PAGES = 30

/** 막힘 사유 문구 */
export const BLOCKED_MESSAGE = {
  residual: '수정이 문서에 그대로 반영되지 않았습니다.',
  invalid: '만들어진 문서가 올바른 한글 파일이 아닙니다.',
  reparse: '만들어진 문서를 다시 읽지 못했습니다.',
  pages: '쪽 수가 원본과 많이 달라졌습니다.',
  preview: '만들어진 문서의 모양을 그리지 못했습니다.',
  /** HWP 앱 안 편집(docs/12) 저장본 검증 */
  notHwp: '저장된 파일이 HWP 5.x 문서가 아닙니다.',
  drift: '저장된 문서의 구조가 원본과 많이 달라졌습니다.',
  original: '원본 문서를 읽지 못해 비교할 수 없습니다.',
  /** HWPX 앱 안 편집(docs/18) 저장본 검증 */
  notHwpx: '저장된 파일이 HWPX 문서가 아닙니다.',
  clickHere: '문서의 입력 칸(누름틀)이 저장 과정에서 사라졌습니다.',
} as const

/** 막힘 안내 꼬리말 — 1단계 경로로 안내 */
export const BLOCKED_HINT = '이 문서는 앱에서 고치기 어렵습니다 — 내 PC에서 수정을 써 주세요.'

/** 초안 쪽 수가 원본과 크게 다른가(둘 다 알 때만) */
export function pageCountBlocked(original: number | null, draft: number | null): boolean {
  if (original === null || draft === null) return false
  return Math.abs(draft - original) >= DOC_EDIT_MAX_PAGE_DIFF
}

/** 저장 전 확인이 필요한가(반영 안 된 수정) */
export function needsSkipConfirm(o: Pick<DraftOutcome, 'skipped' | 'blocked'>): boolean {
  return !o.blocked && o.skipped.length > 0
}

/** 첫 번째 텍스트 칸에 넣은 값 — 새 파일 이름 제안용 */
export function firstTextValue(
  fields: readonly { label: string; kind: string }[],
  values: Record<string, string>
): string | null {
  for (const f of fields) {
    if (f.kind !== 'text') continue
    const v = stripControlChars(values[f.label] ?? '').trim()
    if (v) return v
  }
  return null
}

// ── 이름·게시물 문구 ───────────────────────────────────────────────────────

/** 오늘(Asia/Seoul) YYMMDD */
export function todayYymmdd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  return `${p('year')}${p('month')}${p('day')}`
}

/** 확장자 앞/뒤 분리 — `보고서.v2.hwp` → [`보고서.v2`, `.hwp`] */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || name.length - dot > 8) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

/**
 * 새 파일 이름 제안: `<원본 이름>_<첫 번째 텍스트 칸 값 또는 오늘 YYMMDD>.<확장자>`.
 * 파일 이름에 못 쓰는 글자는 뺀다.
 */
export function suggestNewFileName(
  original: string,
  firstTextValue: string | null,
  now: Date = new Date()
): string {
  const [base, ext] = splitExt(original)
  const raw = (firstTextValue ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim()
  const tag = raw ? raw.slice(0, 30) : todayYymmdd(now)
  return `${base}_${tag}${ext}`
}

/** 새 파일 게시물: "A님이 '신청서.hwp' 양식을 채워 '신청서_홍길동.hwp'를 만들었습니다." */
export function filledFileBody(actor: string, original: string, created: string): string {
  return `${escapeMarkdownInline(actor)}님이 '${escapeMarkdownInline(original)}' 양식을 채워 '${escapeMarkdownInline(created)}'를 만들었습니다.`
}

/** 새 파일 게시물(문구 고치기): "A님이 '보고서.hwp'의 문구를 고쳐 '보고서_수정.hwp'를 만들었습니다." */
export function editedFileBody(actor: string, original: string, created: string): string {
  return `${escapeMarkdownInline(actor)}님이 '${escapeMarkdownInline(original)}'의 문구를 고쳐 '${escapeMarkdownInline(created)}'를 만들었습니다.`
}

/** 새 버전 게시물 꼬리말 */
export const APP_EDIT_SUFFIX = ' (앱에서 문구 수정)'

/** 오피스 앱 편집(docs/11) 새 버전 게시물 꼬리말 */
export const OFFICE_EDIT_SUFFIX = ' (앱에서 편집)'

/** HWP 앱 안 편집(docs/12) 새 버전 게시물 꼬리말 */
export const HWP_EDITOR_SUFFIX = ' (앱에서 HWP 편집)'

/** HWPX 앱 안 편집(docs/18) 새 버전 게시물 꼬리말 */
export const HWPX_EDITOR_SUFFIX = ' (앱에서 HWPX 편집)'

/** 저장본의 블록 수가 원본과 이만큼(max(5, 원본×20%)) 넘게 달라지면 막는다 */
export function hwpBlockDriftLimit(originalBlocks: number): number {
  return Math.max(5, Math.floor(originalBlocks * 0.2))
}

export function hwpBlockDriftBlocked(originalBlocks: number, draftBlocks: number): boolean {
  return Math.abs(draftBlocks - originalBlocks) > hwpBlockDriftLimit(originalBlocks)
}

/** 임시 업로드 `draft_meta` (pending_uploads, 0034) — 저장 액션이 읽어 막힌 초안·다른 원본의 초안을 거부한다. 문서 내용은 담지 않는다 */
export type DraftMeta = {
  kind: 'doc-edit'
  mode: DraftMode
  /** 첨부에서 만든 초안의 원본 — `newDocument` 와 둘 중 정확히 하나(isDraftMeta) */
  sourceAttachmentId?: string
  /** 새 문서(docs/16·18)의 첫 저장본 — 원본이 없다. 새 버전·사본 저장 경로는 이 초안을 거부한다 */
  newDocument?: true
  /** 저장본 형식(hwp-editor 모드). 없으면 hwp(docs/12 시절 메타) */
  format?: DocFormat
  blocked: boolean
  applied: number
  skipped: number
}

export function isDraftMeta(v: unknown): v is DraftMeta {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.kind === 'doc-edit' &&
    (o.mode === 'fill' || o.mode === 'patch' || o.mode === 'hwp-editor') &&
    (typeof o.sourceAttachmentId === 'string') !== (o.newDocument === true) &&
    (o.newDocument !== true || o.mode === 'hwp-editor') &&
    (o.format === undefined || o.format === 'hwp' || o.format === 'hwpx') &&
    typeof o.blocked === 'boolean' &&
    typeof o.applied === 'number' &&
    typeof o.skipped === 'number'
  )
}

// ── 저장 액션 입력 ─────────────────────────────────────────────────────────

export const saveDraftNewFileSchema = z.object({
  sourceAttachmentId: uuid,
  uploadId: uuid,
  fileName: z.string().trim().min(1, '파일 이름을 입력해 주세요.').max(255),
})

export const discardDraftSchema = z.object({ uploadId: uuid })

export type SaveDraftOutcome = {
  attachmentId: string
  fileName: string
  conversationPath: string
}
