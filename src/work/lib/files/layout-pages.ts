import { storeLayoutRange } from './layout-cache'
import { chunkOf, rangeToManifest, renderLayoutRange, type LayoutRange } from './render-layout'
import { hitRenderLimit, recallRenderFailure, rememberRenderFailure } from './render-guard'
import {
  LAYOUT_LAZY_CHUNK_PAGES,
  LAYOUT_MAX_PAGES,
  LAYOUT_REQUEST_BUDGET_MS,
  RENDER_MAX_BYTES,
  RenderError,
  isLayoutManifest,
  layoutManifestPath,
  layoutPagePath,
  layoutTooBigPath,
  type LayoutManifest,
} from './render-types'
import { downloadObject } from './storage'

/**
 * HWP·HWPX 원본 모양 보기의 **쪽 단위 지연 렌더**(서버 전용). 예전에는 첫 요청이 문서 전체(최대 300쪽)를 렌더해 쪽 SVG 를
 * 모두 올린 뒤 마지막에 manifest 를 썼다 — 함수가 60초(maxDuration)에 강제 종료되면 manifest 가 없고 실패 기억도 남지 않아
 * 열 때마다 같은 일을 되풀이하다 또 죽었다. 이제:
 *
 * - manifest 요청: 문서를 열어 **전체 쪽 목록·크기**(kordoc `scene.pages` 는 선택과 무관하게 전체를 준다)와 앞 구간만 렌더·저장.
 * - 쪽 요청: 캐시 미스면 그 쪽이 든 구간(LAYOUT_LAZY_CHUNK_PAGES)만 렌더·저장. 썸네일(`purpose=thumb`)은 그 쪽 하나만.
 * - 한 번의 요청은 kordoc 호출 한두 번 — 어느 문서든 60초 안에 끝나고, 못 끝내는 구간만 실패한다(다른 구간은 계속 열린다).
 * - 쪽 SVG 가 쪽 상한을 넘으면 표식 객체를 남겨 다시 렌더하지 않는다.
 * - 같은 인스턴스 안의 같은 구간 동시 요청은 진행 중인 Promise 를 공유한다(single-flight).
 */

/** 속도 제한에 걸림 — 라우트가 Retry-After 를 붙인다 */
export class LayoutRateLimited extends RenderError {
  readonly retryAfterSec: number

  constructor(retryAfterSec: number) {
    super('rate_limited')
    this.name = 'LayoutRateLimited'
    this.retryAfterSec = retryAfterSec
  }
}

export type LayoutTarget = {
  /** 첨부 id */
  id: string
  name: string
  /** 원본 바이트(업무툴 첨부는 업무툴 저장소, 이사회 서류는 서류 저장소 — 권한 판정은 호출 전에 끝나 있다) */
  readOriginal: () => Promise<Buffer>
  /** 레이아웃 캐시 버전(`layoutVersion()`) */
  version: string
  userId: string
  purpose: 'view' | 'thumb'
  /** 요청 시작 시각(ms) — 시간 예산의 기준 */
  startedAt: number
}

// ── single-flight ───────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<LayoutRange | null>>()

/** 같은 key 가 진행 중이면 그 Promise 를 돌려준다 */
function once(key: string, run: () => Promise<LayoutRange | null>): Promise<LayoutRange | null> {
  const hit = inflight.get(key)
  if (hit) return hit
  const p = run().finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, p)
  return p
}

/** 테스트용 */
export function layoutInflightCount(): number {
  return inflight.size
}

// ── 캐시 읽기 ───────────────────────────────────────────────────────────────

async function readManifest(path: string): Promise<LayoutManifest | null> {
  try {
    const parsed: unknown = JSON.parse((await downloadObject(path)).toString('utf8'))
    return isLayoutManifest(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await downloadObject(path)
    return true
  } catch {
    return false
  }
}

// ── 구간 렌더 ───────────────────────────────────────────────────────────────

/**
 * 원본을 내려받아 from~to 쪽을 렌더·저장한다. 원본을 읽을 수 없으면 null(→ 404).
 * 속도 제한·결정적 실패 기억은 **구간마다**(손상 문서가 구간 수만큼 되풀이 렌더되지 않게, 정상 구간은 막지 않게).
 */
async function renderAndStore(
  t: LayoutTarget,
  from: number,
  to: number,
  writeManifest: boolean
): Promise<LayoutRange | null> {
  const failureKey = `${t.id}:${t.version}:layout:${from}-${to}`
  const remembered = recallRenderFailure(failureKey)
  if (remembered) throw new RenderError(remembered)
  const limit = await hitRenderLimit(t.userId, t.purpose)
  if (!limit.ok) throw new LayoutRateLimited('retryAfterSec' in limit ? limit.retryAfterSec : 60)

  let original: Buffer
  try {
    original = await t.readOriginal()
  } catch (e) {
    console.error('[layout-pages] 원본 읽기 실패:', e)
    return null
  }
  // 행의 size 는 클라이언트가 기록한 값이라 실제 바이트로 한 번 더 막는다.
  if (original.length > RENDER_MAX_BYTES) throw new RenderError('too_large')

  let range: LayoutRange
  try {
    range = await renderLayoutRange(
      original,
      t.name,
      { from, to },
      { deadline: t.startedAt + LAYOUT_REQUEST_BUDGET_MS }
    )
  } catch (e) {
    if (e instanceof RenderError) {
      if (e.code === 'corrupt' || e.code === 'timeout') {
        console.warn(`[layout-pages] ${t.id} ${from}-${to}쪽 렌더 실패(${e.code}):`, e.message)
      }
      rememberRenderFailure(failureKey, e.code)
      throw e
    }
    console.error('[layout-pages] 렌더 중 예외:', e)
    throw new RenderError('server')
  }
  if (range.pages.length > 0) {
    await storeLayoutRange(t.id, t.version, range, { writeManifest })
  }
  return range
}

// ── 공개 API ────────────────────────────────────────────────────────────────

/**
 * manifest(문서 전체 쪽 목록). 캐시가 없으면 앞 구간을 렌더하며 만든다. 원본을 못 읽으면 null.
 * 실패는 RenderError(속도 제한은 LayoutRateLimited).
 */
export async function loadLayoutManifest(t: LayoutTarget): Promise<LayoutManifest | null> {
  const cached = await readManifest(layoutManifestPath(t.id, t.version))
  if (cached) return cached
  const range = await once(`${t.id}:${t.version}:1-${LAYOUT_LAZY_CHUNK_PAGES}`, () =>
    renderAndStore(t, 1, LAYOUT_LAZY_CHUNK_PAGES, true)
  )
  return range ? rangeToManifest(range) : null
}

/**
 * 쪽 SVG. 캐시 → (너무 큰 쪽 표식) → 그 쪽이 든 구간 렌더 순. 없는 쪽·너무 큰 쪽이면 null(→ 404).
 * 실패는 RenderError(속도 제한은 LayoutRateLimited).
 */
export async function loadLayoutPage(
  t: LayoutTarget,
  page: number
): Promise<string | Buffer | null> {
  if (!Number.isInteger(page) || page < 1 || page > LAYOUT_MAX_PAGES) return null

  const manifest = await readManifest(layoutManifestPath(t.id, t.version))
  if (manifest) {
    const entry = manifest.pages.find(p => p.page === page)
    if (!entry || entry.tooLarge) return null
  }
  try {
    return await downloadObject(layoutPagePath(t.id, t.version, page))
  } catch {
    // 아직 안 그린 쪽(또는 저장 일부 실패) — 아래에서 렌더한다
  }
  // 이전에 렌더하다 쪽 상한을 넘는 것으로 확인된 쪽이면 다시 렌더하지 않는다
  if (await exists(layoutTooBigPath(t.id, t.version, page))) return null

  // 썸네일은 그 쪽 하나만, 일반 보기는 그 쪽이 든 구간
  const { from, to } = t.purpose === 'thumb' ? { from: page, to: page } : chunkOf(page)
  const range = await once(`${t.id}:${t.version}:${from}-${to}`, () =>
    renderAndStore(t, from, to, manifest === null)
  )
  if (!range) return null
  const svg = range.svgs.get(page)
  if (svg !== undefined) return svg
  // 시간 예산이 모자라 이 쪽을 시작하지 못했다면 실패, 그 밖(너무 큼·문서 밖)은 없는 쪽
  if (range.incomplete) throw new RenderError('timeout')
  return null
}
