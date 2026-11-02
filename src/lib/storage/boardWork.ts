/**
 * 이사회 업무툴 파일(비공개 Blob)의 경로 봉쇄·HTTP 헤더 계산 — 순수 함수 모음. 설계 docs/board-work/01-설계.md §7.
 *
 * **로컬 import가 하나도 없어야 한다** — `node --test`가 이 파일을 직접 읽는다(boardDocuments.ts와 같은 이유).
 *
 * 이 파일의 봉쇄 판정은 보안 경계다. 업무툴 파일이 사는 비공개 Blob 저장소에는 조합 DB 전체 덤프(`backups/`)와
 * 메일 첨부(`mailbox/`)·이사회 서류(`board-documents/`)도 함께 있다. 업무툴의 읽기·삭제·업로드 토큰 발급은
 * **전부** 이 판정을 지난 경로만 다룬다. 판정을 느슨하게 만들지 말 것.
 */

/** 업무툴 객체가 사는 접두어 */
export const BOARD_WORK_PREFIX = 'board-work/'

const MAX_PATH_LENGTH = 512

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 파일 키의 마지막 구간: 서버가 만든 ASCII 안전 이름(+ 썸네일 접미사). 선행 점·`..`는 아래에서 따로 막는다 */
const SAFE_FILE_SEGMENT = /^[A-Za-z0-9_()-][A-Za-z0-9._()-]{0,199}$/

/** 렌더 캐시 이름: `<uuid>-<버전>[-layout[-p<n>[-big]]].{json,svg}` — 버전은 영문·숫자·점·하이픈 */
const RENDER_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}\.(json|svg)$/i

/**
 * 업무툴이 읽거나 지울 수 있는 경로인가. 허용하는 모양은 둘뿐이다.
 *   - `board-work/files/<uploadId uuid>/<ASCII 안전 이름>`        원본(`.thumb.webp` 썸네일 포함)
 *   - `board-work/renders/<attachmentId uuid>-<버전>….{json,svg}` 미리보기 캐시
 * 그 밖(`backups/…`·`mailbox/…`·`board-documents/…`·접두어 위장·상위 경로·인코딩 우회)은 전부 거짓이다.
 */
export function isSafeBoardWorkPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path || path.length > MAX_PATH_LENGTH) return false
  // 제어문자·널바이트·백슬래시·URL 구분자·퍼센트 인코딩은 어느 위치에도 허용하지 않는다(우리가 만드는 키에는 없다).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\?#%\s]/.test(path)) return false
  if (!path.startsWith(BOARD_WORK_PREFIX)) return false
  const segments = path.split('/')
  if (segments.some(s => s === '' || s === '.' || s === '..')) return false
  if (segments.length === 4 && segments[1] === 'files') {
    const [, , uploadId, file] = segments
    return UUID.test(uploadId) && SAFE_FILE_SEGMENT.test(file) && !file.includes('..')
  }
  if (segments.length === 3 && segments[1] === 'renders') {
    return RENDER_SEGMENT.test(segments[2]) && !segments[2].includes('..')
  }
  return false
}

/** 업로드 객체 키. `safeName`은 `sanitizeFileName`(src/work/lib/files/paths.ts)의 결과여야 한다 */
export function boardWorkFilePath(uploadId: string, safeName: string): string {
  return `${BOARD_WORK_PREFIX}files/${uploadId}/${safeName}`
}

/** 이미지 썸네일 키 — 원본 키 + `.thumb.webp`(원본 thumbPathOf) */
export function boardWorkThumbPath(blobPath: string): string {
  return `${blobPath}.thumb.webp`
}

/** 업로드 키의 uploadId 구간(규약 밖이면 null) */
export function uploadIdOfBoardWorkPath(path: string): string | null {
  if (!isSafeBoardWorkPath(path)) return null
  const segments = path.split('/')
  return segments[1] === 'files' ? segments[2].toLowerCase() : null
}

// ── Range ─────────────────────────────────────────────────────────────────────

/**
 * `Range` 요청 해석 결과(RFC 9110 §14). **단일 범위만** 받는다 — 여러 범위(`a-b,c-d`)는 multipart/byteranges를
 * 만들어야 해서 지원하지 않고, RFC가 허용하는 대로 무시(전체 200)한다.
 *   - none           Range가 없거나 무시할 모양 → 200 전체
 *   - range          [start, end] 포함 구간 → 206
 *   - unsatisfiable  시작이 크기 밖(또는 빈 파일) → 416 + `Content-Range: bytes * /<size>`
 */
export type ByteRange =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' }

export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (!header) return { kind: 'none' }
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)
  // 단위가 bytes가 아니거나 여러 범위·잘못된 모양 → 무시
  if (!m) return { kind: 'none' }
  const [, a, b] = m
  if (a === '' && b === '') return { kind: 'none' }
  if (!Number.isSafeInteger(size) || size < 0) return { kind: 'none' }
  if (a === '') {
    // 접미 범위(`bytes=-500`): 마지막 n바이트
    const n = Number(b)
    if (!Number.isSafeInteger(n)) return { kind: 'none' }
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(a)
  if (!Number.isSafeInteger(start)) return { kind: 'none' }
  if (b !== '') {
    const last = Number(b)
    if (!Number.isSafeInteger(last)) return { kind: 'none' }
    if (last < start) return { kind: 'none' } // 문법상 무효 → 무시
  }
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  return { kind: 'range', start, end }
}

/** 저장소에 넘길 정규화된 Range 헤더 값 */
export function rangeHeaderValue(range: { start: number; end: number }): string {
  return `bytes=${range.start}-${range.end}`
}

/** 206 응답의 `Content-Range` */
export function contentRangeValue(range: { start: number; end: number }, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`
}

/**
 * 저장소 응답의 `content-range`가 206(부분 응답)인가. `@vercel/blob` `get()`은 statusCode를 늘 200으로 주므로
 * 부분 응답 여부는 이 헤더로만 안다(설계 §7-5). `bytes a-b/total` 모양만 인정한다.
 */
export function parseContentRange(
  value: string | null | undefined
): { start: number; end: number; size: number | null } | null {
  if (!value) return null
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(value)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  const size = m[3] === '*' ? null : Number(m[3])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null
  return { start, end, size }
}

// ── Content-Disposition ──────────────────────────────────────────────────────

/**
 * RFC 6266 + RFC 5987 — 한글 파일명을 그대로 싣는 Content-Disposition(ASCII 대체 이름 포함).
 * 원본 kosmart-work `lib/files/mime.ts` contentDisposition과 같은 규칙이다. 따옴표·역슬래시·제어문자는
 * 대체 이름에서 `_`로 바꾸고, `filename*`은 `'()*`까지 퍼센트 인코딩한다(헤더 주입이 생길 수 없다).
 */
export function contentDispositionValue(kind: 'inline' | 'attachment', name: string): string {
  const safe = typeof name === 'string' && name ? name : 'file'
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
