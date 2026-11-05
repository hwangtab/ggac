import {
  claimPendingUploadRows,
  findReferencedBlobPaths,
  hardDeleteMessages,
  listParentsWithLiveReplies,
  listPurgeAttachments,
  listPurgeCandidates,
  listRootsWithLiveVersions,
  listStalePendingUploads,
  type PurgeCursor,
} from '@/db/queries/work/cleanup'
import { deleteStalePushSubscriptions } from '@/db/queries/work/push'
import { logAudit } from '@work/lib/audit/log'
import { draftLayoutPaths } from '@work/lib/files/doc-edit-draft'
import { PENDING_RETENTION_HOURS } from '@work/lib/files/schema'
import { listObjectsPage, removeObjects } from '@work/lib/files/storage'
import {
  ORPHAN_SCAN_PREFIX,
  pendingObjectPaths,
  purgeObjectPaths,
  removeRenderCachesWith,
  sweepOrphanObjects,
} from '@work/lib/files/cleanup-plan'
import { PURGE_AFTER_DAYS, PUSH_STALE_DAYS, daysAgo } from './retention'

/**
 * 정리 크론 본체 — 원본 kosmart-work `/api/internal/purge-pending-uploads`·`lib/files/pending-orphans.ts`·
 * `lib/digest/cleanup.ts`. 크론 라우트(`/api/internal/board-work/*`)가 CRON_SECRET을 확인한 뒤에만 부른다.
 *
 * 저장소: 업무툴 저장소 계층(`src/work/lib/files/storage.ts`)만 쓴다 — 토큰은 `BOARD_WORK_BLOB_READ_WRITE_TOKEN`(정의돼 있으면)
 * 또는 `PRIVATE_BLOB_READ_WRITE_TOKEN`. E2E는 앞의 것을 시험 저장소로 둔다(운영 저장소로 떨어지지 않는다).
 * 지울 키는 모두 `cleanup-plan.ts`가 `isSafeBoardWorkPath`로 거른 것이고, removeObjects가 한 번 더 본다.
 */

const PENDING_BATCH = 100
const PENDING_MAX_ROUNDS = 50

export type PendingPurgeResult = {
  purged: number
  objects: number
  unsafe: number
  orphans: { scanned: number; removed: number; capped: boolean } | null
  /** 행 기준 정리가 저장소·DB 오류로 중간에 멈췄다(남은 행은 다음 실행이 다시 시도한다) */
  error?: 'storage' | 'query'
}

/**
 * 메시지에 붙지 못한 채 24시간 지난 임시 업로드의 객체와 행을 지운다. 객체를 먼저 지우고 성공한 배치만 행을 지운다
 * (실패하면 행을 남겨 다음 실행이 다시 시도한다 — 객체가 행 없이 고아가 되지 않게). 이어서 행 없이 남은
 * `board-work/files/` 객체(고아)도 상한 안에서 지운다. 고아 정리 실패는 위 결과를 바꾸지 않는다.
 */
export async function purgeStalePendingUploads(
  now: Date = new Date()
): Promise<PendingPurgeResult> {
  const retentionMs = PENDING_RETENTION_HOURS * 3600 * 1000
  const cutoff = new Date(now.getTime() - retentionMs)
  const result: PendingPurgeResult = { purged: 0, objects: 0, unsafe: 0, orphans: null }

  for (let round = 0; round < PENDING_MAX_ROUNDS; round++) {
    let rows: Awaited<ReturnType<typeof listStalePendingUploads>>
    try {
      rows = await listStalePendingUploads(cutoff, PENDING_BATCH)
    } catch (e) {
      console.error('[purge-pending-uploads] 조회 실패:', e)
      return { ...result, error: 'query' }
    }
    if (rows.length === 0) break
    // 행을 **먼저** 지우고 실제로 지운 행의 객체만 지운다 — 그 사이 승격된 업로드(승격이 임시 행을 지운다)의 객체를 건드리지
    // 않는다(`discardPending`과 같은 이유, 2026-11-05 감사). 객체 삭제가 실패하면 고아 객체가 남고 아래 고아 청소가 치운다.
    let claimed: string[]
    try {
      claimed = await claimPendingUploadRows(rows.map(r => r.id))
    } catch (e) {
      console.error('[purge-pending-uploads] 행 삭제 실패:', e)
      return { ...result, error: 'query' }
    }
    result.purged += claimed.length
    const gone = new Set(claimed)
    const plan = pendingObjectPaths(
      rows.filter(r => gone.has(r.id)),
      draftLayoutPaths
    )
    if (plan.unsafe > 0) {
      // 행의 경로가 업무툴 규약 밖이다(손으로 넣은 행 등) — 그 객체는 건드리지 않는다
      console.error(
        `[purge-pending-uploads] 안전하지 않은 경로 ${plan.unsafe}건 — 객체 삭제 건너뜀`
      )
    }
    try {
      for (let i = 0; i < plan.paths.length; i += 100) {
        await removeObjects(plan.paths.slice(i, i + 100))
      }
    } catch (e) {
      console.error(
        '[purge-pending-uploads] 객체 삭제 실패(고아 청소가 정리):',
        e instanceof Error ? e.name : e
      )
    }
    result.objects += plan.paths.length
    result.unsafe += plan.unsafe
    if (rows.length < PENDING_BATCH) break
  }

  try {
    result.orphans = await sweepOrphanObjects({
      listPage: async cursor => {
        const page = await listObjectsPage(ORPHAN_SCAN_PREFIX, cursor)
        return { objects: page.objects, cursor: page.cursor, hasMore: page.hasMore }
      },
      findReferenced: findReferencedBlobPaths,
      remove: removeObjects,
      now,
      retentionMs,
    })
  } catch (e) {
    console.error('[purge-pending-uploads] 고아 객체 정리 실패:', e instanceof Error ? e.name : e)
  }
  return result
}

// ── 삭제된 메시지 영구 삭제(원본 purgeDeletedMessages) ─────────────────────────

const PURGE_BATCH = 200
/** 한 번의 실행에서 훑는 배치 수(= 최대 PURGE_MAX_ROUNDS × PURGE_BATCH 건). 남으면 다음 실행이 이어서 처리한다 */
export const PURGE_MAX_ROUNDS = 25

export type PurgeResult = {
  messagesDeleted: number
  objectsRemoved: number
  /** 살아 있는 답글이 달려 보존한 삭제 메시지 수 */
  keptForReplies: number
  /** 다른 버전이 살아 있는 문서 계보의 첨부라 보존한 삭제 메시지 수(원본 0035) */
  keptForLineage: number
  /** 경로가 업무툴 규약 밖이라 객체를 건드리지 않은 첨부 수 */
  unsafe: number
  /** 미리보기 캐시 삭제 수 */
  rendersRemoved: number
  /** 상한까지 돌았는데 하나도 못 지웠고 후보가 계속 가득 찼다(보존 대상이 앞을 막음) — 라우트가 5xx로 알린다 */
  stalled?: boolean
}

/**
 * deleted_at이 30일 지난 메시지를 영구 삭제하고 첨부 객체·썸네일·미리보기 캐시도 지운다(원본 규칙 그대로):
 *  - 살아 있는 답글이 있는 부모는 지우지 않는다(FK cascade로 답글이 같이 사라지므로).
 *  - 다른 버전이 살아 있는 문서 계보의 첨부를 가진 메시지도 지우지 않는다(0035).
 *  - 객체 삭제가 실패하면 그 배치의 DB 삭제를 건너뛴다(던진다) → 다음 실행에서 재시도(객체 고아화 방지).
 *  - (deleted_at, id) 커서로 앞 배치의 **남겨 둔 메시지를 건너뛰며** 최대 PURGE_MAX_ROUNDS 배치.
 */
export async function purgeDeletedMessages(now: Date = new Date()): Promise<PurgeResult> {
  const total: PurgeResult = {
    messagesDeleted: 0,
    objectsRemoved: 0,
    keptForReplies: 0,
    keptForLineage: 0,
    unsafe: 0,
    rendersRemoved: 0,
  }
  const before = daysAgo(now, PURGE_AFTER_DAYS)
  let cursor: PurgeCursor | null = null
  let lastFetched = 0
  let rounds = 0
  for (; rounds < PURGE_MAX_ROUNDS; rounds++) {
    const candidates = await listPurgeCandidates({ before, cursor, limit: PURGE_BATCH })
    lastFetched = candidates.length
    if (candidates.length === 0) {
      rounds++
      break
    }
    const tail = candidates[candidates.length - 1]
    await purgeBatch(
      candidates.map(c => c.id),
      total
    )
    if (candidates.length < PURGE_BATCH) {
      rounds++
      break
    }
    cursor = { deletedAt: tail.deletedAt, id: tail.id }
  }
  if (total.messagesDeleted === 0 && lastFetched >= PURGE_BATCH && rounds >= PURGE_MAX_ROUNDS) {
    total.stalled = true
    console.error(
      `[purge-deleted] 정체: ${rounds}개 배치를 훑었지만 지울 수 있는 메시지가 없습니다(보존 대상이 앞을 막음)`
    )
  }
  // 영구 삭제 요약을 감사 로그에 남긴다(본문·파일명 없이 건수만)
  if (total.messagesDeleted > 0) {
    await logAudit('system', 'retention.purge', null, {
      messages: total.messagesDeleted,
      objects: total.objectsRemoved,
    })
  }
  return total
}

async function purgeBatch(candidateIds: string[], total: PurgeResult): Promise<void> {
  const blocked = await listParentsWithLiveReplies(candidateIds)
  total.keptForReplies += blocked.size
  let ids = candidateIds.filter(id => !blocked.has(id))
  if (ids.length === 0) return

  const targets = await listPurgeAttachments(ids)
  const owners = new Set(targets.map(t => t.owner))
  const liveRoots = await listRootsWithLiveVersions([...new Set(targets.map(t => t.root))], owners)
  const keepTops = new Set(targets.filter(t => liveRoots.has(t.root)).map(t => t.top))
  if (keepTops.size > 0) {
    total.keptForLineage += keepTops.size
    ids = ids.filter(id => !keepTops.has(id))
    if (ids.length === 0) return
  }

  const plan = purgeObjectPaths(targets.filter(t => !keepTops.has(t.top)))
  if (plan.unsafe > 0) {
    console.error(`[purge-deleted] 안전하지 않은 첨부 경로 ${plan.unsafe}건 — 객체 삭제 건너뜀`)
    total.unsafe += plan.unsafe
  }
  for (let i = 0; i < plan.paths.length; i += 100) {
    // 실패하면 던진다 — 이 배치의 DB 삭제를 하지 않는다(다음 실행이 다시 시도)
    await removeObjects(plan.paths.slice(i, i + 100))
    total.objectsRemoved += Math.min(100, plan.paths.length - i)
  }
  total.rendersRemoved += await removeRenderCaches(plan.attachmentIds)
  total.messagesDeleted += await hardDeleteMessages(ids)
}

/**
 * 첨부들의 미리보기 캐시(`board-work/renders/<id>-*`)를 지운다. 어떤 단계가 실패해도 던지지 않는다(로그) —
 * 메시지 삭제를 막지 않는다. 지운 수.
 */
export async function removeRenderCaches(attachmentIds: readonly string[]): Promise<number> {
  return removeRenderCachesWith(attachmentIds, {
    listPage: listObjectsPage,
    remove: removeObjects,
    onError: (_id, e) =>
      console.error(
        '[purge-deleted] 미리보기 캐시 정리 실패(건너뜀):',
        e instanceof Error ? e.name : e
      ),
  })
}

/** last_seen_at이 90일 지난 푸시 구독 삭제(원본 cleanupStalePushSubscriptions) */
export async function cleanupStalePushSubscriptions(
  now: Date = new Date()
): Promise<{ removed: number }> {
  return { removed: await deleteStalePushSubscriptions(daysAgo(now, PUSH_STALE_DAYS)) }
}
