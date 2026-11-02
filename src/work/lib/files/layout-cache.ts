import { rangeToManifest, type LayoutRange, type LayoutResult } from './render-layout'
import { layoutManifestPath, layoutPagePath, layoutTooBigPath } from './render-types'
import { uploadBuffer } from './storage'

/**
 * 원본 첨부의 레이아웃 캐시(`board-work/renders/<id>-<버전>-layout*`) 저장 — 문서 뷰어(render 라우트)와
 * 초안 라우트(원본 쪽 수 계산)가 같은 경로·형식을 쓴다. 서버 전용.
 */
const UPLOAD_PARALLEL = 8

/** 렌더 결과를 manifest 와 쪽 SVG 로 나눠 저장한다. 실패는 호출자를 막지 않는다(다음 요청이 다시 렌더). */
export async function storeLayoutCache(
  id: string,
  version: string,
  result: LayoutResult
): Promise<void> {
  try {
    const entries = [...result.svgs.entries()]
    for (let i = 0; i < entries.length; i += UPLOAD_PARALLEL) {
      await Promise.all(
        entries
          .slice(i, i + UPLOAD_PARALLEL)
          .map(([page, svg]) =>
            uploadBuffer(layoutPagePath(id, version, page), Buffer.from(svg), 'image/svg+xml')
          )
      )
    }
    // manifest 는 마지막에 — 있으면 쪽 SVG 가 다 올라갔다는 표시가 된다.
    await uploadBuffer(
      layoutManifestPath(id, version),
      Buffer.from(
        JSON.stringify({
          pages: result.pages,
          warnings: result.warnings,
          truncated: result.truncated,
        })
      ),
      'application/json'
    )
  } catch (e) {
    console.error('[layout-cache] 레이아웃 캐시 저장 실패:', e)
  }
}

/**
 * 쪽 단위 지연 렌더 결과 저장 — 이번에 렌더한 쪽 SVG, 너무 큰 쪽 표식, (아직 없을 때만) manifest.
 * manifest 는 문서 전체 쪽 목록이라 구간 렌더 중 어느 요청에서든 만들 수 있고, 있으면 다시 쓰지 않는다(첫 구간의
 * tooLarge 표시를 뒤 요청이 지우지 않게). 실패는 호출자를 막지 않는다(다음 요청이 다시 렌더).
 */
export async function storeLayoutRange(
  id: string,
  version: string,
  range: LayoutRange,
  opts: { writeManifest: boolean }
): Promise<void> {
  try {
    const jobs: Array<() => Promise<void>> = [
      ...[...range.svgs.entries()].map(
        ([page, svg]) =>
          () =>
            uploadBuffer(layoutPagePath(id, version, page), Buffer.from(svg), 'image/svg+xml')
      ),
      ...range.tooLarge.map(
        page => () =>
          uploadBuffer(
            layoutTooBigPath(id, version, page),
            Buffer.from('{"tooLarge":true}'),
            'application/json'
          )
      ),
    ]
    for (let i = 0; i < jobs.length; i += UPLOAD_PARALLEL) {
      await Promise.all(jobs.slice(i, i + UPLOAD_PARALLEL).map(job => job()))
    }
    if (opts.writeManifest) {
      await uploadBuffer(
        layoutManifestPath(id, version),
        Buffer.from(JSON.stringify(rangeToManifest(range))),
        'application/json'
      )
    }
  } catch (e) {
    console.error('[layout-cache] 레이아웃 구간 캐시 저장 실패:', e)
  }
}
