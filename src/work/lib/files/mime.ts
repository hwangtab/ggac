import type { FileKindFilter } from './schema'

/** mime·확장자 → 파일 종류. 아이콘 매핑·미리보기 가능 여부·자료실 필터가 모두 이 분류를 쓴다. */
export type FileKind =
  | 'image'
  | 'pdf'
  | 'word'
  | 'hwp'
  | 'text'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'video'
  | 'audio'
  | 'other'

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  hml: 'application/x-hwpml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  tsv: 'text/tab-separated-values',
  log: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  ini: 'text/plain',
  conf: 'text/plain',
  sql: 'application/sql',
  sh: 'application/x-sh',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  jsx: 'text/jsx',
  tsx: 'text/tsx',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 브라우저가 mime 을 비워 보내는 경우(HWP 등)를 확장자로 보정한다. */
export function resolveMime(mime: string | null | undefined, name: string): string {
  const m = (mime ?? '').trim().toLowerCase()
  if (m && m !== 'application/octet-stream') return m
  return EXT_MIME[extOf(name)] ?? 'application/octet-stream'
}

/**
 * 실제 MPEG-TS 동영상으로 보는 `.ts` — 브라우저가 TypeScript 소스에도 `video/mp2t` 를 주므로 확장자·mime 만으로는 못 가른다.
 * 크기로 가른다: 소스 파일이 TEXT_PREVIEW_MAX_BYTES(1MB)를 넘는 일은 거의 없으므로, 그보다 큰 `.ts` 는 동영상으로 본다.
 * mime 이 `video/mp2t`·빈 값·일반 바이너리일 때만(`text/typescript` 라고 밝힌 파일은 그대로 텍스트). 크기를 모르면 false.
 */
function isMpegTsVideo(mime: string, name: string, size: number | undefined): boolean {
  if (size === undefined || !(size > TEXT_PREVIEW_MAX_BYTES) || extOf(name) !== 'ts') return false
  const m = baseMime(mime)
  return m === '' || m === 'video/mp2t' || m === 'application/octet-stream'
}

/** `size` 는 선택 — 있으면 큰 `.ts`(MPEG-TS 동영상)를 가린다(isMpegTsVideo). 자료실 "미디어" 필터(mime video/*)와 같은 쪽이다 */
export function fileKindOf(mime: string, name: string, size?: number): FileKind {
  if (isMpegTsVideo(mime, name, size)) return 'video'
  const m = resolveMime(mime, name)
  const ext = extOf(name)
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (ext === 'hwp' || ext === 'hwpx' || ext === 'hml' || m.includes('hwp') || m.includes('hancom'))
    return 'hwp'
  if (
    m === 'application/msword' ||
    m.includes('wordprocessingml') ||
    ext === 'doc' ||
    ext === 'docx'
  )
    return 'word'
  if (m.includes('spreadsheet') || m === 'application/vnd.ms-excel' || ext === 'csv')
    return 'spreadsheet'
  if (m.includes('presentation') || m === 'application/vnd.ms-powerpoint') return 'presentation'
  if (
    m === 'application/zip' ||
    m.includes('x-zip') ||
    m.includes('x-7z') ||
    m.includes('x-rar') ||
    m.includes('x-tar') ||
    m === 'application/gzip' ||
    ['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)
  )
    return 'archive'
  if (TEXT_PREVIEW_EXT.has(ext)) return 'text'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('text/') || ext === 'txt' || ext === 'md') return 'text'
  return 'other'
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  image: '이미지',
  pdf: 'PDF',
  word: '문서',
  hwp: '한글 문서',
  text: '텍스트',
  spreadsheet: '스프레드시트',
  presentation: '프레젠테이션',
  archive: '압축 파일',
  video: '동영상',
  audio: '오디오',
  other: '파일',
}

/** 자료실 형식 필터 선택지 */
export const FILE_KIND_FILTER_LABEL: Record<FileKindFilter, string> = {
  image: '이미지',
  pdf: 'PDF',
  document: '문서(한글·워드·텍스트)',
  spreadsheet: '스프레드시트',
  presentation: '프레젠테이션',
  archive: '압축 파일',
  media: '동영상·오디오',
}

// ggac 이식: 자료실 형식 필터(원본 kindFilterExpression — PostgREST `or()` 식)는 SQL 로 옮겼다
// (`src/db/queries/work/files.ts` kindFilterSql, 같은 상수 패턴).

/** sharp 로 썸네일을 만들 수 있는 이미지(HEIC 는 시도하되 디코더가 없으면 건너뛴다) */
export function isProcessableImage(mime: string): boolean {
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ].includes(mime.toLowerCase())
}

const BROWSER_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
])
const BROWSER_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])

/**
 * 브라우저가 <img> 로 직접 그릴 수 있는 원본(HEIC·SVG 제외 — SVG 는 스크립트 위험).
 * name 을 주면 mime 이 비었을 때 확장자로 보정한다. 썸네일(sharp)은 `isProcessableImage` 만 만들고,
 * 썸네일이 없으면 `/api/board-room/work/files/<id>?thumb=1` 이 원본으로 폴백한다(BMP 등).
 */
export function isBrowserImage(mime: string, name?: string): boolean {
  const m = name === undefined ? mime.trim().toLowerCase() : resolveMime(mime, name)
  return BROWSER_IMAGE_MIME.has(m)
}

/** 라이트박스 텍스트 미리보기 상한(QA #21) — 이보다 크면 내려받기만 안내한다 */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024

const TEXT_PREVIEW_EXT = new Set([
  'txt',
  'md',
  'csv',
  'tsv',
  'log',
  'json',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'sql',
  'sh',
  'py',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'html',
  'htm',
  'srt',
  'vtt',
])

export type PreviewKind = 'image' | 'pdf' | 'text' | 'document' | 'sheet' | 'video' | 'audio'

const DOCUMENT_PREVIEW_EXT = new Set(['hwp', 'hwpx', 'hml', 'docx', 'pptx'])
const SHEET_PREVIEW_EXT = new Set(['xlsx', 'xls'])

/** 브라우저가 재생할 수 있는 동영상·오디오(mime). 코덱은 재생 시점에 onError 로 안내한다. */
const VIDEO_MIME = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/webm',
  'video/quicktime',
  'video/ogg',
])
const AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'audio/webm',
  'audio/x-aac',
  'audio/vnd.wave',
])
const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'])

/**
 * 라이트박스 미리보기 방식. 텍스트는 확장자 목록(또는 text/* mime)만 <pre> 로 그린다 — 렌더하지 않는다
 * (html 도 원문). 'document'(hwp·hwpx·hml·docx·pptx)·'sheet'(xlsx·xls)는 서버 변환(/api/board-room/work/files/<id>/render)
 * 뷰어로 연다. 'video'·'audio'는 서명 URL(/api/board-room/work/files/<id>)을 <video>·<audio> 가 직접 받는다.
 * 그 밖의 형식은 null(아이콘 + 다운로드). `size` 를 주면 1MB 넘는 `.ts`(MPEG-TS 동영상)도 null.
 */
export function previewKindOf(mime: string, name: string, size?: number): PreviewKind | null {
  // 큰 `.ts` 는 MPEG-TS 동영상 — 브라우저가 재생하지 못하므로 미리보기 없이 내려받기(isMpegTsVideo)
  if (isMpegTsVideo(mime, name, size)) return null
  const m = resolveMime(mime, name)
  const ext = extOf(name)
  if (BROWSER_IMAGE_MIME.has(m) || (m === 'application/octet-stream' && BROWSER_IMAGE_EXT.has(ext)))
    return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (DOCUMENT_PREVIEW_EXT.has(ext)) return 'document'
  if (SHEET_PREVIEW_EXT.has(ext)) return 'sheet'
  if (TEXT_PREVIEW_EXT.has(ext)) return 'text'
  const generic = m === 'application/octet-stream'
  if (VIDEO_MIME.has(m) || (generic && VIDEO_EXT.has(ext))) return 'video'
  if (AUDIO_MIME.has(m) || (generic && AUDIO_EXT.has(ext))) return 'audio'
  if (m.startsWith('text/')) return 'text'
  return null
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** RFC 6266/5987 — 한글 파일명을 그대로 싣는 inline Content-Disposition(ASCII 대체 이름 포함) */
export function inlineContentDisposition(name: string): string {
  return contentDisposition('inline', name)
}

/** 같은 형식의 내려받기(attachment) Content-Disposition — 엑셀 내보내기처럼 항상 저장시키는 응답용 */
export function attachmentContentDisposition(name: string): string {
  return contentDisposition('attachment', name)
}

/** 서명 URL 을 inline 으로 내려도 안전한 형식(스크립트 실행 불가) — 이미지·PDF·동영상·오디오 */
export function canInlinePreview(mime: string, name = '', size?: number): boolean {
  if (mime.toLowerCase() === 'application/pdf') return true
  const kind = previewKindOf(mime, name, size)
  return kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes}B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}${units[i]}`
}

/** MIME 비교용 정규화 — 소문자, `;charset=…` 같은 매개변수 제거 */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * Storage 객체에 실제로 저장된 Content-Type 이 attachments 행에 적을 mime 과 맞는가.
 * 업로드는 클라이언트가 서명 URL 로 직접 PUT 하므로 Content-Type 도 클라이언트가 정한다 — 행에는 `application/pdf` 를 적고
 * 객체는 `text/html` 로 올리면, 행 기준으로 inline 허용한 서명 URL 이 HTML 을 그대로 연다. 다르면 확정하지 않는다.
 * 저장된 형식이 없거나 일반 바이너리(`application/octet-stream`)면 브라우저가 화면에 그리지 않으므로 통과시킨다.
 */
export function storedContentTypeMatches(
  stored: string | null | undefined,
  rowMime: string
): boolean {
  const s = baseMime(stored)
  if (!s || s === 'application/octet-stream') return true
  return s === baseMime(rowMime)
}
