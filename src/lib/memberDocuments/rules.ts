/**
 * 조합원 '내 문서함'의 순수 규칙 — 사용량·보존·이름·형식(docs/board-work/04-조합원-문서함.md §5·§6).
 *
 * **로컬 import가 하나도 없어야 한다** — `node --test`가 이 파일을 직접 읽는다. 서버(라우트·쿼리)와 화면이 같은
 * 숫자·판정을 쓴다. 실제 차단은 라우트가 한다.
 */

const MB = 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

/** 한 사람의 사용량 상한 — 모든 버전의 크기 합 + 올리는 중인 임시 업로드가 알린 크기 */
export const MEMBER_DOCUMENT_QUOTA_BYTES = 200 * MB
/** 파일 한 개 상한(오피스 편집기 상한 OFFICE_EDIT_MAX_BYTES 와 같다) */
export const MEMBER_DOCUMENT_MAX_FILE_BYTES = 50 * MB
/** 임시 업로드가 사용량에 자리를 잡는 시간. 지나면 보존 크론이 객체·행을 치운다 */
export const MEMBER_DOCUMENT_PENDING_TTL_MS = DAY_MS
/** 한 사람이 동시에 들고 있을 수 있는 임시 업로드 수 */
export const MEMBER_DOCUMENT_MAX_PENDING = 20
/** 한 사람이 가질 수 있는 문서 수(목록 한 화면 + 여유) */
export const MEMBER_DOCUMENT_MAX_COUNT = 500

/** 열지 않은 지 이만큼 지나면 알린다 */
export const MEMBER_DOCUMENT_IDLE_MS = 365 * DAY_MS
/** 알린 뒤 이만큼 지나도 열지 않으면 지운다 */
export const MEMBER_DOCUMENT_GRACE_MS = 30 * DAY_MS

/**
 * 같은 브라우저에서 문서함 편집기를 연 적이 있다(localStorage 키) — 로그아웃 때 편집기 출처 저장소를 비울지 정한다.
 * 전역 내비가 읽으므로 가벼운 이 모듈에 둔다.
 */
export const MEMBER_DOCUMENT_EDITOR_USED_KEY = 'ggac-member-docs-editor-used'

/** 이름(확장자 포함) 길이 상한 */
export const MEMBER_DOCUMENT_NAME_MAX = 120

export const QUOTA_EXCEEDED_MESSAGE =
  '내 문서함 용량(200MB)을 넘습니다. 쓰지 않는 문서나 버전을 지운 뒤 다시 시도해 주세요.'
export const FILE_TOO_LARGE_MESSAGE = '파일 한 개는 50MB까지 올릴 수 있습니다.'
export const UNSUPPORTED_TYPE_MESSAGE =
  '문서(PDF·한글·워드·엑셀·파워포인트·텍스트)와 이미지만 올릴 수 있습니다.'

/** 올릴 수 있는 확장자 — 문서·텍스트·이미지. 실행 파일·HTML·압축 파일은 받지 않는다 */
export const MEMBER_DOCUMENT_EXTENSIONS = [
  'pdf',
  'hwp',
  'hwpx',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
] as const

/** 버전이 생긴 경로 */
export const MEMBER_DOCUMENT_SOURCES = ['upload', 'editor', 'restore'] as const
export type MemberDocumentSource = (typeof MEMBER_DOCUMENT_SOURCES)[number]

/** 확장자(점 없이 소문자). 없으면 '' */
export function memberDocumentExtension(name: string): string {
  if (typeof name !== 'string') return ''
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

/** 올릴 수 있는 형식인가(확장자 기준 — 형식 위장은 업로드 토큰의 `allowedContentTypes`가 한 번 더 막는다) */
export function isAllowedMemberDocument(name: string): boolean {
  return (MEMBER_DOCUMENT_EXTENSIONS as readonly string[]).includes(memberDocumentExtension(name))
}

// ── 사용량 ────────────────────────────────────────────────────────────────────

export type QuotaVerdict = {
  ok: boolean
  /** 지금 쓰는 양(바이트) */
  used: number
  /** 더하면 될 양 */
  adding: number
  /** 더한 뒤 남는 양(음수면 넘침) */
  remaining: number
}

/**
 * 더해도 상한 안인가. 값이 이상하면(음수·NaN) 넘친 것으로 본다(닫힌 쪽).
 * 0바이트 파일은 막지 않는다(준비 단계가 따로 거른다).
 */
export function quotaVerdict(
  used: number,
  adding: number,
  quota: number = MEMBER_DOCUMENT_QUOTA_BYTES
): QuotaVerdict {
  const u = Number(used)
  const a = Number(adding)
  if (!Number.isFinite(u) || !Number.isFinite(a) || u < 0 || a < 0) {
    return { ok: false, used: u, adding: a, remaining: -1 }
  }
  const remaining = quota - u - a
  return { ok: remaining >= 0, used: u, adding: a, remaining }
}

/** 사용량 막대 비율(0~1) */
export function quotaRatio(used: number, quota: number = MEMBER_DOCUMENT_QUOTA_BYTES): number {
  if (!(used > 0) || !(quota > 0)) return 0
  return Math.min(1, used / quota)
}

// ── 보존 ──────────────────────────────────────────────────────────────────────

export type RetentionAction = 'keep' | 'notify' | 'delete'

/**
 * 보존 판정. 쿼리(`listRetentionCandidates`)가 같은 조건을 SQL로 쓴다 — 둘을 함께 고친다.
 *  - 알린 적이 없고 마지막으로 연 지 365일이 지났으면 → notify
 *  - 알렸고, 알린 지 30일이 지났고, 그 뒤로 열지 않았으면(`lastOpenedAt ≤ deletionNotifiedAt`) → delete
 *  - 그 밖 → keep (알린 뒤 열면 열 때 알림 시각을 지우므로 다시 365일부터 센다)
 */
export function retentionActionOf(
  doc: { lastOpenedAt: Date | number; deletionNotifiedAt: Date | number | null },
  now: Date | number
): RetentionAction {
  const opened = toMs(doc.lastOpenedAt)
  const notified = doc.deletionNotifiedAt === null ? null : toMs(doc.deletionNotifiedAt)
  const t = toMs(now)
  if (opened === null || t === null) return 'keep'
  if (notified === null) return t - opened >= MEMBER_DOCUMENT_IDLE_MS ? 'notify' : 'keep'
  if (opened > notified) return 'keep'
  return t - notified >= MEMBER_DOCUMENT_GRACE_MS ? 'delete' : 'keep'
}

/** 알림을 받은 문서가 지워질 날(알린 때 + 30일) */
export function deletionDueAt(notifiedAt: Date | number): Date {
  return new Date((toMs(notifiedAt) ?? 0) + MEMBER_DOCUMENT_GRACE_MS)
}

function toMs(v: Date | number | null | undefined): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ── 이름 ──────────────────────────────────────────────────────────────────────

/**
 * 이름 바꾸기 — 확장자는 바꾸지 못한다(미리보기·편집기가 확장자로 형식을 고른다). 입력에 같은 확장자를 붙였으면 떼고,
 * 경로 문자·제어문자·방향 제어 문자를 지운 뒤 원래 확장자를 붙인다. 이름이 비면 null.
 */
export function normalizeRename(raw: unknown, currentName: string): string | null {
  if (typeof raw !== 'string') return null
  const ext = memberDocumentExtension(currentName)
  let base = cleanName(raw)
  if (ext && base.toLowerCase().endsWith(`.${ext}`)) base = base.slice(0, -(ext.length + 1))
  base = base.replace(/^\.+/, '').trim()
  if (!/[^.\s]/.test(base)) return null
  const max = MEMBER_DOCUMENT_NAME_MAX - (ext ? ext.length + 1 : 0)
  base = base.slice(0, Math.max(1, max)).trim()
  if (!base) return null
  return ext ? `${base}.${ext}` : base
}

/** 새 문서 이름(확장자 고정). 비면 null */
export function normalizeNewDocumentName(raw: unknown, ext: string): string | null {
  if (typeof raw !== 'string') return null
  let base = cleanName(raw).replace(/\.(docx?|xlsx?|pptx?|hwpx?)$/i, '')
  base = base.replace(/^\.+/, '').trim()
  if (!/[^.\s]/.test(base)) return null
  base = base.slice(0, MEMBER_DOCUMENT_NAME_MAX - ext.length - 1).trim()
  return base ? `${base}.${ext}` : null
}

function cleanName(raw: string): string {
  let out = ''
  for (const ch of raw.normalize('NFC')) {
    const c = ch.codePointAt(0) as number
    const control = c <= 0x1f || c === 0x7f
    const bidi = c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e)
    if (!control && !bidi) out += ch
  }
  return out.replace(/[\\/]+/g, '_').trim()
}

// ── 새 문서 ───────────────────────────────────────────────────────────────────

/** 문서함에서 만들 수 있는 새 문서 — 업무툴과 같은 정적 빈 서식(public/doc-templates) */
export const MEMBER_NEW_DOCUMENT_TYPES = [
  { type: 'docx', label: 'Word 문서', defaultName: '새 문서' },
  { type: 'xlsx', label: 'Excel 통합 문서', defaultName: '새 통합 문서' },
  { type: 'pptx', label: 'PowerPoint 프레젠테이션', defaultName: '새 프레젠테이션' },
  { type: 'hwpx', label: '한글 문서(HWPX)', defaultName: '새 한글 문서' },
] as const
export type MemberNewDocumentType = (typeof MEMBER_NEW_DOCUMENT_TYPES)[number]['type']

export function isMemberNewDocumentType(v: unknown): v is MemberNewDocumentType {
  return MEMBER_NEW_DOCUMENT_TYPES.some(t => t.type === v)
}

export function newDocumentTemplatePath(type: MemberNewDocumentType): string {
  return `/doc-templates/blank.${type}`
}

/**
 * 새 버전의 문서 이름 — 문서 이름의 본체는 그대로 두고 확장자만 새 파일 것으로(옛 형식을 편집기로 저장하면 doc → docx).
 * 새 파일에 확장자가 없으면 문서 이름 그대로.
 */
export function renameWithExtension(documentName: string, fileName: string): string {
  const ext = memberDocumentExtension(fileName)
  if (!ext) return documentName
  const cur = memberDocumentExtension(documentName)
  const base = cur ? documentName.slice(0, -(cur.length + 1)) : documentName
  return `${base}.${ext}`
}

/** 같은 문서로 받을 수 있는 확장자인가 — 같거나 옛/새 형식 짝(hwp·hwpx, doc·docx, xls·xlsx, ppt·pptx) */
export function isCompatibleVersionFile(documentName: string, fileName: string): boolean {
  const a = memberDocumentExtension(documentName)
  const b = memberDocumentExtension(fileName)
  if (!a || !b) return a === b
  if (a === b) return true
  const pairs = [
    ['hwp', 'hwpx'],
    ['doc', 'docx'],
    ['xls', 'xlsx'],
    ['ppt', 'pptx'],
  ]
  return pairs.some(p => p.includes(a) && p.includes(b))
}
