/**
 * 조합원 '내 문서함' 파일(비공개 Blob)의 경로 봉쇄 — 순수 함수. 설계 docs/board-work/04-조합원-문서함.md §3-1.
 *
 * **로컬 import가 하나도 없어야 한다** — `node --test`가 이 파일을 직접 읽는다(boardWork.ts·boardDocuments.ts와 같은 이유).
 *
 * 이 판정은 보안 경계다. 문서함 객체가 사는 비공개 저장소에는 조합 DB 전체 덤프(`backups/`)·메일 첨부(`mailbox/`)·
 * 이사회 서류(`board-documents/`)·이사회 업무툴(`board-work/`)이 함께 있다. 문서함의 읽기·쓰기·삭제·복사·업로드 토큰은
 * **전부** 이 판정을 지난 경로만 다룬다. 판정을 느슨하게 만들지 말 것.
 */

/** 문서함 객체가 사는 접두어 */
export const MEMBER_DOCUMENTS_PREFIX = 'member-documents/'

const MAX_PATH_LENGTH = 512

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 파일 키의 마지막 구간: 서버가 만든 ASCII 안전 이름(`sanitizeFileName`). 선행 점·`..`는 따로 막는다 */
const SAFE_FILE_SEGMENT = /^[A-Za-z0-9_()-][A-Za-z0-9._()-]{0,199}$/

/**
 * 문서함이 다룰 수 있는 경로인가. 허용하는 모양은 하나뿐이다:
 *   `member-documents/<소유자 uuid>/<업로드·버전 uuid>/<ASCII 안전 이름>`
 * 그 밖(`backups/…`·`mailbox/…`·`board-work/…`·접두어 위장·상위 경로·인코딩 우회·구간 수가 다른 것)은 전부 거짓이다.
 */
export function isSafeMemberDocumentPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path || path.length > MAX_PATH_LENGTH) return false
  // 제어문자·널바이트·백슬래시·URL 구분자·퍼센트 인코딩·공백은 어느 위치에도 허용하지 않는다(우리가 만드는 키에는 없다)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\?#%\s]/.test(path)) return false
  if (!path.startsWith(MEMBER_DOCUMENTS_PREFIX)) return false
  const segments = path.split('/')
  if (segments.length !== 4) return false
  if (segments.some(s => s === '' || s === '.' || s === '..')) return false
  const [, ownerId, uploadId, file] = segments
  return (
    UUID.test(ownerId) &&
    UUID.test(uploadId) &&
    SAFE_FILE_SEGMENT.test(file) &&
    !file.includes('..')
  )
}

/** 이 경로가 안전하고, 소유자 구간이 `ownerId`인가(대소문자 무시) — 남의 문서함 키를 다루지 않게 한 번 더 본다 */
export function isMemberDocumentPathOf(path: unknown, ownerId: string): path is string {
  if (!isSafeMemberDocumentPath(path)) return false
  if (typeof ownerId !== 'string' || !UUID.test(ownerId)) return false
  return path.split('/')[1].toLowerCase() === ownerId.toLowerCase()
}

/**
 * 업로드 객체 키. `ownerId`·`uploadId`는 UUID, `safeName`은 `sanitizeFileName`(src/work/lib/files/paths.ts)의 결과여야 한다.
 * 결과가 판정을 지나지 못하면(규약 밖 입력) null.
 */
export function memberDocumentFilePath(
  ownerId: string,
  uploadId: string,
  safeName: string
): string | null {
  const path = `${MEMBER_DOCUMENTS_PREFIX}${ownerId}/${uploadId}/${safeName}`
  return isSafeMemberDocumentPath(path) ? path : null
}
