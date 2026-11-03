import { guardZipBuffer } from './zip-guard'
import {
  LAYOUT_CHUNK_PAGES,
  LAYOUT_LAZY_CHUNK_PAGES,
  LAYOUT_MAX_IMAGE_BYTES,
  LAYOUT_MAX_PAGES,
  LAYOUT_MAX_PAGE_SVG_BYTES,
  LAYOUT_MAX_TOTAL_SVG_BYTES,
  LAYOUT_MAX_WARNINGS,
  RENDER_TIMEOUT_MS,
  RenderError,
  isLayoutFile,
  type LayoutManifest,
  type LayoutPage,
} from './render-types'

/**
 * HWP·HWPX 원본 레이아웃 보기 — kordoc `renderDocumentToScene` 으로 쪽마다 standalone SVG 를 만든다.
 * 서버 전용(Route Handler 에서만 import). 한계: 머리말·꼬리말·각주·수식은 그리지 않고, 쪽에 걸친 표는 시작 쪽에서 잘린다.
 * 이미지는 SVG 안에 data URI 로 박히므로 이미지 1장·쪽 SVG 1장·쪽 수에 상한을 둔다(render-types 의 LAYOUT_*).
 */

export type LayoutResult = {
  pages: LayoutPage[]
  /** 저장·표시할 쪽 SVG(상한 안인 쪽만) */
  svgs: Map<number, string>
  warnings: string[]
  truncated: boolean
}

/**
 * 레이아웃 캐시 키 — kordoc 을 올리거나 렌더 옵션·상한을 바꾸면(`L` 번호) 캐시가 갈린다.
 * L2: 쪽 단위 지연 렌더(manifest 가 문서 전체 쪽 목록을 싣고 쪽 SVG 는 요청 때 구간별로 채운다 + 너무 큰 쪽 표식).
 */
export async function layoutVersion(): Promise<string> {
  const { VERSION } = await import('kordoc')
  return `kordoc${VERSION}-L2`
}

export function toManifest(r: LayoutResult): LayoutManifest {
  return { pages: r.pages, warnings: r.warnings, truncated: r.truncated }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderError('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** kordoc 오류 → RenderError. 암호는 encrypted, 지원 밖 형식은 unsupported, 나머지는 corrupt. */
function mapError(e: unknown): RenderError {
  if (e instanceof RenderError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (/암호|encrypt|password|DRM/i.test(msg)) return new RenderError('encrypted', msg)
  if (/미지원|지원하지|unsupported/i.test(msg)) return new RenderError('unsupported', msg)
  return new RenderError('corrupt', msg)
}

/**
 * HWP·HWPX 를 쪽별 SVG 로 렌더한다. 실패는 RenderError(코드). 타임아웃은 응답을 끊을 뿐
 * 동기 CPU 작업을 중단하지는 못한다 — 원본 크기 상한(RENDER_MAX_BYTES)을 호출자가 먼저 건다.
 */
export async function renderLayout(
  buffer: Buffer,
  name: string,
  opts: { timeoutMs?: number } = {}
): Promise<LayoutResult> {
  if (!isLayoutFile(name)) throw new RenderError('unsupported')
  // HWPX 는 zip — kordoc 이 풀기 전에 실제 해제량을 검사한다(압축 폭탄)
  await guardZipBuffer(buffer, name)
  const { renderDocumentToScene } = await import('kordoc')

  // 쪽 구간(`pages`)으로 나눠 렌더한다 — 한 번에 쥐는 SVG 양을 줄이고, 합계가 상한을 넘는 즉시 멈춘다.
  // 타임아웃은 전체 렌더에 하나(구간마다 새로 주지 않는다).
  const deadline = Date.now() + (opts.timeoutMs ?? RENDER_TIMEOUT_MS)
  const svgs = new Map<number, string>()
  const pages: LayoutPage[] = []
  let totalPages = 0
  let totalBytes = 0
  let warnings: string[] = []

  for (let from = 1; from <= LAYOUT_MAX_PAGES; from += LAYOUT_CHUNK_PAGES) {
    const to = Math.min(from + LAYOUT_CHUNK_PAGES - 1, LAYOUT_MAX_PAGES)
    let rendered: Awaited<ReturnType<typeof renderDocumentToScene>>
    try {
      rendered = await withTimeout(
        renderDocumentToScene(buffer, {
          pages: `${from}-${to}`,
          reflow: true,
          maxImageBytes: LAYOUT_MAX_IMAGE_BYTES,
        }),
        Math.max(1, deadline - Date.now())
      )
    } catch (e) {
      throw mapError(e)
    }
    const { scene, pageSvgs } = rendered
    if (from === 1) {
      totalPages = scene.pages.length
      warnings = scene.warnings.slice(0, LAYOUT_MAX_WARNINGS)
    }
    let any = false
    for (const p of [...scene.pages].sort((a, b) => a.page - b.page)) {
      if (p.page < from || p.page > to) continue // 이 구간 밖
      const svg = pageSvgs.get(p.page)
      if (svg === undefined) continue
      any = true
      const bytes = Buffer.byteLength(svg, 'utf8')
      if (bytes > LAYOUT_MAX_PAGE_SVG_BYTES) {
        // 저장하지 않아도 렌더한 양이긴 하다 — 합계에는 센다
        totalBytes += bytes
        pages.push({ page: p.page, width: p.width, height: p.height, tooLarge: true })
      } else {
        totalBytes += bytes
        svgs.set(p.page, svg)
        pages.push({ page: p.page, width: p.width, height: p.height })
      }
      if (totalBytes > LAYOUT_MAX_TOTAL_SVG_BYTES) throw new RenderError('too_large')
    }
    if (!any || to >= totalPages) break // 문서 끝
  }
  if (pages.length === 0) throw new RenderError('corrupt', '렌더된 쪽이 없습니다')

  return {
    pages,
    svgs,
    warnings,
    truncated: totalPages > pages.length,
  }
}

// ── 쪽 단위 지연 렌더 ────────────────────────────────────────────────────────

/** 구간 렌더 결과 — 문서 전체 쪽 목록(크기)과, 이번에 렌더한 쪽의 SVG */
export type LayoutRange = {
  /** 문서 전체 쪽 목록·크기(LAYOUT_MAX_PAGES 까지). `tooLarge` 는 이번에 렌더해 확인된 쪽에만 붙는다 */
  pages: LayoutPage[]
  /** 문서 전체 쪽 수(LAYOUT_MAX_PAGES 로 자르기 전). 요청 구간이 문서 밖이면 0 */
  totalPages: number
  warnings: string[]
  /** 문서가 LAYOUT_MAX_PAGES 보다 길다 */
  truncated: boolean
  /** 이번에 렌더한 쪽 SVG(쪽 상한 안인 쪽만) */
  svgs: Map<number, string>
  /** 이번에 렌더했는데 쪽 SVG 가 상한을 넘은 쪽 */
  tooLarge: number[]
  /** 시간 예산이 모자라 시작하지 못한 구간이 있다 */
  incomplete: boolean
}

export function rangeToManifest(r: LayoutRange): LayoutManifest {
  return { pages: r.pages, warnings: r.warnings, truncated: r.truncated }
}

/** 쪽 번호가 속한 구간(LAYOUT_LAZY_CHUNK_PAGES 단위로 정렬) */
export function chunkOf(page: number): { from: number; to: number } {
  const from = Math.floor((page - 1) / LAYOUT_LAZY_CHUNK_PAGES) * LAYOUT_LAZY_CHUNK_PAGES + 1
  return { from, to: from + LAYOUT_LAZY_CHUNK_PAGES - 1 }
}

/**
 * HWP·HWPX 의 `from`~`to` 쪽만 렌더한다(쪽 번호 1부터, LAYOUT_MAX_PAGES 로 자름). 구간은 LAYOUT_LAZY_CHUNK_PAGES 쪽씩
 * 나눠 kordoc 에 맡기고, `deadline`(절대 시각)을 넘으면 **남은 구간을 시작하지 않는다**(`incomplete`). 첫 구간도 못 시작하면 timeout.
 * kordoc 의 `scene.pages` 는 선택한 쪽과 상관없이 문서 전체 쪽과 크기를 주므로, 한 번의 호출로 manifest 재료도 얻는다.
 * 실패는 RenderError(코드).
 */
export async function renderLayoutRange(
  buffer: Buffer,
  name: string,
  range: { from: number; to: number },
  opts: { timeoutMs?: number; deadline?: number } = {}
): Promise<LayoutRange> {
  if (!isLayoutFile(name)) throw new RenderError('unsupported')
  const from = Math.max(1, Math.floor(range.from))
  let to = Math.min(LAYOUT_MAX_PAGES, Math.floor(range.to))
  if (!(from <= to)) throw new RenderError('corrupt', '쪽 범위가 올바르지 않습니다')
  // HWPX 는 zip — kordoc 이 풀기 전에 실제 해제량을 검사한다(압축 폭탄)
  await guardZipBuffer(buffer, name)
  const { renderDocumentToScene } = await import('kordoc')

  const deadline = opts.deadline ?? Date.now() + RENDER_TIMEOUT_MS
  const perCall = opts.timeoutMs ?? RENDER_TIMEOUT_MS
  const out: LayoutRange = {
    pages: [],
    totalPages: 0,
    warnings: [],
    truncated: false,
    svgs: new Map(),
    tooLarge: [],
    incomplete: false,
  }
  let first = true

  for (let a = from; a <= to; a += LAYOUT_LAZY_CHUNK_PAGES) {
    const left = deadline - Date.now()
    if (left <= 0) {
      if (first) throw new RenderError('timeout')
      out.incomplete = true
      break
    }
    const b = Math.min(a + LAYOUT_LAZY_CHUNK_PAGES - 1, to)
    let rendered: Awaited<ReturnType<typeof renderDocumentToScene>>
    try {
      rendered = await withTimeout(
        renderDocumentToScene(buffer, {
          pages: `${a}-${b}`,
          reflow: true,
          maxImageBytes: LAYOUT_MAX_IMAGE_BYTES,
        }),
        Math.max(1, Math.min(perCall, left))
      )
    } catch (e) {
      // 문서보다 뒤의 구간을 요청하면 kordoc 이 "선택한 페이지가 없습니다"로 던진다 — 오류가 아니라 빈 결과
      if (first && a > 1 && /선택한 페이지가 없습니다/.test(e instanceof Error ? e.message : '')) {
        return out
      }
      throw mapError(e)
    }
    const { scene, pageSvgs } = rendered
    if (first) {
      first = false
      const sorted = [...scene.pages].sort((x, y) => x.page - y.page)
      out.totalPages = sorted.length
      out.truncated = sorted.length > LAYOUT_MAX_PAGES
      out.warnings = scene.warnings.slice(0, LAYOUT_MAX_WARNINGS)
      out.pages = sorted
        .slice(0, LAYOUT_MAX_PAGES)
        .map(p => ({ page: p.page, width: p.width, height: p.height }))
      to = Math.min(to, sorted.length)
    }
    for (const [page, svg] of pageSvgs) {
      if (page < a || page > b) continue
      if (Buffer.byteLength(svg, 'utf8') > LAYOUT_MAX_PAGE_SVG_BYTES) {
        out.tooLarge.push(page)
        const entry = out.pages.find(p => p.page === page)
        if (entry) entry.tooLarge = true
      } else {
        out.svgs.set(page, svg)
      }
    }
  }
  // 요청 구간이 문서 밖(위에서 빈 결과로 돌려준 경우 외)이거나 첫 구간에서 쪽이 하나도 안 나오면 손상으로 본다
  if (out.pages.length === 0) throw new RenderError('corrupt', '렌더된 쪽이 없습니다')
  return out
}
