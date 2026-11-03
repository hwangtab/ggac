/**
 * 업무툴 정리 크론의 DB 부분 — 원본 kosmart-work `/api/internal/purge-pending-uploads`·`lib/files/pending-orphans.ts`·
 * `lib/digest/cleanup.ts`(purgeDeletedMessages)를 옮겼다(설계 §8-5).
 *
 * **권한을 모른다**(크론 라우트가 CRON_SECRET을 먼저 본다). 저장소 객체는 여기서 건드리지 않는다 — 어떤 경로를 지울지는
 * 호출부가 `isSafeBoardWorkPath`로 한 번 더 거른 뒤 저장소 계층(`src/work/lib/files/storage.ts`, 그 안에서 또 검사)이 지운다.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workAttachments, workMessages, workPendingUploads } from '../../schema/index.ts'

const IN_CHUNK = 200

function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── 임시 업로드 ───────────────────────────────────────────────────────────────

export type StalePendingRow = { id: string; blobPath: string; isDraft: boolean }

/** before보다 먼저 만든 임시 업로드(오래된 순, limit건) — 메시지에 붙지 못한 채 남은 것 */
export async function listStalePendingUploads(
  before: Date,
  limit: number
): Promise<StalePendingRow[]> {
  const rows = await db
    .select({
      id: workPendingUploads.id,
      blobPath: workPendingUploads.blobPath,
      draftMeta: workPendingUploads.draftMeta,
    })
    .from(workPendingUploads)
    .where(lt(workPendingUploads.createdAt, before))
    .orderBy(asc(workPendingUploads.createdAt), asc(workPendingUploads.id))
    .limit(limit)
  return rows.map(r => ({ id: r.id, blobPath: r.blobPath, isDraft: r.draftMeta != null }))
}

/** 임시 업로드 행 삭제(객체를 지운 뒤에만 부른다). 지운 행 수 */
export async function deletePendingUploadRows(ids: readonly string[]): Promise<number> {
  let n = 0
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await db
      .delete(workPendingUploads)
      .where(inArray(workPendingUploads.id, chunk))
      .returning({ id: workPendingUploads.id })
    n += rows.length
  }
  return n
}

/**
 * 주어진 객체 키 중 **아직 행이 가리키는 것**(첨부 또는 임시 업로드의 blob_path). 고아 판정의 반대편이다 —
 * 여기 나온 키는 절대 지우지 않는다.
 */
export async function findReferencedBlobPaths(paths: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const chunk of chunks([...new Set(paths)])) {
    const [atts, pend] = await Promise.all([
      db
        .select({ p: workAttachments.blobPath })
        .from(workAttachments)
        .where(inArray(workAttachments.blobPath, chunk)),
      db
        .select({ p: workPendingUploads.blobPath })
        .from(workPendingUploads)
        .where(inArray(workPendingUploads.blobPath, chunk)),
    ])
    for (const r of atts) out.add(r.p)
    for (const r of pend) out.add(r.p)
  }
  return out
}

// ── 삭제된 메시지 영구 삭제 ───────────────────────────────────────────────────

export type PurgeCursor = { deletedAt: Date; id: string }

/** deleted_at이 before보다 이른 메시지((deleted_at, id) 키셋 커서 뒤부터, 오래된 순) */
export async function listPurgeCandidates(input: {
  before: Date
  cursor: PurgeCursor | null
  limit: number
}): Promise<{ id: string; deletedAt: Date }[]> {
  const c = input.cursor
  const rows = await db
    .select({ id: workMessages.id, deletedAt: workMessages.deletedAt })
    .from(workMessages)
    .where(
      and(
        isNotNull(workMessages.deletedAt),
        lt(workMessages.deletedAt, input.before),
        c
          ? or(
              gt(workMessages.deletedAt, c.deletedAt),
              and(eq(workMessages.deletedAt, c.deletedAt), gt(workMessages.id, c.id))
            )
          : undefined
      )
    )
    .orderBy(asc(workMessages.deletedAt), asc(workMessages.id))
    .limit(input.limit)
  return rows.map(r => ({ id: r.id, deletedAt: r.deletedAt as Date }))
}

/** 살아 있는(지워지지 않은) 답글이 달린 부모 id — 부모를 지우면 FK cascade로 답글이 함께 사라지므로 남긴다 */
export async function listParentsWithLiveReplies(ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await db
      .selectDistinct({ parentId: workMessages.parentId })
      .from(workMessages)
      .where(and(inArray(workMessages.parentId, chunk), isNull(workMessages.deletedAt)))
    for (const r of rows) if (r.parentId) out.add(r.parentId)
  }
  return out
}

export type PurgeAttachment = {
  id: string
  blobPath: string
  /** 첨부가 달린 메시지 */
  owner: string
  /** 지울 최상위 메시지(답글의 첨부면 부모) */
  top: string
  /** 계보 키(version_root_id ?? id) */
  root: string
}

/** 지울 메시지들 + 그 답글(부모 삭제 시 cascade로 함께 사라지는 것)의 첨부 */
export async function listPurgeAttachments(topIds: readonly string[]): Promise<PurgeAttachment[]> {
  const out: PurgeAttachment[] = []
  for (const chunk of chunks([...new Set(topIds)])) {
    const replies = await db
      .select({ id: workMessages.id, parentId: workMessages.parentId })
      .from(workMessages)
      .where(inArray(workMessages.parentId, chunk))
    const topOf = new Map<string, string>(chunk.map(id => [id, id]))
    for (const r of replies) if (r.parentId) topOf.set(r.id, r.parentId)
    for (const owners of chunks([...topOf.keys()])) {
      const atts = await db
        .select({
          id: workAttachments.id,
          blobPath: workAttachments.blobPath,
          messageId: workAttachments.messageId,
          versionRootId: workAttachments.versionRootId,
        })
        .from(workAttachments)
        .where(inArray(workAttachments.messageId, owners))
      for (const a of atts) {
        out.push({
          id: a.id,
          blobPath: a.blobPath,
          owner: a.messageId,
          top: topOf.get(a.messageId) ?? a.messageId,
          root: a.versionRootId ?? a.id,
        })
      }
    }
  }
  return out
}

/**
 * 계보(root) 중 **지울 메시지 밖의 살아 있는 메시지**에 버전이 남아 있는 것(원본 0035) — 그 계보의 첨부를 가진 메시지는
 * 지우지 않는다(루트 첨부가 사라지면 계보가 분해된다). 돌려주는 값: 살아 있는 버전이 있는 root 집합.
 */
export async function listRootsWithLiveVersions(
  roots: readonly string[],
  excludeMessageIds: ReadonlySet<string>
): Promise<Set<string>> {
  const out = new Set<string>()
  for (const chunk of chunks([...new Set(roots)])) {
    const rows = await db
      .select({
        id: workAttachments.id,
        messageId: workAttachments.messageId,
        versionRootId: workAttachments.versionRootId,
      })
      .from(workAttachments)
      .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
      .where(
        and(
          or(inArray(workAttachments.id, chunk), inArray(workAttachments.versionRootId, chunk)),
          isNull(workMessages.deletedAt)
        )
      )
    for (const r of rows) {
      if (excludeMessageIds.has(r.messageId)) continue
      out.add(r.versionRootId ?? r.id)
    }
  }
  return out
}

/**
 * 메시지 영구 삭제(FK cascade — 답글·첨부 행·반응·멘션·고정·북마크·링크가 함께 지워진다).
 * **이미 소프트 삭제된 메시지만** 지운다(조건을 다시 건다 — 호출부가 틀린 id를 넘겨도 살아 있는 글은 지우지 않는다).
 */
export async function hardDeleteMessages(ids: readonly string[]): Promise<number> {
  let n = 0
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await db
      .delete(workMessages)
      .where(and(inArray(workMessages.id, chunk), isNotNull(workMessages.deletedAt)))
      .returning({ id: workMessages.id })
    n += rows.length
  }
  return n
}
