/**
 * 업무툴 문서 버전 쿼리 계층 — 원본 kosmart-work `work.file_lineages`(0032)와 첨부 버전 트리거(0032·0035·0039),
 * `file_lineage_versions` RPC(0035)를 옮겼다(설계 §5·§8-1).
 *
 * **권한을 모른다.** "이 사람이 이 파일을 고칠 수 있나"(편집 권한 — 채널 멤버·보관 아님·게시물 미삭제)는 호출부
 * (`src/work/lib/files/version-actions.ts`)가 판정한다. 읽기는 호출부가 계산한 읽기 범위를 받는다.
 *
 * 대신 원본 트리거가 지키던 **계보 정합성은 호출부와 무관하게 여기서, 한 트랜잭션 안에서** 지킨다:
 * - harden_attachments_write: 앞 버전은 같은 채널의 첨부여야 한다 · version_root_id·version_no 는 넘어온 값을 믿지
 *   않고 계산한다(root = coalesce(앞.root, 앞.id), 번호 = 계보 최대 + 1) · 앞 버전이 지금 계보의 최신(게시물이 살아
 *   있는 가장 높은 번호)이 아니면 거부(원본 P0409 → `conflict`) · 객체 키는 업무툴 파일 키 모양만 · 업로더 = 행위자
 * - 같은 계보·같은 번호 경합: 0028 유일 인덱스(work_attachments_lineage_version_uidx)가 잡고 `conflict`로 바꾼다
 * - recompute_attachment_latest: 첨부를 넣은 뒤 그 계보의 is_latest 를 다시 정한다(게시물 삭제 뒤 재계산은 messages.ts)
 * - 게시물과 첨부는 같은 트랜잭션에서 생긴다 — 원본은 게시물을 먼저 쓰고 실패하면 지웠다(여기서는 실패하면 둘 다 없다)
 * - 수정 중(체크아웃) 획득은 "비었거나·만료됐거나·내 것"일 때만(force 면 무조건) — 조건부 UPDATE 와 같은 판정을
 *   트랜잭션 안에서 한다
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  memberProfiles,
  workAttachments,
  workChannels,
  workFileLineages,
  workMessages,
  workPendingUploads,
} from '../../schema/index.ts'
import { isSafeBoardWorkPath } from '../../../lib/storage/boardWork.ts'

import {
  bumpChannelRev,
  isoNN,
  lineageKeySql,
  recomputeAttachmentLatest,
  WorkWriteError,
  type WorkExecutor,
} from './_shared.ts'
import { toAttachmentRecord, type ReadableScope, type WorkAttachmentRecord } from './files.ts'
import { insertUserMessageInTx } from './messages.ts'

const attachmentColumns = {
  id: workAttachments.id,
  messageId: workAttachments.messageId,
  channelId: workAttachments.channelId,
  uploaderId: workAttachments.uploaderId,
  blobPath: workAttachments.blobPath,
  name: workAttachments.name,
  mime: workAttachments.mime,
  size: workAttachments.size,
  width: workAttachments.width,
  height: workAttachments.height,
  createdAt: workAttachments.createdAt,
  folderPath: workAttachments.folderPath,
  previousAttachmentId: workAttachments.previousAttachmentId,
  versionRootId: workAttachments.versionRootId,
  versionNo: workAttachments.versionNo,
  isLatest: workAttachments.isLatest,
}

/** SQLite 유일성 위반(같은 계보·같은 번호 경합 등) */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 4; i++) {
    const msg = cur instanceof Error ? cur.message : String(cur)
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(msg)) return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

/** 편집 권한 판정 재료: 첨부 + 게시물 삭제 여부 + 채널(종류·주소·보관·게시 정책). 없으면 null */
export type AttachmentEditRecord = WorkAttachmentRecord & {
  message_deleted_at: string | null
  message_parent_id: string | null
  channel: {
    id: string
    kind: 'public' | 'private' | 'dm'
    slug: string | null
    archived_at: string | null
    post_policy: string
  }
}

export async function getAttachmentForEdit(id: string): Promise<AttachmentEditRecord | null> {
  const [r] = await db
    .select({
      ...attachmentColumns,
      messageDeletedAt: workMessages.deletedAt,
      messageParentId: workMessages.parentId,
      chKind: workChannels.kind,
      chSlug: workChannels.slug,
      chArchivedAt: workChannels.archivedAt,
      chPostPolicy: workChannels.postPolicy,
    })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .innerJoin(workChannels, eq(workChannels.id, workAttachments.channelId))
    .where(eq(workAttachments.id, id))
    .limit(1)
  if (!r) return null
  return {
    ...toAttachmentRecord(r),
    message_deleted_at: r.messageDeletedAt ? r.messageDeletedAt.toISOString() : null,
    message_parent_id: r.messageParentId,
    channel: {
      id: r.channelId,
      kind: r.chKind === 'private' || r.chKind === 'dm' ? r.chKind : 'public',
      slug: r.chSlug,
      archived_at: r.chArchivedAt ? r.chArchivedAt.toISOString() : null,
      post_policy: r.chPostPolicy,
    },
  }
}

export type LineageVersionRecord = {
  id: string
  channel_id: string
  message_id: string
  version_no: number
  name: string
  mime: string
  size: number
  created_at: string
  folder_path: string | null
  is_latest: boolean
  version_root_id: string | null
  uploader_id: string | null
  uploader_name: string | null
  /** 게시물이 지워졌다(원본 message_deleted) */
  message_deleted: boolean
}

/**
 * 원본 file_lineage_versions(0035): 계보 전체(지워진 게시물의 버전 포함) — 번호 큰 순.
 * `anchorId`는 계보의 아무 첨부. 그 채널을 읽을 수 없으면(`readable` 밖) 빈 목록.
 */
export async function listLineageVersions(
  anchorId: string,
  readable: ReadableScope
): Promise<LineageVersionRecord[]> {
  const [anchor] = await db
    .select({ root: sql<string>`${lineageKeySql}`, channelId: workAttachments.channelId })
    .from(workAttachments)
    .where(eq(workAttachments.id, anchorId))
    .limit(1)
  if (!anchor || !readable.has(anchor.channelId)) return []
  const rows = await db
    .select({
      ...attachmentColumns,
      uploaderName: memberProfiles.displayName,
      messageDeletedAt: workMessages.deletedAt,
    })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workAttachments.uploaderId))
    .where(sql`${lineageKeySql} = ${anchor.root}`)
    .orderBy(desc(workAttachments.versionNo))
  return rows.map(r => ({
    id: r.id,
    channel_id: r.channelId,
    message_id: r.messageId,
    version_no: r.versionNo,
    name: r.name,
    mime: r.mime,
    size: r.size,
    created_at: isoNN(r.createdAt),
    folder_path: r.folderPath,
    is_latest: r.isLatest,
    version_root_id: r.versionRootId,
    uploader_id: r.uploaderId,
    uploader_name: r.uploaderId ? r.uploaderName?.trim() || '이름 없음' : null,
    message_deleted: r.messageDeletedAt !== null,
  }))
}

export type FileLineageRecord = {
  root_attachment_id: string
  channel_id: string
  final_attachment_id: string | null
  final_marked_by: string | null
  final_marked_at: string | null
  checkout_user_id: string | null
  checkout_user_name: string | null
  checkout_at: string | null
  checkout_until: string | null
}

/** 계보 행(없으면 null). 수정 중인 사람 이름을 함께 */
export async function getFileLineage(rootId: string): Promise<FileLineageRecord | null> {
  const [r] = await db
    .select({
      root: workFileLineages.rootAttachmentId,
      channelId: workFileLineages.channelId,
      finalId: workFileLineages.finalAttachmentId,
      finalBy: workFileLineages.finalMarkedBy,
      finalAt: workFileLineages.finalMarkedAt,
      checkoutUserId: workFileLineages.checkoutUserId,
      checkoutAt: workFileLineages.checkoutAt,
      checkoutUntil: workFileLineages.checkoutUntil,
      holderName: memberProfiles.displayName,
    })
    .from(workFileLineages)
    .leftJoin(memberProfiles, eq(memberProfiles.id, workFileLineages.checkoutUserId))
    .where(eq(workFileLineages.rootAttachmentId, rootId))
    .limit(1)
  if (!r) return null
  return {
    root_attachment_id: r.root,
    channel_id: r.channelId,
    final_attachment_id: r.finalId,
    final_marked_by: r.finalBy,
    final_marked_at: r.finalAt ? r.finalAt.toISOString() : null,
    checkout_user_id: r.checkoutUserId,
    checkout_user_name: r.checkoutUserId ? r.holderName?.trim() || '이름 없음' : null,
    checkout_at: r.checkoutAt ? r.checkoutAt.toISOString() : null,
    checkout_until: r.checkoutUntil ? r.checkoutUntil.toISOString() : null,
  }
}

/**
 * 원본 listMyCheckouts: 아직 유효한 내 수정 중(가져간 순, 최근 먼저) + 그 계보의 최신 버전(게시물이 살아 있는 것).
 * 읽을 수 없는 채널의 계보는 뺀다.
 */
export async function listMyCheckoutRecords(
  userId: string,
  now: Date,
  readable: ReadableScope
): Promise<
  {
    rootId: string
    attachmentId: string
    name: string
    channelId: string
    channelName: string
    since: string
    until: string
  }[]
> {
  const lineages = await db
    .select({
      root: workFileLineages.rootAttachmentId,
      channelId: workFileLineages.channelId,
      at: workFileLineages.checkoutAt,
      until: workFileLineages.checkoutUntil,
    })
    .from(workFileLineages)
    .where(
      and(eq(workFileLineages.checkoutUserId, userId), gt(workFileLineages.checkoutUntil, now))
    )
    .orderBy(desc(workFileLineages.checkoutAt))
  const visible = lineages.filter(l => readable.has(l.channelId))
  if (visible.length === 0) return []
  const roots = visible.map(l => l.root)
  const latestRows = await db
    .select({
      id: workAttachments.id,
      name: workAttachments.name,
      root: sql<string>`${lineageKeySql}`,
      channelName: workChannels.name,
    })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .innerJoin(workChannels, eq(workChannels.id, workAttachments.channelId))
    .where(
      and(
        sql`${lineageKeySql} in (${sql.join(
          roots.map(r => sql`${r}`),
          sql`, `
        )})`,
        eq(workAttachments.isLatest, true),
        isNull(workMessages.deletedAt)
      )
    )
  const byRoot = new Map(latestRows.map(r => [r.root, r]))
  const out = []
  for (const l of visible) {
    const latest = byRoot.get(l.root)
    if (!latest || !l.until) continue
    out.push({
      rootId: l.root,
      attachmentId: latest.id,
      name: latest.name,
      channelId: l.channelId,
      channelName: latest.channelName,
      since: (l.at ?? l.until).toISOString(),
      until: l.until.toISOString(),
    })
  }
  return out
}

/**
 * 버전 게시물을 달 부모(원본 resolveVersionParent) — 계보 v1 의 게시물(그게 답글이면 그 부모). 지워졌으면 null.
 */
export async function resolveVersionParentId(rootId: string): Promise<string | null> {
  const [r] = await db
    .select({
      id: workMessages.id,
      parentId: workMessages.parentId,
      deletedAt: workMessages.deletedAt,
    })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(eq(workAttachments.id, rootId))
    .limit(1)
  if (!r || r.deletedAt) return null
  return r.parentId ?? r.id
}

/**
 * 원본 resolveLatestLiveVersionParent — v1 게시물을 쓸 수 없을 때, 같은 계보에서 살아 있는 가장 최근 버전 게시물의
 * 스레드 맨 위 글(살아 있고 최상위여야 한다). 없으면 null.
 */
export async function resolveLatestLiveVersionParentId(
  lineageIds: readonly string[]
): Promise<string | null> {
  if (lineageIds.length === 0) return null
  const rows = await db
    .select({ id: workMessages.id, parentId: workMessages.parentId })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(and(inArray(workAttachments.id, [...lineageIds]), isNull(workMessages.deletedAt)))
    .orderBy(desc(workAttachments.versionNo))
  const candidates = rows.map(m => m.parentId ?? m.id)
  if (candidates.length === 0) return null
  const roots = await db
    .select({ id: workMessages.id })
    .from(workMessages)
    .where(
      and(
        inArray(workMessages.id, [...new Set(candidates)]),
        isNull(workMessages.deletedAt),
        isNull(workMessages.parentId)
      )
    )
  const alive = new Set(roots.map(r => r.id))
  return candidates.find(id => alive.has(id)) ?? null
}

/**
 * 한 채널의 첨부들(id 목록, 지워진 게시물의 것도 삭제 표시와 함께) — 파일 탭의 옛 `config.history`(계보 백필 전 데이터)용.
 * 그 채널을 읽을 수 없으면 빈 목록.
 */
export async function listChannelAttachmentsByIds(
  ids: readonly string[],
  channelId: string,
  readable: ReadableScope
): Promise<(WorkAttachmentRecord & { message_deleted: boolean })[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0 || !readable.has(channelId)) return []
  const rows = await db
    .select({ ...attachmentColumns, messageDeletedAt: workMessages.deletedAt })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(and(eq(workAttachments.channelId, channelId), inArray(workAttachments.id, unique)))
  return rows.map(r => ({ ...toAttachmentRecord(r), message_deleted: r.messageDeletedAt !== null }))
}

/**
 * 같은 게시물 id 로 이미 만들어진 내 첨부(새 문서·사본 재시도의 멱등 확인) — 게시물이 내 것·같은 채널일 때만 그 첫 첨부.
 */
export async function findOwnMessageAttachment(
  messageId: string,
  authorId: string,
  channelId: string
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: workAttachments.id, name: workAttachments.name })
    .from(workMessages)
    .innerJoin(workAttachments, eq(workAttachments.messageId, workMessages.id))
    .where(
      and(
        eq(workMessages.id, messageId),
        eq(workMessages.authorId, authorId),
        eq(workMessages.channelId, channelId)
      )
    )
    .orderBy(asc(workAttachments.createdAt))
    .limit(1)
  return row ?? null
}

// ── 수정 중(체크아웃)·최종본 ──────────────────────────────────────────────────

export type CheckoutAcquireResult =
  | { status: 'acquired'; previousHolder: string | null; previousUntil: string | null }
  | { status: 'held'; holderId: string; holderName: string | null; since: string }

/**
 * 원본 checkoutFile 의 쓰기: 계보 행이 없으면 만들고, "비었거나·만료됐거나·내 것"이면(force 면 무조건) 나·지금·until 로
 * 잡는다. 남이 유효하게 잡고 있으면 held. 판정과 쓰기가 한 트랜잭션이라 둘이 동시에 잡아도 한쪽만 acquired 다.
 * `channelId`는 계보 루트 첨부의 채널이어야 한다(호출부가 루트에서 읽은 값) — 아니면 invalid_target.
 */
export async function acquireCheckout(input: {
  rootId: string
  channelId: string
  userId: string
  now: Date
  until: Date
  force: boolean
}): Promise<CheckoutAcquireResult> {
  return db.transaction(async tx => {
    const [root] = await tx
      .select({
        channelId: workAttachments.channelId,
        versionRootId: workAttachments.versionRootId,
      })
      .from(workAttachments)
      .where(eq(workAttachments.id, input.rootId))
      .limit(1)
    if (!root) throw new WorkWriteError('not_found', '파일이 없습니다')
    if (root.versionRootId !== null || root.channelId !== input.channelId) {
      throw new WorkWriteError('invalid_target', '계보의 첫 버전이 아닙니다')
    }
    const [cur] = await tx
      .select({
        userId: workFileLineages.checkoutUserId,
        at: workFileLineages.checkoutAt,
        until: workFileLineages.checkoutUntil,
        holderName: memberProfiles.displayName,
      })
      .from(workFileLineages)
      .leftJoin(memberProfiles, eq(memberProfiles.id, workFileLineages.checkoutUserId))
      .where(eq(workFileLineages.rootAttachmentId, input.rootId))
      .limit(1)
    const active =
      cur?.userId != null && cur.until != null && cur.until.getTime() > input.now.getTime()
    if (active && cur.userId !== input.userId && !input.force) {
      return {
        status: 'held',
        holderId: cur.userId,
        holderName: cur.holderName?.trim() || null,
        since: (cur.at ?? input.now).toISOString(),
      } as const
    }
    const mine = {
      checkoutUserId: input.userId,
      checkoutAt: input.now,
      checkoutUntil: input.until,
      updatedAt: input.now,
    }
    if (cur) {
      await tx
        .update(workFileLineages)
        .set(mine)
        .where(eq(workFileLineages.rootAttachmentId, input.rootId))
    } else {
      await tx
        .insert(workFileLineages)
        .values({ rootAttachmentId: input.rootId, channelId: input.channelId, ...mine })
    }
    return {
      status: 'acquired',
      previousHolder: active ? cur.userId : null,
      previousUntil: active && cur.until ? cur.until.toISOString() : null,
    } as const
  })
}

/**
 * 수정 중 해제 — **지금 보유자가 `holderId`일 때만** 비운다(원본 `.eq('checkout_user_id', …)`). 바뀐 행이 있으면 true.
 * 누가 해제할 수 있는지(본인·관리자)는 호출부 판정이다.
 */
export async function clearCheckout(rootId: string, holderId: string): Promise<boolean> {
  const rows = await db
    .update(workFileLineages)
    .set({ checkoutUserId: null, checkoutAt: null, checkoutUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(workFileLineages.rootAttachmentId, rootId),
        eq(workFileLineages.checkoutUserId, holderId)
      )
    )
    .returning({ root: workFileLineages.rootAttachmentId })
  return rows.length > 0
}

/**
 * 최종본 지정 — 지정할 첨부가 그 계보에 속해야 한다(데이터 규칙). 계보 행이 없으면 만든다.
 * `channelId`는 계보 루트의 채널이어야 한다.
 */
export async function setFinalVersion(input: {
  rootId: string
  channelId: string
  attachmentId: string
  markedBy: string
}): Promise<void> {
  await db.transaction(async tx => {
    const [att] = await tx
      .select({ root: sql<string>`${lineageKeySql}`, channelId: workAttachments.channelId })
      .from(workAttachments)
      .where(eq(workAttachments.id, input.attachmentId))
      .limit(1)
    if (!att) throw new WorkWriteError('not_found', '파일이 없습니다')
    if (att.root !== input.rootId || att.channelId !== input.channelId) {
      throw new WorkWriteError('invalid_target', '이 계보의 버전이 아닙니다')
    }
    const now = new Date()
    await tx
      .insert(workFileLineages)
      .values({
        rootAttachmentId: input.rootId,
        channelId: input.channelId,
        finalAttachmentId: input.attachmentId,
        finalMarkedBy: input.markedBy,
        finalMarkedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workFileLineages.rootAttachmentId,
        set: {
          finalAttachmentId: input.attachmentId,
          finalMarkedBy: input.markedBy,
          finalMarkedAt: now,
          updatedAt: now,
        },
      })
  })
}

/** 최종본 해제(계보 행이 없으면 아무것도 안 한다) */
export async function clearFinalVersion(rootId: string): Promise<void> {
  await db
    .update(workFileLineages)
    .set({
      finalAttachmentId: null,
      finalMarkedBy: null,
      finalMarkedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(workFileLineages.rootAttachmentId, rootId))
}

// ── 게시물 + 첨부(버전·새 문서·사본) ──────────────────────────────────────────

/** 첨부가 될 객체 */
export type CommitSource =
  /** 내 임시 업로드를 승격한다(키는 그대로). `allowDraft`면 문서 편집 초안(draft_meta)도 받는다 */
  | {
      kind: 'pending'
      uploadId: string
      allowDraft: boolean
      /** 저장소 `head()`가 확인한 실제 크기 */
      size: number
      width?: number | null
      height?: number | null
      /** 표시 이름을 바꿀 때(새 문서 이름 정리) */
      name?: string
    }
  /** 서버가 이미 복사해 둔 객체(되돌리기·사본) */
  | {
      kind: 'copy'
      blobPath: string
      name: string
      mime: string
      size: number
      width: number | null
      height: number | null
    }

export type CommitFileMessageInput = {
  actorId: string
  message: {
    /** 게시물 id(새 문서·사본은 클라이언트가 만든 id — 같은 id 재시도는 멱등) */
    id: string
    channelId: string
    parentId: string | null
    /** 공지 채널 최상위 글을 쓸 수 있나(채널 owner·업무툴 관리자 — 호출부 판정) */
    canPostRestricted: boolean
    /** 실제 버전 번호가 정해진 뒤 본문을 만든다(경합으로 번호가 예상과 달라도 본문이 맞는다) */
    body: (versionNo: number) => string
  }
  source: CommitSource
  /** 새 버전이면 앞 버전(=호출부가 본 계보 최신). 없으면 v1(계보 없음) */
  previousAttachmentId?: string | null
  folderPath?: string | null
  /** 저장한 사람의 수정 중 표시를 같은 트랜잭션에서 푼다(원본 clearMyCheckout) */
  clearOwnCheckout?: boolean
}

export type CommitFileMessageResult =
  | { status: 'created'; attachment: WorkAttachmentRecord; messageId: string }
  /** 같은 게시물 id 가 이미 있다(내 것·같은 채널) — 그때 만든 첨부(없으면 null) */
  | { status: 'duplicate'; attachment: { id: string; name: string } | null; messageId: string }

/**
 * 게시물 + 첨부를 한 트랜잭션으로 만든다(원본 postVersionMessage → promoteOne / restoreFileVersion / createDocument /
 * copyAsNewDocument / saveDraftAsNewFile 의 DB 부분 + harden_attachments_write + recompute_attachment_latest).
 *
 * 던지는 WorkWriteError:
 *   conflict        같은 계보에 다른 사람이 먼저 새 버전을 저장했다(앞 버전이 최신이 아님 · 번호 경합) · 같은 게시물 id 가 남의 것
 *   invalid_target  앞 버전이 다른 채널이다 · 임시 업로드가 다른 채널 것이다
 *   not_found       임시 업로드가 없다(이미 승격·삭제·남의 것) · 앞 버전이 없다 · 채널이 없다
 *   invalid         객체 키가 업무툴 파일 키 모양이 아니다
 *   forbidden / archived / owners_only / invalid_parent   게시물 규칙(insertUserMessageInTx)
 * 실패하면 아무것도 남지 않는다(임시 업로드 행도 그대로 — 같은 업로드로 다시 저장할 수 있다).
 */
export async function commitFileMessage(
  input: CommitFileMessageInput
): Promise<CommitFileMessageResult> {
  try {
    return await db.transaction(tx => commitInTx(tx, input))
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new WorkWriteError('conflict', '다른 사람이 먼저 새 버전을 저장했습니다')
    }
    throw e
  }
}

async function commitInTx(
  tx: WorkExecutor,
  input: CommitFileMessageInput
): Promise<CommitFileMessageResult> {
  const { message } = input
  // 같은 게시물 id(재시도·더블클릭) — 내 것·같은 채널이면 그때 결과, 아니면 충돌
  const [existing] = await tx
    .select({ authorId: workMessages.authorId, channelId: workMessages.channelId })
    .from(workMessages)
    .where(eq(workMessages.id, message.id))
    .limit(1)
  if (existing) {
    if (existing.authorId !== input.actorId || existing.channelId !== message.channelId) {
      throw new WorkWriteError('conflict', '같은 id 의 게시물이 이미 있습니다')
    }
    const [att] = await tx
      .select({ id: workAttachments.id, name: workAttachments.name })
      .from(workAttachments)
      .where(eq(workAttachments.messageId, message.id))
      .orderBy(asc(workAttachments.createdAt))
      .limit(1)
    return { status: 'duplicate', attachment: att ?? null, messageId: message.id }
  }

  // 1. 객체 — 임시 업로드(내 것·같은 채널) 또는 서버가 복사해 둔 키
  let object: {
    blobPath: string
    name: string
    mime: string
    size: number
    width: number | null
    height: number | null
  }
  let pendingId: string | null = null
  if (input.source.kind === 'pending') {
    const src = input.source
    const [pending] = await tx
      .select()
      .from(workPendingUploads)
      .where(
        and(
          eq(workPendingUploads.id, src.uploadId),
          eq(workPendingUploads.uploaderId, input.actorId),
          src.allowDraft ? undefined : isNull(workPendingUploads.draftMeta)
        )
      )
      .limit(1)
    if (!pending) throw new WorkWriteError('not_found', '업로드 정보를 찾을 수 없습니다')
    if (pending.channelId !== message.channelId) {
      throw new WorkWriteError('invalid_target', '다른 채널의 업로드입니다')
    }
    pendingId = pending.id
    object = {
      blobPath: pending.blobPath,
      name: src.name ?? pending.name,
      mime: pending.mime,
      size: src.size,
      width: src.width ?? null,
      height: src.height ?? null,
    }
  } else {
    object = { ...input.source }
  }
  // 원본 0039 경로 규약 자리: 업무툴 파일 키(`board-work/files/<uuid>/<안전 이름>`)만
  if (!isSafeBoardWorkPath(object.blobPath) || !object.blobPath.startsWith('board-work/files/')) {
    throw new WorkWriteError('invalid', '첨부 경로가 규약과 다릅니다')
  }

  // 2. 계보 — 넘어온 번호를 믿지 않고 계산한다
  let versionRootId: string | null = null
  let versionNo = 1
  const previousId = input.previousAttachmentId ?? null
  if (previousId) {
    const [prev] = await tx
      .select({
        channelId: workAttachments.channelId,
        root: sql<string>`${lineageKeySql}`,
      })
      .from(workAttachments)
      .where(eq(workAttachments.id, previousId))
      .limit(1)
    if (!prev) throw new WorkWriteError('not_found', '이전 버전이 없습니다')
    if (prev.channelId !== message.channelId) {
      throw new WorkWriteError(
        'invalid_target',
        '같은 채널의 파일만 이전 버전으로 이을 수 있습니다'
      )
    }
    // 낙관적 충돌(원본 P0409): 앞 버전이 지금 계보의 최신(게시물이 살아 있는 가장 높은 번호)이어야 한다
    const [latest] = await tx
      .select({ id: workAttachments.id })
      .from(workAttachments)
      .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
      .where(and(sql`${lineageKeySql} = ${prev.root}`, isNull(workMessages.deletedAt)))
      .orderBy(desc(workAttachments.versionNo))
      .limit(1)
    if (latest && latest.id !== previousId) {
      throw new WorkWriteError('conflict', '다른 사람이 먼저 새 버전을 저장했습니다')
    }
    const [max] = await tx
      .select({ n: sql<number>`coalesce(max(${workAttachments.versionNo}), 0)` })
      .from(workAttachments)
      .where(sql`${lineageKeySql} = ${prev.root}`)
    versionRootId = prev.root
    versionNo = Number(max?.n ?? 0) + 1
  }

  // 3. 게시물(작성자 = 행위자, 멤버·보관·공지 채널·스레드 규칙) → 첨부
  await insertUserMessageInTx(tx, {
    id: message.id,
    channelId: message.channelId,
    authorId: input.actorId,
    body: message.body(versionNo),
    parentId: message.parentId,
    canPostRestricted: message.canPostRestricted,
  })
  if (pendingId) await tx.delete(workPendingUploads).where(eq(workPendingUploads.id, pendingId))
  const [row] = await tx
    .insert(workAttachments)
    .values({
      id: crypto.randomUUID(),
      messageId: message.id,
      channelId: message.channelId,
      uploaderId: input.actorId,
      blobPath: object.blobPath,
      name: object.name,
      mime: object.mime,
      size: object.size,
      width: object.width,
      height: object.height,
      folderPath: input.folderPath ?? null,
      previousAttachmentId: previousId,
      versionRootId,
      versionNo,
      isLatest: true,
    })
    .returning(attachmentColumns)
  await recomputeAttachmentLatest(tx, versionRootId ?? row.id)

  // 4. 첨부 수·폴링 커서(다른 화면이 새 게시물·첨부를 다시 읽는다)
  const rev = await bumpChannelRev(tx, message.channelId)
  await tx
    .update(workMessages)
    .set({
      attachmentsCount: sql`(select count(*) from ${workAttachments} where ${workAttachments.messageId} = ${message.id})`,
      rev,
    })
    .where(eq(workMessages.id, message.id))

  if (input.clearOwnCheckout && versionRootId) {
    await tx
      .update(workFileLineages)
      .set({ checkoutUserId: null, checkoutAt: null, checkoutUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(workFileLineages.rootAttachmentId, versionRootId),
          eq(workFileLineages.checkoutUserId, input.actorId)
        )
      )
  }

  const [fresh] = await tx
    .select(attachmentColumns)
    .from(workAttachments)
    .where(eq(workAttachments.id, row.id))
    .limit(1)
  return { status: 'created', attachment: toAttachmentRecord(fresh), messageId: message.id }
}

// ── 문서 편집 초안(draft_meta) ───────────────────────────────────────────────

/** 초안 임시 업로드 행을 만든다(원본 doc-edit-draft 의 pending INSERT). 상한을 같은 트랜잭션에서 다시 센다 */
export async function insertDraftPendingUpload(
  row: {
    id: string
    channelId: string
    uploaderId: string
    blobPath: string
    name: string
    mime: string
    size: number
    draftMeta: unknown
  },
  opts: { maxPerUser: number }
): Promise<boolean> {
  if (!isSafeBoardWorkPath(row.blobPath) || !row.blobPath.startsWith('board-work/files/')) {
    throw new WorkWriteError('invalid', '초안 경로가 규약과 다릅니다')
  }
  return db.transaction(async tx => {
    const [n] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(workPendingUploads)
      .where(eq(workPendingUploads.uploaderId, row.uploaderId))
    if (Number(n?.n ?? 0) + 1 > opts.maxPerUser) return false
    await tx.insert(workPendingUploads).values(row)
    return true
  })
}

/** 내 임시 업로드에 초안 메타를 적는다(검증 결과 — 편집기 저장본). 바뀐 행이 있으면 true */
export async function setPendingDraftMeta(
  uploadId: string,
  uploaderId: string,
  draftMeta: unknown
): Promise<boolean> {
  const rows = await db
    .update(workPendingUploads)
    .set({ draftMeta })
    .where(and(eq(workPendingUploads.id, uploadId), eq(workPendingUploads.uploaderId, uploaderId)))
    .returning({ id: workPendingUploads.id })
  return rows.length > 0
}
