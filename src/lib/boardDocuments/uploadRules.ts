import { BOARD_DOCUMENT_PREFIX, isSafeBoardDocumentFilePath } from '../storage/boardDocuments.ts'
import {
  ALL_DOCUMENT_CATEGORIES,
  canSetDocumentVisibility,
  isDocumentVisibility,
  type DocumentVisibility,
} from '../../constants/boardRoom.ts'

/**
 * 이사회 서류 올리기(서류함·정기총회·자료실 '이사회 서류')의 순수 규칙 — 서버 라우트와 브라우저가 같은 판정을 쓴다.
 *
 * 예전에는 파일을 multipart 로 `/api/board-room/documents` 함수에 그대로 보냈는데, Vercel 함수는 요청 본문 4.5MB 를
 * 넘으면 플랫폼이 413(JSON 아님)으로 끊는다 — 화면은 "최대 50MB"라고 약속하면서 스캔한 회의록이 대부분 실패했다.
 * 이제 브라우저가 비공개 Blob 저장소에 **직접** 올리고(`/api/board-room/documents/uploads` — 준비·토큰), 함수에는
 * 경로만 담은 JSON 으로 등록한다(`/api/board-room/documents` JSON 분기). 앱 편집 저장본 업로드(`editUploads.ts`)와
 * 같은 모양이다.
 *
 * **kordoc 을 부르는 모듈을 import 하지 않는다**(업로드 라우트 번들이 250MB 를 넘지 않게 — boardDocumentEditBundle 시험).
 * 로컬 import 는 확장자를 붙인 상대 경로만 쓴다 — `node --test`가 이 파일을 직접 읽는다.
 * 권한을 판단하지 않는다(게이트는 라우트의 `requireBoardMember()`). 여기서는 "자기 폴더인가·형식·크기"만 본다.
 */

export type UploadRuleResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

function fail<T>(status: number, error: string): UploadRuleResult<T> {
  return { ok: false, status, error }
}

/** 파일 한 개 상한 — 화면·서버가 약속하는 "최대 50MB" */
export const BOARD_DOCUMENT_MAX_FILE_SIZE = 50 * 1024 * 1024

/** 이보다 크면 `upload()`를 여러 조각(multipart)으로 보낸다 — 앱 편집 저장본과 같은 기준 */
export const BOARD_DOCUMENT_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024

/** 올릴 수 있는 형식(MIME) — 예전 multipart 라우트의 `ALLOWED_MIME_TYPES`와 같다 */
export const BOARD_DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/haansofthwp',
  'application/x-hwp',
  'text/plain',
] as const

export const BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE =
  '지원하지 않는 파일 형식입니다. 허용 형식: PDF, 이미지, Word, Excel, 한글(HWP), 텍스트'
export const BOARD_DOCUMENT_TOO_LARGE_MESSAGE = '파일 크기는 최대 50MB입니다.'

/** 확장자 → 그 확장자로 올 수 있는 형식. 토큰 단계는 경로의 파일 이름 확장자가 여기 있을 때만 토큰을 준다 */
const EXTENSION_MIME: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  hwp: ['application/haansofthwp', 'application/x-hwp'],
  txt: ['text/plain'],
}

/** 형식 → 저장 키에 붙일 대표 확장자(원래 이름에 맞는 확장자가 없을 때) */
const CANONICAL_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/haansofthwp': 'hwp',
  'application/x-hwp': 'hwp',
  'text/plain': 'txt',
}

/** `text/plain; charset=utf-8` → `text/plain` */
export function normalizeMime(mime: unknown): string {
  if (typeof mime !== 'string') return ''
  return mime.split(';')[0].trim().toLowerCase()
}

export function isAllowedBoardDocumentMime(mime: unknown): boolean {
  return (BOARD_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(normalizeMime(mime))
}

export function extensionOf(name: unknown): string {
  if (typeof name !== 'string') return ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isAllowedBoardDocumentExtension(name: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(EXTENSION_MIME, extensionOf(name))
}

/**
 * 브라우저가 알려 준 형식. 빈 값이면(HWP 를 모르는 브라우저가 많다) 확장자로 추정한다 — 추정한 형식도 허용 목록 안이어야
 * 하고, 등록 단계가 파일 앞머리 서명을 다시 본다.
 */
export function resolveBoardDocumentMime(name: string, browserMime: string): string {
  const declared = normalizeMime(browserMime)
  if (declared) return declared
  return EXTENSION_MIME[extensionOf(name)]?.[0] ?? ''
}

/** 경로 구분자·특수 문자를 걷어 낸다. 영문·숫자·한글·`.`·`_`·`-`만 남긴다(예전 multipart 라우트와 같다) */
export function sanitizeBoardDocumentFileName(name: string): string {
  // macOS 는 한글 파일 이름을 자모로 나눠(NFD) 넘긴다 — 합치지 않으면 한글이 전부 `_`가 된다
  const sanitized = String(name ?? '')
    .normalize('NFC')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._\-가-힣]/g, '_')
    .replace(/^\.+/, '')
  return sanitized || 'file'
}

/** 저장 이름 길이 상한(확장자 포함) — 경로 판정(512자)·Blob pathname 한도 안에 넉넉히 들게 */
const MAX_SAFE_NAME_LENGTH = 120

/**
 * 저장 키의 파일 이름 구간: 안전한 문자만, 길이를 줄이고, 확장자가 형식에 맞지 않으면 대표 확장자를 붙인다
 * (토큰 단계가 확장자를 보기 때문이다 — 화면에 보이는 이름(`file_name`)은 원래 이름 그대로다).
 */
export function storedBoardDocumentName(name: string, mime: string): string {
  let safe = sanitizeBoardDocumentFileName(name)
  const ext = extensionOf(safe)
  const fits = (EXTENSION_MIME[ext] ?? []).includes(normalizeMime(mime))
  if (!fits) {
    const canonical = CANONICAL_EXTENSION[normalizeMime(mime)] ?? 'bin'
    safe = `${safe}.${canonical}`
  }
  if (safe.length > MAX_SAFE_NAME_LENGTH) {
    const suffix = `.${extensionOf(safe)}`
    safe = safe.slice(0, MAX_SAFE_NAME_LENGTH - suffix.length) + suffix
  }
  return safe
}

/** 저장소 전체 pathname(`board-documents/<file_path>`) */
export function boardDocumentBlobPathname(filePath: string): string {
  return `${BOARD_DOCUMENT_PREFIX}/${filePath}`
}

export type BoardDocumentUploadTarget = {
  /** `board_documents.file_path`에 들어갈 값(`<사용자 id>/<시각>_<무작위>_<안전 이름>`) */
  filePath: string
  /** 저장소 pathname(`board-documents/<filePath>`) — `upload()`에 그대로 넘긴다 */
  pathname: string
  mime: string
  multipart: boolean
}

/**
 * ① 업로드 준비 — `{ type: 'prepare', name, size, mime }`. 크기·형식을 보고 **서버가 키를 정한다**:
 * `<사용자 id>/<Date.now()>_<무작위>_<안전 이름>`. 이 키는 `isSafeBoardDocumentFilePath`를 지나야 한다.
 * 저장소 설정 여부(503)는 라우트가 본다.
 */
export function prepareBoardDocumentUpload(
  userId: string,
  body: unknown,
  opts: { now: number; random: string }
): UploadRuleResult<BoardDocumentUploadTarget> {
  if (!body || typeof body !== 'object') return fail(400, '파일 정보가 올바르지 않습니다.')
  const { type, name, size, mime } = body as Record<string, unknown>
  if (type !== 'prepare') return fail(400, '잘못된 업로드 요청입니다.')
  if (typeof name !== 'string' || !name.trim() || name.length > 255) {
    return fail(400, '파일 정보가 올바르지 않습니다.')
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return fail(400, '파일 정보가 올바르지 않습니다.')
  }
  if (size > BOARD_DOCUMENT_MAX_FILE_SIZE) return fail(413, BOARD_DOCUMENT_TOO_LARGE_MESSAGE)
  const resolved = resolveBoardDocumentMime(name, typeof mime === 'string' ? mime : '')
  if (!isAllowedBoardDocumentMime(resolved)) {
    return fail(415, BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE)
  }
  if (!/^[A-Za-z0-9]{6,32}$/.test(opts.random)) return fail(500, '업로드를 준비하지 못했습니다.')
  const filePath = `${userId}/${opts.now}_${opts.random}_${storedBoardDocumentName(name.trim(), resolved)}`
  if (!isOwnBoardDocumentFilePath(userId, filePath)) {
    return fail(400, '파일 정보가 올바르지 않습니다.')
  }
  return {
    ok: true,
    data: {
      filePath,
      pathname: boardDocumentBlobPathname(filePath),
      mime: resolved,
      multipart: size > BOARD_DOCUMENT_MULTIPART_THRESHOLD_BYTES,
    },
  }
}

/**
 * 이 사용자의 업로드 폴더(`<사용자 id>/<파일>`)이고 봉쇄 판정을 지나는가. 다른 사람 폴더·`seed/`·앱 편집 버전
 * (`versions/…`)은 거짓이다. 사용자 id 는 정확히 같아야 한다(대소문자 포함 — 키는 서버가 `user.id`로 만든다).
 */
export function isOwnBoardDocumentFilePath(userId: unknown, filePath: unknown): filePath is string {
  if (typeof userId !== 'string' || !userId) return false
  if (typeof filePath !== 'string') return false
  if (!filePath.startsWith(`${userId}/`)) return false
  if (!isSafeBoardDocumentFilePath(filePath)) return false
  return filePath.split('/').length === 2
}

/**
 * ② 업로드 토큰 판정 — `upload()`가 보낸 pathname 이 `board-documents/<이 사용자 id>/<파일>`이고 봉쇄 판정을 지나며,
 * 파일 이름 확장자가 허용 형식일 때만. 토큰은 허용 형식 목록·50MB 까지(덮어쓰기·무작위 접미사 없이 — 라우트가 끈다).
 */
export function decideBoardDocumentUploadToken(
  userId: string,
  pathname: unknown
): UploadRuleResult<{ allowedContentTypes: string[]; maximumSizeInBytes: number }> {
  if (typeof pathname !== 'string') return fail(403, '업로드 경로가 일치하지 않습니다.')
  const prefix = `${BOARD_DOCUMENT_PREFIX}/`
  if (!pathname.startsWith(prefix)) return fail(403, '업로드 경로가 일치하지 않습니다.')
  const filePath = pathname.slice(prefix.length)
  if (!isOwnBoardDocumentFilePath(userId, filePath)) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  if (!isAllowedBoardDocumentExtension(filePath.split('/')[1])) {
    return fail(403, BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE)
  }
  return {
    ok: true,
    data: {
      allowedContentTypes: [...BOARD_DOCUMENT_ALLOWED_MIME_TYPES],
      maximumSizeInBytes: BOARD_DOCUMENT_MAX_FILE_SIZE,
    },
  }
}

export type BoardDocumentRegistration = {
  filePath: string
  fileName: string
  title: string
  category: string
  visibility: DocumentVisibility
}

/**
 * ③ 등록(JSON) 입력 판정 — `{ filePath, fileName, title, category, visibility }`. multipart 분기와 같은 순서·같은
 * 문구로 제목·분류·열람 범위(조합원 공개는 관리자만 — `canSetDocumentVisibility`)를 보고, 경로가 **자기 폴더**인지 본다.
 * 저장소 객체(있는가·크기·형식·서명)는 라우트가 이어서 본다.
 */
export function validateBoardDocumentRegistration(
  userId: string,
  isAdmin: boolean,
  body: unknown
): UploadRuleResult<BoardDocumentRegistration> {
  if (!body || typeof body !== 'object') return fail(400, '유효한 JSON body가 필요합니다.')
  const b = body as Record<string, unknown>
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  const category = typeof b.category === 'string' ? b.category : ''
  const visibility = b.visibility == null ? 'board' : String(b.visibility)
  if (!title) return fail(400, '제목을 입력해주세요.')
  if (!(ALL_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
    return fail(400, '잘못된 분류입니다.')
  }
  if (!isDocumentVisibility(visibility)) return fail(400, '잘못된 열람 범위입니다.')
  if (!canSetDocumentVisibility(visibility, isAdmin === true)) {
    return fail(
      403,
      '조합원 전체 공개(visibility=members)는 관리자만 설정할 수 있습니다. 기본값인 이사회 열람으로 올려주세요.'
    )
  }
  if (!isOwnBoardDocumentFilePath(userId, b.filePath)) {
    return fail(400, '업로드한 파일 경로가 올바르지 않습니다.')
  }
  const fileName = typeof b.fileName === 'string' ? b.fileName.trim() : ''
  if (!fileName || fileName.length > 255) return fail(400, '파일 이름이 올바르지 않습니다.')
  return {
    ok: true,
    data: { filePath: b.filePath as string, fileName, title, category, visibility },
  }
}

/** ④ 저장소 객체 메타 판정 — 크기 상한·허용 형식. 실패하면 라우트가 객체를 지우고 400 */
export function checkStoredBoardDocument(meta: {
  size: number
  contentType: string | null
}): UploadRuleResult<{ size: number; mime: string }> {
  if (!(meta.size > 0)) return fail(400, '빈 파일은 올릴 수 없습니다.')
  if (meta.size > BOARD_DOCUMENT_MAX_FILE_SIZE) return fail(400, BOARD_DOCUMENT_TOO_LARGE_MESSAGE)
  const mime = normalizeMime(meta.contentType)
  if (!isAllowedBoardDocumentMime(mime)) return fail(400, BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE)
  return { ok: true, data: { size: meta.size, mime } }
}

/** 브라우저에서 올리기 전에 거른다(서버가 같은 판정을 다시 한다). 문제가 없으면 null */
export function boardDocumentClientRejection(file: {
  name: string
  size: number
  type: string
}): string | null {
  if (file.size > BOARD_DOCUMENT_MAX_FILE_SIZE) return BOARD_DOCUMENT_TOO_LARGE_MESSAGE
  if (file.size < 1) return '빈 파일은 올릴 수 없습니다.'
  if (!isAllowedBoardDocumentMime(resolveBoardDocumentMime(file.name, file.type))) {
    return BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE
  }
  return null
}
