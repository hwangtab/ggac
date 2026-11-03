import {
  BOARD_WORK_PREFIX,
  boardWorkFilePath,
  boardWorkThumbPath,
  isSafeBoardWorkPath,
} from '@/lib/storage/boardWork'

/**
 * 객체 경로 규약(ggac 이식 — 설계 §7-1): `board-work/files/<uploadId>/<ASCII 안전 이름>`.
 * 이미지 썸네일: <원본 경로>.thumb.webp
 */

const MAX_BASE_LENGTH = 100

/** 표시용 이름: 경로 구분자·제어문자만 제거하고 한글·공백은 유지한다(최대 255자). */
export function displayFileName(raw: string): string {
  const cleaned = stripInvisible(raw.normalize('NFC'))
    .replace(/[\\/]+/g, '_')
    .trim()
  const name = cleaned.replace(/^\.+/, '') || 'file'
  return truncateKeepingExt(name, 255)
}

/** 제어문자와 방향 제어 문자(RLO 등 파일명 위장에 쓰인다)를 제거한다. */
function stripInvisible(input: string): string {
  let out = ''
  for (const ch of input) {
    const c = ch.codePointAt(0)!
    const control = c <= 0x1f || c === 0x7f
    const bidi = c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e)
    if (!control && !bidi) out += ch
  }
  return out
}

function splitExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || name.length - dot > 16) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

function truncateKeepingExt(name: string, max: number): string {
  if (name.length <= max) return name
  const { base, ext } = splitExt(name)
  return base.slice(0, Math.max(1, max - ext.length)) + ext
}

/**
 * Storage 키용 안전 이름. **ASCII만** 남긴다 — 영문·숫자와 `.` `_` `-` `(` `)`. 한글 등 나머지는 `_`.
 * (운영 실측 2026-10-22: 한글이 든 키로 서명 업로드하면 Storage 가 400 을 돌려준다. 원래 파일명은
 * attachments.name 에 그대로 보존하므로 키는 ASCII 여도 사용자에게는 원래 이름이 보인다.)
 * 경로 구분자·`..`·선행 점을 제거하고 길이를 제한하며 확장자는 보존한다. 본체가 비면 `file`.
 */
export function sanitizeFileName(raw: string): string {
  const display = displayFileName(raw)
  const dot = display.lastIndexOf('.')
  const rawBase = dot > 0 ? display.slice(0, dot) : display
  const rawExt = dot > 0 ? display.slice(dot + 1) : ''
  const clean = (v: string) =>
    v
      .replace(/[^A-Za-z0-9._\-()]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/_{2,}/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
  const cleanedBase = clean(rawBase)
  const base = /[A-Za-z0-9]/.test(cleanedBase) ? cleanedBase : 'file'
  const ext = clean(rawExt).replace(/\./g, '')
  const safe = ext ? `${base}.${ext}` : base
  return truncateKeepingExt(safe, MAX_BASE_LENGTH)
}

/**
 * ggac 이식: 업로드 객체 키 — `board-work/files/<uploadId>/<ASCII 안전 이름>`(설계 §7-1).
 * 원본은 `channels/<channel>/pending/…`에 올린 뒤 승격 때 `channels/<channel>/<message>/…`로 옮겼다. 여기서는 처음부터
 * 최종 키에 올리고 승격은 DB 행만 바꾼다(Blob에는 이동이 없고 copy+delete는 객체를 두 번 쓴다 — §7-5).
 */
export function buildUploadPath(uploadId: string, name: string): string {
  return boardWorkFilePath(uploadId, sanitizeFileName(name))
}

export function thumbPathOf(blobPath: string): string {
  return boardWorkThumbPath(blobPath)
}

/**
 * 읽기·서명 전에 첨부 행의 blob_path 가 업무툴 파일 키 모양인지 확인한다(원본 isSafeAttachmentPath — 2중 방어).
 * 규칙은 import 없는 순수 검사 `isSafeBoardWorkPath`(src/lib/storage/boardWork.ts) 하나다 — 비공개 저장소의
 * `backups/`·`mailbox/` 같은 다른 영역을 가리키는 행은 저장소 호출 전에 거른다.
 */
export function isSafeAttachmentPath(blobPath: string): boolean {
  return isSafeBoardWorkPath(blobPath) && blobPath.startsWith(`${BOARD_WORK_PREFIX}files/`)
}
