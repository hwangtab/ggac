/**
 * 문서 뷰어 변환 결과의 공용 타입·상수(클라이언트·서버 공용 — kordoc 을 import 하지 않는다).
 * 변환은 `/api/board-room/work/files/<id>/render` Route Handler 가 하고, DocumentViewer 가 이 JSON 을 그린다.
 */

/** 변환하는 원본의 상한 — 넘으면 변환하지 않고 413(`too_large`) */
export const RENDER_MAX_BYTES = 50 * 1024 * 1024
/** 시트당 보여 주는 행 수(머리글 행 포함) — 넘으면 앞부분만 두고 `truncated` */
export const SHEET_MAX_ROWS = 2000
/** 변환 시간 제한(ms) */
export const RENDER_TIMEOUT_MS = 30_000
/**
 * 변환 결과 JSON 응답의 상한(바이트) — Vercel 함수 응답 한도 4.5MB 보다 낮게(이스케이프·헤더 여유 1MB).
 * 글자 수가 아니라 직렬화한 UTF-8 바이트로 센다(한글 3바이트). 넘으면 문서는 앞부분만, 시트는 시트별 몫으로 덜어내고 `truncated`.
 */
export const RENDER_MAX_RESPONSE_BYTES = 3.5 * 1024 * 1024
/** 시트 수 상한 */
export const SHEET_MAX_COUNT = 50

/** PPTX 슬라이드 수 상한 — 넘으면 변환하지 않고 too_large */
export const PPTX_MAX_SLIDES = 500
/** PPTX(zip) 압축 해제 총량 상한(바이트) — 압축 폭탄 방어. 넘으면 too_large */
export const PPTX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

export type RenderedSheet = {
  name: string
  markdown: string
  /** 행 수 상한(SHEET_MAX_ROWS) 또는 응답 용량 상한으로 뒷부분을 덜어냄 */
  truncated: boolean
  /** 덜어낸 까닭이 행 수가 아니라 응답 용량(RENDER_MAX_RESPONSE_BYTES)일 때 */
  bytesClipped?: boolean
}

export type RenderedDocument =
  | { kind: 'document'; markdown: string; truncated?: boolean }
  | { kind: 'sheets'; sheets: RenderedSheet[] }

/** 오류 코드 — HTTP 상태: unsupported 415 · too_large 413 · encrypted/corrupt 422 · timeout 504 · server 500 · rate_limited 429 */
export type RenderErrorCode =
  | 'unsupported'
  | 'too_large'
  | 'encrypted'
  | 'corrupt'
  | 'timeout'
  | 'server'
  | 'rate_limited'

export const RENDER_ERROR_MESSAGE: Record<RenderErrorCode, string> = {
  unsupported: '이 형식은 미리보기를 지원하지 않습니다.',
  too_large: '파일이 너무 커서 미리 볼 수 없습니다.',
  encrypted: '암호가 걸렸거나 보호된 문서라 미리 볼 수 없습니다.',
  corrupt: '문서를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.',
  timeout: '변환이 너무 오래 걸려 중단했습니다.',
  server: '미리보기를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  rate_limited: '문서를 너무 자주 열었습니다. 잠시 뒤 다시 시도해 주세요.',
}

export const RENDER_ERROR_STATUS: Record<RenderErrorCode, number> = {
  unsupported: 415,
  too_large: 413,
  encrypted: 422,
  corrupt: 422,
  timeout: 504,
  server: 500,
  rate_limited: 429,
}

export class RenderError extends Error {
  readonly code: RenderErrorCode

  constructor(code: RenderErrorCode, detail?: string) {
    super(detail ?? RENDER_ERROR_MESSAGE[code])
    this.name = 'RenderError'
    this.code = code
  }
}

/**
 * 변환 캐시 객체 경로 — 비공개 Blob의 `board-work/renders/` 접두(ggac 이식: 원본은 work-files 버킷의 `renders/`).
 * 업로드 키(`board-work/files/…`)와 겹치지 않고, 읽기·쓰기 전마다 `isSafeBoardWorkPath`가 모양을 다시 본다.
 * 첨부는 올라간 뒤 바뀌지 않으므로(blob_path 동결) attachment id + 변환기 버전이 곧 캐시 키다.
 */
export function renderCachePath(attachmentId: string, converterVersion: string): string {
  return `${RENDER_CACHE_DIR}/${attachmentId}-${converterVersion}.json`
}

/** 변환 캐시가 놓이는 비공개 Blob 안 폴더(접두) */
export const RENDER_CACHE_DIR = 'board-work/renders'

/** `renders/` 안 객체 이름에서 첨부 id 를 읽는다(`<uuid>-<변환기버전>.json`, 레이아웃 보기는 `<uuid>-<버전>-layout.json`·`…-layout-p<n>.svg`). 규약 밖 이름은 null */
export function renderCacheAttachmentId(objectName: string): string | null {
  const m =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-.+\.(?:json|svg)$/i.exec(
      objectName
    )
  return m ? m[1].toLowerCase() : null
}

// ── 원본 레이아웃 보기(HWP·HWPX → 쪽별 SVG) ─────────────────────────────────

/**
 * 레이아웃으로 렌더하는 최대 쪽 수 — 넘으면 앞쪽만 두고 `truncated`.
 * 근거: 쪽마다 SVG 한 장(실측 수십~수백 KB, 이미지가 많으면 MB 단위)이 문자열로 메모리·캐시에 오르므로 쪽 수는
 * 총량 상한(LAYOUT_MAX_TOTAL_SVG_BYTES)과 함께 본다. 300쪽은 일반 공문서·보고서를 거의 덮고, 그보다 긴 문서는 앞쪽만 보여 주는 편이 낫다.
 */
export const LAYOUT_MAX_PAGES = 300
/** 한 번에 kordoc 에 렌더시키는 쪽 수 — 쪽 구간(`pages` 옵션)으로 나눠 한꺼번에 쥐는 SVG 양을 줄인다 */
export const LAYOUT_CHUNK_PAGES = 50
/**
 * 렌더한 쪽 SVG 합계 상한(바이트) — 넘으면 too_large. kordoc 은 쪽마다 이미지 base64·pattern 을 되풀이해 넣으므로
 * 이미지가 많은 300쪽 문서는 GB 단위 문자열이 될 수 있다(캐시 저장·함수 메모리 모두 위험).
 */
export const LAYOUT_MAX_TOTAL_SVG_BYTES = 150 * 1024 * 1024
/** 쪽 SVG 한 장의 상한(바이트) — 넘으면 그 쪽은 저장·표시하지 않고 `tooLarge` (함수 응답 4.5MB 한도보다 낮게) */
export const LAYOUT_MAX_PAGE_SVG_BYTES = 4 * 1024 * 1024
/** 문서 안 이미지 한 장의 상한(바이트) — kordoc 이 넘는 이미지는 경고만 남기고 그리지 않는다 */
export const LAYOUT_MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** manifest 에 싣는 경고 문구 수 상한 */
export const LAYOUT_MAX_WARNINGS = 20

export type LayoutPage = {
  page: number
  /** pt */
  width: number
  height: number
  /** SVG 가 상한을 넘어 저장·표시하지 않은 쪽 */
  tooLarge?: boolean
}

/** `?view=layout` 응답 — 쪽 목록·경고. 쪽 SVG 는 `?view=layout&page=<n>` */
export type LayoutManifest = {
  pages: LayoutPage[]
  warnings: string[]
  /** 문서가 LAYOUT_MAX_PAGES 보다 길어 앞쪽만 렌더함 */
  truncated: boolean
}

export function isLayoutManifest(v: unknown): v is LayoutManifest {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    Array.isArray(o.pages) &&
    o.pages.every(
      p =>
        !!p &&
        typeof p === 'object' &&
        Number.isInteger((p as LayoutPage).page) &&
        typeof (p as LayoutPage).width === 'number' &&
        typeof (p as LayoutPage).height === 'number' &&
        (p as LayoutPage).width > 0 &&
        (p as LayoutPage).height > 0
    ) &&
    Array.isArray(o.warnings) &&
    typeof o.truncated === 'boolean'
  )
}

/** 레이아웃 manifest 캐시 경로 — `renders/` 평면(폴더 없이) 이라 첨부 삭제 정리가 접두 목록으로 함께 지운다 */
export function layoutManifestPath(attachmentId: string, layoutVersion: string): string {
  return `${RENDER_CACHE_DIR}/${attachmentId}-${layoutVersion}-layout.json`
}

/** 쪽 SVG 캐시 경로 */
export function layoutPagePath(attachmentId: string, layoutVersion: string, page: number): string {
  return `${RENDER_CACHE_DIR}/${attachmentId}-${layoutVersion}-layout-p${page}.svg`
}

/**
 * "이 쪽은 SVG 가 쪽 상한(LAYOUT_MAX_PAGE_SVG_BYTES)을 넘는다"는 표식 객체 경로 — 쪽 요청에서야 알게 된 쪽이
 * (manifest 에는 첫 구간의 tooLarge 만 실린다) 다시 렌더되지 않게 한다. 이름이 `.json` 으로 끝나 정리 로직이 같이 지운다.
 */
export function layoutTooBigPath(
  attachmentId: string,
  layoutVersion: string,
  page: number
): string {
  return `${RENDER_CACHE_DIR}/${attachmentId}-${layoutVersion}-layout-p${page}-big.json`
}

/**
 * 쪽 단위 지연 렌더의 구간 크기(쪽) — manifest 요청은 앞 구간, 쪽 요청은 그 쪽이 든 구간만 렌더한다.
 * 근거: kordoc 은 구간과 상관없이 문서 전체를 파싱·조판한 뒤 선택한 쪽의 SVG 만 조립한다(실측: 20쪽 문서에서 전체 111ms,
 * 한 쪽 68ms). 그래서 구간이 작을수록 한 번의 호출은 짧지만 호출 수가 늘어난다. 10쪽이면 이미지가 많은 문서(쪽 SVG 가 MB 단위)도
 * 한 호출이 수 초 안에 끝나고, 스크롤 한 번에 보이는 쪽 수와 비슷해 요청이 몰리지도 않는다.
 */
export const LAYOUT_LAZY_CHUNK_PAGES = 10
/**
 * 레이아웃 요청 하나가 쓰는 시간 예산(ms) — maxDuration 60초에서 다운로드·캐시 저장·응답 여유를 뺀 값.
 * 이 시각을 넘으면 남은 구간을 시작하지 않는다(kordoc 은 동기 CPU 라 도는 중에는 못 끊는다).
 */
export const LAYOUT_REQUEST_BUDGET_MS = 45_000

/** 레이아웃 보기를 지원하는 파일(HWP·HWPX) */
export function isLayoutFile(name: string): boolean {
  return /\.hwpx?$/i.test(name)
}

// ── 문서 편집(HWP 양식 채우기·문구 고치기, docs/10) ─────────────────────────────

/** 앱 안에서 고칠 수 있는 원본 상한(바이트) — 넘으면 "내 PC에서 수정" 안내 */
export const DOC_EDIT_MAX_BYTES = 20 * 1024 * 1024
/** 초안 만들기(채우기·패치·재파싱 검증) 타임아웃(ms) */
export const DOC_EDIT_TIMEOUT_MS = 45_000
/** 문구 고치기 블록 수 상한(표 셀 포함 합계) */
export const DOC_EDIT_MAX_BLOCKS = 5000
/** 요청 본문(편집 블록·채우기 값 JSON) 상한(바이트) */
export const DOC_EDIT_MAX_BODY_BYTES = 2 * 1024 * 1024
/** 초안 쪽 수가 원본과 이만큼 이상 달라지면 저장을 막는다 */
export const DOC_EDIT_MAX_PAGE_DIFF = 2
/** 초안 변환(비싼 경로) 사용자당 분당 횟수 */
export const DOC_EDIT_RATE_LIMIT_PER_MIN = 10

/** 문서 편집 지원 확장자(HWP·HWPX) — 판별은 바이트로 한 번 더 한다 */
export function isDocEditFile(name: string): boolean {
  return isLayoutFile(name)
}

/** 앱 안 양식 채우기를 여는 파일 — HWPX 만(HWP 5.x 는 문구 고치기만, docs/10 §10) */
export function isFormFillFile(name: string): boolean {
  return /\.hwpx$/i.test(name.trim())
}
