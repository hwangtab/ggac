/**
 * 이사회 문서의 저장 경로와 다운로드 헤더를 계산하는 순수 함수 모음.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는
 * 타입 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다.
 *
 * 이 파일의 봉쇄 판정은 보안 경계다. 비공개 Blob 저장소에는 이사회 문서와 함께
 * 조합 DB 전체 덤프가 `backups/` 접두어로 들어 있다. 여기서 경로가 새면 회원
 * 명부·연락처가 통째로 노출된다. 판정을 느슨하게 만들지 말 것.
 */

/** 비공개 Blob 저장소에서 이사회 문서가 사는 접두어. */
export const BOARD_DOCUMENT_PREFIX = 'board-documents'

const MAX_FILE_PATH_LENGTH = 512

/**
 * 업로더 UUID 판정. `src/utils/validation.ts`의 `UUID_REGEX`와 같은 형태지만
 * 이 파일은 로컬 import가 0개여야 하므로(파일 상단 주석 참고) 정규식을 여기
 * 직접 둔다 — import 하나가 `node --test`의 타입 스트리핑 로드를 깨뜨린다.
 */
const UUID_SEGMENT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `<owner>/<filename>` 두 세그먼트만 허용한다. `owner`는 업로더 UUID이거나
 * 시드 문서의 `seed`다.
 *
 * 예전 `isSafeBoardDocumentStoragePath`는 여기에 더해 `file_path`가
 * `uploaded_by`로 시작할 것을 요구했다. 그 결합 때문에 `uploaded_by = NULL`인
 * 시드 문서 14건이 전부 막혀 다운로드가 두 달간 죽어 있었다. 소유권 검사는
 * 경로 문자열이 아니라 DB 행(`uploaded_by` 컬럼)이 할 일이므로 분리했다.
 * 여기서는 "저장소 밖으로 나가지 않는가"만 본다.
 *
 * 첫 세그먼트를 UUID 또는 리터럴 `seed`로 강제한다. `?`·`#`가 섞인 세그먼트
 * (`..?`, `..#` 등)는 세그먼트 개수만 보면 2개라 예전엔 통과했는데, 이 제약이
 * 그 부류를 전부 걸러낸다 — `..?`는 UUID도 `seed`도 아니다. `backups/...`
 * 같은 백업 영역 위장도 같은 이유로 걸러진다.
 */
export function isSafeBoardDocumentFilePath(filePath: unknown): boolean {
  if (typeof filePath !== 'string') return false
  if (!filePath || filePath.length > MAX_FILE_PATH_LENGTH) return false

  // 제어문자·널바이트는 어떤 위치에도 허용하지 않는다.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(filePath)) return false

  // 백슬래시는 세그먼트 구분자로 해석될 여지를 남기므로 통째로 거부한다.
  if (filePath.includes('\\')) return false

  // 절대 경로와 프로토콜 상대 경로.
  if (filePath.startsWith('/')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath)) return false

  // `?`·`#`는 URL 파서가 경로를 끊는 지점이다. `@vercel/blob`의
  // `constructBlobUrl`이 인코딩 없이 문자열을 보간하므로, 이 문자가 섞이면
  // 문자열 수준 검사를 통과한 값이 URL 수준에서 다른 경로로 해석될 수 있다.
  // 아래 첫 세그먼트 UUID/seed 강제만으로도 실제 이탈은 막히지만, 방어적으로
  // 어떤 위치에서도 통째로 거부한다.
  if (filePath.includes('?') || filePath.includes('#')) return false

  // 퍼센트 인코딩을 통한 이탈. 디코딩이 실패하면(잘린 %) 그것도 거부한다.
  let decoded: string
  try {
    decoded = decodeURIComponent(filePath)
  } catch {
    return false
  }
  if (decoded !== filePath) {
    // 인코딩된 형태를 받아들이지 않는다. 저장 시 우리가 쓰는 값은 항상 평문이다.
    return false
  }

  const segments = filePath.split('/')
  for (const segment of segments) {
    if (!segment) return false
    if (segment === '.' || segment === '..') return false
  }

  // 앱 편집이 만든 버전 파일(docs/board-work/05-이사회-서류-앱-편집.md §3) — 모양이 다르므로 따로 본다.
  if (segments[0] === BOARD_DOCUMENT_VERSIONS_SEGMENT) return isVersionShape(segments)

  if (segments.length !== 2) return false
  const [owner] = segments
  if (owner !== 'seed' && !UUID_SEGMENT_REGEX.test(owner)) return false

  return true
}

/**
 * 앱 편집 버전 파일의 첫 구간. 업로더 UUID·`seed`와 겹치지 않는 리터럴이다 — 예전 2구간 모양
 * (`<owner>/<file>`)으로는 이 접두가 통과하지 못한다(`versions`는 UUID도 `seed`도 아니다).
 */
export const BOARD_DOCUMENT_VERSIONS_SEGMENT = 'versions'

/**
 * 버전 파일 이름 구간: 서버가 만든 ASCII 안전 이름(`sanitizeFileName` — src/work/lib/files/paths.ts)만.
 * 내 문서함 판정(`isSafeMemberDocumentPath`)과 같은 모양이다. 선행 점·`..`은 따로 막는다.
 */
const SAFE_VERSION_FILE_SEGMENT = /^[A-Za-z0-9_()-][A-Za-z0-9._()-]{0,199}$/

function isVersionShape(segments: string[]): boolean {
  if (segments.length !== 4) return false
  const [, documentId, versionId, file] = segments
  return (
    UUID_SEGMENT_REGEX.test(documentId) &&
    UUID_SEGMENT_REGEX.test(versionId) &&
    SAFE_VERSION_FILE_SEGMENT.test(file) &&
    !file.includes('..') &&
    // 퍼센트·공백은 위 정규식이 이미 막지만, 판정이 느슨해질 때를 대비해 한 번 더 못박는다
    !/[%\s]/.test(file)
  )
}

/**
 * 앱 편집이 만든 버전 파일 경로인가: `versions/<서류 uuid>/<버전 uuid>/<ASCII 안전 이름>`.
 * `isSafeBoardDocumentFilePath`의 앞 단계(제어문자·인코딩·`?#`·절대 경로 거부)를 모두 지난 뒤에만 참이다.
 */
export function isSafeBoardDocumentVersionPath(filePath: unknown): filePath is string {
  if (!isSafeBoardDocumentFilePath(filePath)) return false
  return (filePath as string).split('/')[0] === BOARD_DOCUMENT_VERSIONS_SEGMENT
}

/**
 * 이 서류(`documentId`)의 버전 파일 경로인가(대소문자 무시) — 남의 서류 id 구간을 가진 경로로 승격·되돌리기를
 * 하지 못하게 한 번 더 본다. 업로드 토큰 발급·승격·삭제가 이 판정을 지난 경로만 다룬다.
 */
export function isBoardDocumentVersionPathOf(
  filePath: unknown,
  documentId: unknown
): filePath is string {
  if (!isSafeBoardDocumentVersionPath(filePath)) return false
  if (typeof documentId !== 'string' || !UUID_SEGMENT_REGEX.test(documentId)) return false
  return filePath.split('/')[1].toLowerCase() === documentId.toLowerCase()
}

/**
 * 버전 파일 경로(`file_path` 칸에 들어가는 값 — 저장소 접두 `board-documents/`는 붙이지 않는다). 규약 밖 입력이면 null.
 * `safeName`은 `sanitizeFileName`의 결과여야 한다.
 */
export function boardDocumentVersionFilePath(
  documentId: string,
  versionId: string,
  safeName: string
): string | null {
  const path = `${BOARD_DOCUMENT_VERSIONS_SEGMENT}/${documentId}/${versionId}/${safeName}`
  return isBoardDocumentVersionPathOf(path, documentId) ? path : null
}

/** 저장소 전체 pathname(`board-documents/…`)이 이 서류의 버전 파일인가 — 브라우저 직접 업로드 토큰의 경로 판정 */
export function isBoardDocumentVersionBlobPathOf(pathname: unknown, documentId: unknown): boolean {
  if (typeof pathname !== 'string') return false
  const prefix = `${BOARD_DOCUMENT_PREFIX}/`
  if (!pathname.startsWith(prefix)) return false
  return isBoardDocumentVersionPathOf(pathname.slice(prefix.length), documentId)
}

/**
 * 저장소 전체 pathname이 서류 영역(`board-documents/<안전한 file_path>`)인가 — 서류 저장소 계층
 * (`createGuardedPrivateStore`)의 판정. 같은 저장소의 `backups/`·`mailbox/`·`board-work/`·`member-documents/`는 거짓이다.
 */
export function isSafeBoardDocumentBlobPath(pathname: unknown): boolean {
  if (typeof pathname !== 'string') return false
  const prefix = `${BOARD_DOCUMENT_PREFIX}/`
  if (!pathname.startsWith(prefix)) return false
  return isSafeBoardDocumentFilePath(pathname.slice(prefix.length))
}

/** 이 서류의 버전 파일이 사는 저장소 접두(`board-documents/versions/<서류 id>/`) — 삭제 때 남은 객체를 나열한다 */
export function boardDocumentVersionsBlobPrefix(documentId: string): string | null {
  if (typeof documentId !== 'string' || !UUID_SEGMENT_REGEX.test(documentId)) return null
  return `${BOARD_DOCUMENT_PREFIX}/${BOARD_DOCUMENT_VERSIONS_SEGMENT}/${documentId.toLowerCase()}/`
}

function assertSafe(filePath: unknown): string {
  if (!isSafeBoardDocumentFilePath(filePath)) {
    throw new Error(`안전하지 않은 이사회 문서 경로입니다: ${String(filePath)}`)
  }
  return filePath as string
}

/** 비공개 Blob 저장소에서의 전체 pathname. */
export function blobPathForBoardDocument(filePath: unknown): string {
  return `${BOARD_DOCUMENT_PREFIX}/${assertSafe(filePath)}`
}

/**
 * 다운로드 응답의 Content-Disposition을 만든다.
 *
 * 파일명은 조합원이 올린 원본 이름이라 한글·따옴표·개행이 들어올 수 있다.
 * 개행이 그대로 나가면 응답 헤더를 추가로 심을 수 있으므로(헤더 인젝션),
 * ASCII 폴백에서는 위험한 문자를 걷어내고 RFC 5987 `filename*`에
 * 퍼센트 인코딩된 원본을 함께 싣는다.
 */
export function contentDispositionAttachment(fileName: unknown): string {
  const raw = typeof fileName === 'string' ? fileName.trim() : ''
  const safeName = raw || 'download'

  // ASCII 폴백: 인쇄 가능한 ASCII만 남기고 따옴표·역슬래시는 제거한다.
  // eslint-disable-next-line no-control-regex
  const ascii = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  const asciiFallback = ascii.trim() || 'download'

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}
