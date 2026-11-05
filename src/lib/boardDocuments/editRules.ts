/**
 * 이사회 서류 앱 편집의 순수 규칙 — 누가 고치는가·버전 번호·웹 본문·저장 이름(docs/board-work/05-이사회-서류-앱-편집.md).
 *
 * **로컬 import가 하나도 없어야 한다** — `node --test`가 이 파일을 직접 읽는다(memberDocuments/rules.ts와 같은 이유).
 * 라우트·서비스·화면이 같은 판정을 쓴다. 실제 차단은 라우트가 한다.
 */

/** 버전이 생긴 경로. v1(처음 올린 파일)은 늘 'upload'다 */
export const BOARD_DOCUMENT_VERSION_SOURCES = [
  'upload',
  'office-editor',
  'hwp-editor',
  'revert',
] as const
export type BoardDocumentVersionSource = (typeof BOARD_DOCUMENT_VERSION_SOURCES)[number]

export function isBoardDocumentVersionSource(v: unknown): v is BoardDocumentVersionSource {
  return (BOARD_DOCUMENT_VERSION_SOURCES as readonly unknown[]).includes(v)
}

/** 화면의 버전 줄에 쓰는 이름 */
export const BOARD_DOCUMENT_SOURCE_LABEL: Record<BoardDocumentVersionSource, string> = {
  upload: '올린 파일',
  'office-editor': '오피스 편집기',
  'hwp-editor': '한글 편집기',
  revert: '되돌리기',
}

// ── 권한 ──────────────────────────────────────────────────────────────────────

/**
 * 고칠 수 있는가 — **지울 수 있는 사람과 같다**: 서류를 올린 사람 또는 관리자(기존 DELETE 라우트의
 * `doc.uploaded_by !== user.id && !isAdmin`의 반대). 이 판정은 `requireBoardMember()`(이사·감사·관리자)를 지난 사람에게만
 * 쓴다 — 조합원(열람 게이트로만 들어오는 사람)은 그 앞에서 403 이다. 올린 사람이 없는 시드 서류는 관리자만 고친다.
 */
export function canEditBoardDocument(input: {
  uploadedBy: string | null | undefined
  userId: string
  isAdmin: boolean
}): boolean {
  if (input.isAdmin === true) return true
  if (typeof input.userId !== 'string' || input.userId.length === 0) return false
  return typeof input.uploadedBy === 'string' && input.uploadedBy === input.userId
}

/** 이사·감사·관리자가 볼 수 있는 자료 등급(`visibilityScopeFor(true)`와 같다). 그 밖의 값은 없는 서류로 본다 */
const BOARD_VISIBLE = ['board', 'members']

export type BoardDocumentEditAccess = 'ok' | 'not_found' | 'forbidden'

/**
 * 편집 라우트의 판정(게이트 `requireBoardMember()` **다음**): 서류가 없거나 이사회에도 보이지 않는 등급이면 404(존재를
 * 알리지 않는다), 있는데 고칠 수 없으면 403, 아니면 ok. 404 가 403 보다 먼저다.
 */
export function boardDocumentEditAccess(
  doc: { uploadedBy: string | null; visibility: string } | null | undefined,
  userId: string,
  isAdmin: boolean
): BoardDocumentEditAccess {
  if (!doc) return 'not_found'
  if (!BOARD_VISIBLE.includes(doc.visibility)) return 'not_found'
  return canEditBoardDocument({ uploadedBy: doc.uploadedBy, userId, isAdmin }) ? 'ok' : 'forbidden'
}

// ── 버전 번호 ─────────────────────────────────────────────────────────────────

/**
 * 한 번도 고치지 않은 서류에는 버전 행이 없다(backfill 없음) — 그때 지금 파일이 v1 이다. 처음 저장하면 그 파일을 v1 행으로
 * 옮기고(`needsInitialVersion`) 새 파일이 v2 가 된다. `recordedLatestNo`는 버전 행의 가장 큰 번호(없으면 null).
 */
export function planNextVersion(recordedLatestNo: number | null): {
  needsInitialVersion: boolean
  latestNo: number
  nextNo: number
} {
  const n = Number(recordedLatestNo)
  if (recordedLatestNo === null || !Number.isInteger(n) || n < 1) {
    return { needsInitialVersion: true, latestNo: 1, nextNo: 2 }
  }
  return { needsInitialVersion: false, latestNo: n, nextNo: n + 1 }
}

/**
 * 편집기를 연 뒤 다른 사람(다른 탭)이 먼저 저장했는가. `baseVersionNo`가 null 이면(편집기가 기준을 모를 때) 막지 않는다.
 * 지금 최신과 다르면 409 — 남의 저장을 덮지 않는다.
 */
export function isStaleBase(baseVersionNo: number | null | undefined, latestNo: number): boolean {
  if (baseVersionNo === null || baseVersionNo === undefined) return false
  return baseVersionNo !== latestNo
}

// ── 웹 본문(body_markdown) ────────────────────────────────────────────────────

/** 웹 본문이 있는가(빈 문자열·공백만은 없는 것) — 목록의 `has_body`와 같은 생각 */
export function hasWebBody(body: string | null | undefined): body is string {
  return typeof body === 'string' && body.trim().length > 0
}

export type BodyPlan =
  /** 본문이 없던 서류 — 그대로 NULL */
  | { kind: 'none' }
  /** 새 파일에서 kordoc 마크다운으로 다시 만든다(실패하면 지금 본문을 그대로 둔다) */
  | { kind: 'regenerate' }
  /** 이 본문으로 바꾼다(되돌리기 — 그 버전이 최신이던 때의 본문) */
  | { kind: 'snapshot'; value: string }

/**
 * 편집기 저장 뒤의 웹 본문. 본문이 있던 서류(정관·총회 자료처럼 사무국이 웹 본문을 둔 것)만 새 파일에서 다시 만든다 —
 * 없던 서류에 본문을 새로 만들지 않는다(목록에서 링크가 되는 등 화면이 바뀐다). 이전 본문은 이전 버전 행에 남는다.
 */
export function bodyPlanAfterSave(currentBody: string | null | undefined): BodyPlan {
  return hasWebBody(currentBody) ? { kind: 'regenerate' } : { kind: 'none' }
}

/**
 * 되돌리기 뒤의 웹 본문. 고른 버전에 본문 기록이 있으면 그것으로(그 버전이 최신이던 때의 본문이 돌아온다). 기록이 없는데
 * 지금 서류에 본문이 있으면(버전이 생긴 뒤 사무국이 본문을 붙인 경우) 되돌린 파일에서 다시 만든다 — 본문을 지우지 않는다.
 * 둘 다 없으면 NULL.
 */
export function bodyPlanAfterRevert(
  snapshot: string | null | undefined,
  currentBody: string | null | undefined
): BodyPlan {
  if (hasWebBody(snapshot)) return { kind: 'snapshot', value: snapshot }
  return hasWebBody(currentBody) ? { kind: 'regenerate' } : { kind: 'none' }
}

// ── 파일 이름 ─────────────────────────────────────────────────────────────────

/** 확장자(점 없이 소문자). 없으면 '' */
export function fileExtensionOf(name: string): string {
  if (typeof name !== 'string') return ''
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

/** 앱 편집 저장본의 확장자 짝: 같거나, 오피스 옛 형식 → OOXML(편집기가 doc 을 docx 로 저장한다) */
const SAVE_EXTENSION: Record<string, readonly string[]> = {
  docx: ['docx'],
  xlsx: ['xlsx'],
  pptx: ['pptx'],
  doc: ['doc', 'docx'],
  xls: ['xls', 'xlsx'],
  ppt: ['ppt', 'pptx'],
  hwp: ['hwp'],
  hwpx: ['hwpx'],
}

/** 이 서류의 저장본으로 받을 수 있는 이름인가(확장자 기준). 앱 편집 대상이 아닌 형식이면 거짓 */
export function isCompatibleSavedName(currentName: string, savedName: string): boolean {
  const allowed = SAVE_EXTENSION[fileExtensionOf(currentName)]
  return Boolean(allowed && allowed.includes(fileExtensionOf(savedName)))
}

/** 편집기 종류 → 버전 경로. 앱 편집 대상이 아니면 null */
export function editorSourceFor(name: string): BoardDocumentVersionSource | null {
  const ext = fileExtensionOf(name)
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp-editor'
  if (ext in SAVE_EXTENSION) return 'office-editor'
  return null
}

/**
 * 새 버전의 표시 이름 — 지금 이름의 본체는 그대로 두고 확장자만 저장본 것으로(doc → docx). 저장본에 확장자가 없으면
 * 지금 이름 그대로. 서류의 제목(`title`)은 바꾸지 않는다.
 */
export function savedDisplayName(currentName: string, savedName: string): string {
  const ext = fileExtensionOf(savedName)
  if (!ext) return currentName
  const cur = fileExtensionOf(currentName)
  const base = cur ? currentName.slice(0, -(cur.length + 1)) : currentName
  return `${base}.${ext}`
}
