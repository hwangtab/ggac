import { boardWorkThumbPath, isSafeBoardWorkPath } from '../../../lib/storage/boardWork.ts'
import { RENDER_CACHE_DIR, renderCacheAttachmentId } from './render-types.ts'

/**
 * 정리 크론이 **무엇을 지울지** 정하는 순수 함수 — 원본 kosmart-work `/api/internal/purge-pending-uploads`·
 * `lib/files/pending-orphans.ts`·`lib/digest/cleanup.ts`의 경로 계산을 옮겼다. `node --test`가 직접 읽는다.
 *
 * 비공개 Blob 저장소에는 업무툴 파일 말고도 DB 백업(`backups/`)·메일 첨부(`mailbox/`)·이사회 서류가 있다. 그래서 여기서
 * 내보내는 모든 키는 **`isSafeBoardWorkPath`를 지난 것뿐**이다(행의 경로가 이상하면 객체는 건드리지 않고 `unsafe`로 센다).
 * 저장소 계층(`storage.ts` removeObjects)도 지우기 직전에 같은 검사를 한 번 더 한다.
 */

export type PathPlan = { paths: string[]; unsafe: number }

/**
 * 오래된 임시 업로드 행 → 지울 객체 키. 원본처럼 업로드 객체 + (문서 편집 초안이면) 초안 미리보기 캐시.
 * 임시 업로드에는 썸네일이 없다(승격 때 만든다).
 */
export function pendingObjectPaths(
  rows: readonly { id: string; blobPath: string; isDraft: boolean }[],
  draftLayoutPaths: (uploadId: string) => string[]
): PathPlan {
  const out = new Set<string>()
  let unsafe = 0
  for (const r of rows) {
    if (isSafeBoardWorkPath(r.blobPath)) out.add(r.blobPath)
    else unsafe++
    if (r.isDraft) {
      for (const p of draftLayoutPaths(r.id)) {
        if (isSafeBoardWorkPath(p)) out.add(p)
        else unsafe++
      }
    }
  }
  return { paths: [...out], unsafe }
}

/**
 * 영구 삭제할 첨부 → 지울 객체 키(원본 + `.thumb.webp` 썸네일 — 썸네일이 없는 첨부의 키는 저장소가 조용히 무시한다).
 * 첨부 id는 미리보기 캐시(`board-work/renders/<id>-…`) 정리에 쓴다.
 */
export function purgeObjectPaths(
  attachments: readonly { id: string; blobPath: string }[]
): PathPlan & { attachmentIds: string[] } {
  const out = new Set<string>()
  const ids = new Set<string>()
  let unsafe = 0
  for (const a of attachments) {
    ids.add(a.id.toLowerCase())
    const thumb = boardWorkThumbPath(a.blobPath)
    if (isSafeBoardWorkPath(a.blobPath) && isSafeBoardWorkPath(thumb)) {
      out.add(a.blobPath)
      out.add(thumb)
    } else {
      unsafe++
    }
  }
  return { paths: [...out], unsafe, attachmentIds: [...ids] }
}

/** 첨부 하나의 미리보기 캐시 목록 접두(`board-work/renders/<id>-`) */
export function renderPrefixOf(attachmentId: string): string {
  return `${RENDER_CACHE_DIR}/${attachmentId.toLowerCase()}-`
}

/** 목록에서 받은 키 중 이 첨부의 미리보기 캐시만(접두가 같은 다른 id는 없지만 규약 밖 이름은 건드리지 않는다) */
export function renderCachePathsFor(attachmentId: string, listed: readonly string[]): string[] {
  const id = attachmentId.toLowerCase()
  const prefix = `${RENDER_CACHE_DIR}/`
  return listed.filter(
    p =>
      p.startsWith(prefix) &&
      renderCacheAttachmentId(p.slice(prefix.length)) === id &&
      isSafeBoardWorkPath(p)
  )
}

export type RenderCacheRemovalDeps = {
  /** 한 페이지 목록(`storage.ts` listObjectsPage — 접두는 `renderPrefixOf(id)`) */
  listPage: (
    prefix: string,
    cursor?: string
  ) => Promise<{ objects: { pathname: string }[]; cursor: string | null; hasMore: boolean }>
  /** 지우기(호출부가 저장소 계층으로 — 거기서도 경로를 다시 본다) */
  remove: (paths: string[]) => Promise<void>
  /** id 하나의 정리가 실패했을 때(던지지 않는다 — 로그만) */
  onError?: (id: string, error: unknown) => void
  /** id 하나에 훑는 페이지 수 상한 */
  maxPages?: number
}

/**
 * id(첨부 또는 이사회 서류)마다 미리보기 캐시(`board-work/renders/<id>-…`)를 목록으로 찾아 지운다. 지우는 키는
 * `renderCachePathsFor`를 지난 것뿐이다 — 다른 접두(`board-work/files/`·`board-documents/`·`backups/`)나 다른 id 의
 * 캐시는 목록에 섞여 와도 건드리지 않는다. 어떤 단계가 실패해도 던지지 않는다(`onError`) — 호출자의 삭제를 막지 않는다.
 * 지운 수.
 */
export async function removeRenderCachesWith(
  ids: readonly string[],
  deps: RenderCacheRemovalDeps
): Promise<number> {
  const maxPages = deps.maxPages ?? 20
  let removed = 0
  for (const id of ids) {
    try {
      const paths: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < maxPages; page++) {
        const res = await deps.listPage(renderPrefixOf(id), cursor)
        paths.push(
          ...renderCachePathsFor(
            id,
            res.objects.map(o => o.pathname)
          )
        )
        if (!res.hasMore || !res.cursor) break
        cursor = res.cursor
      }
      for (let i = 0; i < paths.length; i += 100) {
        await deps.remove(paths.slice(i, i + 100))
      }
      removed += paths.length
    } catch (e) {
      deps.onError?.(id, e)
    }
  }
  return removed
}

// ── 고아 객체(행 없이 저장소에만 남은 업로드) ────────────────────────────────

export const ORPHAN_SCAN_PREFIX = 'board-work/files/'
const THUMB_SUFFIX = '.thumb.webp'

export type OrphanSweepDeps = {
  /** 한 페이지 목록(`storage.ts` listObjectsPage — 접두 `board-work/files/`) */
  listPage: (cursor?: string) => Promise<{
    objects: { pathname: string; uploadedAt: Date }[]
    cursor: string | null
    hasMore: boolean
  }>
  /** 이 키들 중 아직 행(첨부·임시 업로드의 blob_path)이 가리키는 것 */
  findReferenced: (paths: string[]) => Promise<Set<string>>
  /** 지우기(호출부가 저장소 계층으로 — 거기서도 경로를 다시 본다) */
  remove: (paths: string[]) => Promise<void>
  now: Date
  /** 이보다 오래된 객체만 본다(업로드 중인 객체를 지우지 않게 — 원본 PENDING_RETENTION_HOURS) */
  retentionMs: number
  /** 한 번에 지우는 객체 수 상한 */
  maxRemovals?: number
  /** 훑는 페이지 수 상한 */
  maxPages?: number
  /** 이 시간(ms)이 지나면 새 페이지를 시작하지 않는다 */
  budgetMs?: number
  clock?: () => number
}

/**
 * 행이 없는 `board-work/files/` 객체를 지운다(원본 pending-orphans.ts). 행 기준 정리는 행이 있어야 객체를 찾는다 —
 * 행이 먼저 사라졌는데 객체가 남은 경우(행 삽입 뒤 업로드 실패 처리 중간 오류, 수동 정리 등)는 목록으로만 보인다.
 *
 * 지우는 조건(모두): 경로가 `isSafeBoardWorkPath`이고 `board-work/files/` 아래 · 올린 지 retention이 지남 ·
 * 그 키도, (썸네일이면) 원본 키도 어떤 행도 가리키지 않음. 썸네일 이름처럼 끝나는 **실제 파일**은 자기 키가 행에 있으니 지워지지 않는다.
 * 훑는 양·지우는 양에 상한을 둬 크론 시간 안에 끝낸다 — 남은 건 다음 실행이 이어서 한다.
 */
export async function sweepOrphanObjects(
  deps: OrphanSweepDeps
): Promise<{ scanned: number; removed: number; capped: boolean }> {
  const maxRemovals = deps.maxRemovals ?? 500
  const maxPages = deps.maxPages ?? 50
  const budgetMs = deps.budgetMs ?? 30_000
  const clock = deps.clock ?? Date.now
  const started = clock()
  const cutoff = deps.now.getTime() - deps.retentionMs

  let scanned = 0
  let removed = 0
  let capped = false
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= maxPages || removed >= maxRemovals || clock() - started >= budgetMs) {
      capped = true
      break
    }
    const res = await deps.listPage(cursor)
    const old: { path: string; base: string }[] = []
    for (const o of res.objects) {
      scanned++
      const path = o.pathname
      if (!path.startsWith(ORPHAN_SCAN_PREFIX) || !isSafeBoardWorkPath(path)) continue
      const at = o.uploadedAt.getTime()
      // 시각을 모르거나 아직 보존 기간 안이면 건드리지 않는다
      if (!Number.isFinite(at) || at >= cutoff) continue
      const base = path.endsWith(THUMB_SUFFIX) ? path.slice(0, -THUMB_SUFFIX.length) : path
      old.push({ path, base })
    }
    if (old.length > 0) {
      const referenced = await deps.findReferenced([...new Set(old.flatMap(o => [o.path, o.base]))])
      const orphans = old
        .filter(o => !referenced.has(o.path) && !referenced.has(o.base))
        .map(o => o.path)
        .slice(0, maxRemovals - removed)
      if (orphans.length > 0) {
        await deps.remove(orphans)
        removed += orphans.length
      }
    }
    if (!res.hasMore || !res.cursor) break
    cursor = res.cursor
  }
  return { scanned, removed, capped }
}
