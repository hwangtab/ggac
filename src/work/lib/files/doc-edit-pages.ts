import { DRAFT_PREVIEW_MAX_PAGES } from './doc-edit-types'
import { storeLayoutRange } from './layout-cache'
import { layoutVersion, renderLayoutRange, type LayoutResult } from './render-layout'
import { RENDER_TIMEOUT_MS, isLayoutManifest, layoutManifestPath } from './render-types'
import { downloadObject } from './storage'

/**
 * 초안·저장본 검증이 같이 쓰는 쪽 수·쪽 그림 도우미(서버 전용). 함수 전체 예산(startedAt 기준) 안에서만 렌더한다.
 * 문서 내용은 로그에 남기지 않는다.
 *
 * 문서 전체(최대 300쪽)를 렌더해 쪽 SVG 를 모두 올리면 60초(maxDuration) 예산을 넘는다 — kordoc `scene.pages` 는 선택한 쪽과
 * 상관없이 전체 쪽 목록·크기를 주므로(layout-pages.ts), 쪽 수는 한 구간만 렌더해 얻고 SVG 는 미리보기에 쓸 앞쪽만 만든다.
 */

/** 함수 전체 예산(ms) — maxDuration 60 에서 응답 여유를 뺀 값 */
export const TOTAL_BUDGET_MS = 55_000
/** 남은 예산이 이보다 적으면 쪽 그림 렌더를 건너뛴다 */
export const MIN_LAYOUT_BUDGET_MS = 4_000

/**
 * 문서 쪽 목록(전체)과 앞 `previewPages` 쪽의 SVG. `pages` 는 문서 전체(최대 300쪽)라 `pages.length` 가 쪽 수다.
 * 예산이 모자라 일부 구간을 못 그리면 그 쪽은 `svgs` 에 없다(저장 때 manifest 에서 빠진다).
 */
export async function renderPages(
  bytes: Buffer,
  name: string,
  startedAt: number,
  previewPages: number = DRAFT_PREVIEW_MAX_PAGES
): Promise<LayoutResult | null> {
  const left = TOTAL_BUDGET_MS - (Date.now() - startedAt)
  if (left < MIN_LAYOUT_BUDGET_MS) return null
  try {
    const range = await renderLayoutRange(
      bytes,
      name,
      { from: 1, to: Math.max(1, previewPages) },
      { timeoutMs: Math.min(left, RENDER_TIMEOUT_MS), deadline: startedAt + TOTAL_BUDGET_MS }
    )
    return {
      pages: range.pages,
      svgs: range.svgs,
      warnings: range.warnings,
      truncated: range.truncated,
    }
  } catch {
    return null
  }
}

/** 원본 쪽 수 — 레이아웃 캐시(문서 뷰어가 만든 것)가 있으면 그것을 쓴다 */
export async function originalPageCount(
  attachmentId: string,
  bytes: Buffer,
  name: string,
  startedAt: number
): Promise<number | null> {
  try {
    const version = await layoutVersion()
    const parsed: unknown = JSON.parse(
      (await downloadObject(layoutManifestPath(attachmentId, version))).toString('utf8')
    )
    if (isLayoutManifest(parsed) && !parsed.truncated) return parsed.pages.length
  } catch {
    // 캐시 없음 — 아래에서 직접 센다
  }
  const left = TOTAL_BUDGET_MS - (Date.now() - startedAt)
  if (left < MIN_LAYOUT_BUDGET_MS) return null
  let range
  try {
    // 쪽 수만 필요하다 — 첫 쪽 한 구간만 렌더하면 전체 쪽 목록을 얻는다
    range = await renderLayoutRange(
      bytes,
      name,
      { from: 1, to: 1 },
      { timeoutMs: Math.min(left, RENDER_TIMEOUT_MS), deadline: startedAt + TOTAL_BUDGET_MS }
    )
  } catch {
    return null
  }
  // 문서 뷰어가 쪽 요청 때 나머지를 채운다(manifest 만 있고 쪽 SVG 가 아직 없는 상태가 정상) — 쪽 수가 정확할 때만 둔다
  if (!range.truncated) {
    await storeLayoutRange(attachmentId, await layoutVersion(), range, {
      writeManifest: true,
    })
  }
  return range.truncated ? null : range.pages.length
}
