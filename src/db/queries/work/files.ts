/**
 * 업무툴 파일 쿼리 계층 — 원본 kosmart-work `work.pending_uploads`·`work.attachments`와 그 트리거·RPC를 옮겼다
 * (설계 §4·§5·§7). 원본 `lib/files/{actions,promote,queries,channel-files}.ts`가 RLS 클라이언트·service_role로
 * 하던 읽기·쓰기의 DB 부분이다.
 *
 * **권한을 모른다.** 읽기는 호출부가 계산한 읽기 범위(`readable` — 원본 readable_channel_ids)를 받아 WHERE에 넣는다
 * (원본 RLS `attachments_select` = can_read_channel). 업로드 자격(채널 멤버인가)은 호출부가 판정한다.
 *
 * 대신 원본 트리거가 지키던 **정합성**은 호출부와 무관하게 여기서 지킨다(같은 db.transaction 안):
 * - harden_attachments_write: 업로더 = 행위자, 채널 = 메시지의 채널, 지워진 메시지·보관 채널에는 붙이지 않는다,
 *   새 첨부는 v1(버전 열은 3단계가 채운다)
 * - 첨부 수(원본 attachments_count 트리거)를 다시 세고, 폴링 커서(§6)를 올려 다른 화면이 첨부를 다시 읽게 한다
 * - 임시 업로드는 본인 것·같은 채널·문서 초안 아님(draft_meta null)일 때만 승격하고, 승격과 같은 트랜잭션에서 지운다
 *   (같은 업로드가 두 메시지에 붙지 않는다)
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  memberProfiles,
  workAttachments,
  workChannels,
  workMessageLinks,
  workMessages,
  workPendingUploads,
} from '../../schema/index.ts'

import { bumpChannelRev, chunks, isoNN, WorkWriteError } from './_shared.ts'

export type ReadableScope = ReadonlySet<string>

/** 원본 `work.attachments` Row 모양(snake_case·ISO). `bucket_path`는 원본 열 이름 그대로 두고 Blob 키를 담는다 */
export type WorkAttachmentRecord = {
  id: string
  message_id: string
  channel_id: string
  uploader_id: string | null
  bucket_path: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  created_at: string
  folder_path: string | null
  previous_attachment_id: string | null
  version_root_id: string | null
  version_no: number
  is_latest: boolean
}

export type WorkPendingUploadRecord = {
  id: string
  channelId: string
  uploaderId: string
  blobPath: string
  name: string
  mime: string
  size: number
  draftMeta: unknown
  createdAt: Date
}

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

type AttachmentSelect = {
  id: string
  messageId: string
  channelId: string
  uploaderId: string | null
  blobPath: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  createdAt: Date
  folderPath: string | null
  previousAttachmentId: string | null
  versionRootId: string | null
  versionNo: number
  isLatest: boolean
}

export function toAttachmentRecord(r: AttachmentSelect): WorkAttachmentRecord {
  return {
    id: r.id,
    message_id: r.messageId,
    channel_id: r.channelId,
    uploader_id: r.uploaderId,
    bucket_path: r.blobPath,
    name: r.name,
    mime: r.mime,
    size: r.size,
    width: r.width,
    height: r.height,
    created_at: isoNN(r.createdAt),
    folder_path: r.folderPath,
    previous_attachment_id: r.previousAttachmentId,
    version_root_id: r.versionRootId,
    version_no: r.versionNo,
    is_latest: r.isLatest,
  }
}

/** 읽기 범위가 비면 거짓 조건(빈 IN 대신) */
function inReadable(readable: ReadableScope) {
  const ids = [...readable]
  return ids.length > 0 ? inArray(workAttachments.channelId, ids) : sql`0`
}

// ── 임시 업로드 ──────────────────────────────────────────────────────────────

/** 한 사용자의 임시 업로드 수(원본 MAX_PENDING_PER_USER 검사) */
export async function countPendingUploads(uploaderId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(workPendingUploads)
    .where(eq(workPendingUploads.uploaderId, uploaderId))
  return Number(row?.n ?? 0)
}

export type NewPendingUpload = {
  id: string
  channelId: string
  uploaderId: string
  blobPath: string
  name: string
  mime: string
  size: number
}

/**
 * 임시 업로드 행을 만든다. 상한(`maxPerUser`)을 **같은 트랜잭션 안에서** 다시 세어 넘으면 넣지 않는다
 * (원본은 넣은 뒤 다시 세어 되돌렸다 — 동시 호출 둘이 사전 검사를 함께 통과하는 경합 대비). 넘으면 false.
 */
export async function insertPendingUploads(
  rows: readonly NewPendingUpload[],
  opts: { maxPerUser: number }
): Promise<boolean> {
  if (rows.length === 0) return true
  const uploaderIds = new Set(rows.map(r => r.uploaderId))
  if (uploaderIds.size !== 1) throw new WorkWriteError('forbidden', '업로더가 한 명이어야 합니다')
  const [uploaderId] = [...uploaderIds]
  return db.transaction(async tx => {
    const [row] = await tx
      .select({ n: count() })
      .from(workPendingUploads)
      .where(eq(workPendingUploads.uploaderId, uploaderId))
    if (Number(row?.n ?? 0) + rows.length > opts.maxPerUser) return false
    await tx.insert(workPendingUploads).values(rows.map(r => ({ ...r, draftMeta: null })))
    return true
  })
}

/** 본인의 임시 업로드(요청 id 중 있는 것만). 초안(draft_meta)은 `includeDrafts`일 때만 */
export async function getPendingUploads(
  ids: readonly string[],
  uploaderId: string,
  opts: { includeDrafts?: boolean } = {}
): Promise<WorkPendingUploadRecord[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const rows = await db
    .select()
    .from(workPendingUploads)
    .where(
      and(
        inArray(workPendingUploads.id, unique),
        eq(workPendingUploads.uploaderId, uploaderId),
        opts.includeDrafts ? undefined : isNull(workPendingUploads.draftMeta)
      )
    )
  return rows as WorkPendingUploadRecord[]
}

/** 임시 업로드 1건(업로드 토큰 라우트 — 본인 것만). 없으면 null */
export async function getPendingUpload(
  id: string,
  uploaderId: string
): Promise<WorkPendingUploadRecord | null> {
  const [row] = await getPendingUploads([id], uploaderId, { includeDrafts: true })
  return row ?? null
}

/** 임시 업로드 행 삭제(본인 것만). 지운 행 수 */
export async function deletePendingUploads(
  ids: readonly string[],
  uploaderId: string
): Promise<number> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return 0
  const rows = await db
    .delete(workPendingUploads)
    .where(
      and(inArray(workPendingUploads.id, unique), eq(workPendingUploads.uploaderId, uploaderId))
    )
    .returning({ id: workPendingUploads.id })
  return rows.length
}

// ── 승격 ─────────────────────────────────────────────────────────────────────

export type PromoteInput = {
  /** 승격할 임시 업로드 id */
  uploadId: string
  messageId: string
  /** 행위자(= 업로더 = 메시지 작성자) */
  actorId: string
  /** 저장소 `head()`가 확인한 실제 크기 */
  size: number
  width?: number | null
  height?: number | null
}

/**
 * 임시 업로드 1건을 메시지 첨부로 승격한다(원본 promoteOne의 DB 부분 + attachments 트리거).
 * 같은 트랜잭션에서: 임시 행 확인·삭제 → 첨부 행 생성(id = 새 uuid, 키는 임시 업로드 그대로) →
 * 메시지 첨부 수 다시 세기 → 채널 rev를 올려 메시지 rev에 적는다(다른 화면이 폴링으로 첨부를 다시 읽는다).
 *
 * 던지는 WorkWriteError:
 *   not_found       임시 업로드가 없다(이미 승격·삭제·남의 것) 또는 메시지가 없다
 *   forbidden       메시지 작성자가 아니다
 *   invalid_target  다른 채널의 업로드다
 *   deleted         지워진 메시지다
 *   archived        보관된 채널이다
 */
export async function promotePendingUpload(input: PromoteInput): Promise<WorkAttachmentRecord> {
  return db.transaction(async tx => {
    const [pending] = await tx
      .select()
      .from(workPendingUploads)
      .where(
        and(
          eq(workPendingUploads.id, input.uploadId),
          eq(workPendingUploads.uploaderId, input.actorId),
          isNull(workPendingUploads.draftMeta)
        )
      )
      .limit(1)
    if (!pending) throw new WorkWriteError('not_found', '업로드 정보를 찾을 수 없습니다')

    const [message] = await tx
      .select({
        id: workMessages.id,
        channelId: workMessages.channelId,
        authorId: workMessages.authorId,
        deletedAt: workMessages.deletedAt,
        archivedAt: workChannels.archivedAt,
      })
      .from(workMessages)
      .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
      .where(eq(workMessages.id, input.messageId))
      .limit(1)
    if (!message) throw new WorkWriteError('not_found', '메시지가 없습니다')
    if (message.authorId !== input.actorId) throw new WorkWriteError('forbidden')
    if (message.deletedAt) throw new WorkWriteError('deleted')
    if (message.archivedAt) throw new WorkWriteError('archived')
    if (pending.channelId !== message.channelId) {
      throw new WorkWriteError('invalid_target', '다른 채널의 업로드입니다')
    }

    await tx.delete(workPendingUploads).where(eq(workPendingUploads.id, pending.id))
    const [row] = await tx
      .insert(workAttachments)
      .values({
        id: crypto.randomUUID(),
        messageId: message.id,
        channelId: message.channelId,
        uploaderId: input.actorId,
        blobPath: pending.blobPath,
        name: pending.name,
        mime: pending.mime,
        size: input.size,
        width: input.width ?? null,
        height: input.height ?? null,
      })
      .returning(attachmentColumns)

    const rev = await bumpChannelRev(tx, message.channelId)
    await tx
      .update(workMessages)
      .set({
        attachmentsCount: sql`(select count(*) from ${workAttachments} where ${workAttachments.messageId} = ${message.id})`,
        rev,
      })
      .where(eq(workMessages.id, message.id))
    return toAttachmentRecord(row)
  })
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

/**
 * 첨부 1건 + 그 메시지의 삭제 여부(원본 getReadableAttachment의 select). 권한 판정 재료만 돌려준다 —
 * 읽을 수 있는지는 호출부가 `readable`로 본다. 없으면 null.
 */
export async function getAttachmentWithMessage(
  id: string
): Promise<(WorkAttachmentRecord & { message_deleted_at: string | null }) | null> {
  const [row] = await db
    .select({ ...attachmentColumns, messageDeletedAt: workMessages.deletedAt })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(eq(workAttachments.id, id))
    .limit(1)
  if (!row) return null
  return {
    ...toAttachmentRecord(row),
    message_deleted_at: row.messageDeletedAt ? row.messageDeletedAt.toISOString() : null,
  }
}

/** 메시지들의 첨부(읽을 수 있는 채널만). 올린 순서(created_at, id) */
export async function listAttachmentsForMessages(
  messageIds: readonly string[],
  readable: ReadableScope
): Promise<WorkAttachmentRecord[]> {
  const ids = [...new Set(messageIds)]
  if (ids.length === 0) return []
  const out: WorkAttachmentRecord[] = []
  for (const part of chunks(ids)) {
    const rows = await db
      .select(attachmentColumns)
      .from(workAttachments)
      .where(and(inArray(workAttachments.messageId, part), inReadable(readable)))
      .orderBy(asc(workAttachments.createdAt), asc(workAttachments.id))
    out.push(...rows.map(toAttachmentRecord))
  }
  return out
}

/** 자료실 형식 필터(원본 kindFilterExpression — 상수 패턴만, 사용자 입력이 섞이지 않는다) */
export type FileKindFilterValue =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'media'

/** 1MB 이하 .ts 는 브라우저가 video/mp2t 로 보내도 TypeScript 소스(원본 smallTs) */
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024

function kindFilterSql(kind: FileKindFilterValue) {
  const name = workAttachments.name
  const mime = workAttachments.mime
  const ext = (list: string[]) => list.map(e => sql`lower(${name}) like ${`%.${e}`}`)
  const smallTs = sql`(lower(${name}) like '%.ts' and ${workAttachments.size} <= ${TEXT_PREVIEW_MAX_BYTES})`
  const like = (p: string) => sql`lower(${mime}) like ${p}`
  const eqm = (v: string) => sql`lower(${mime}) = ${v}`
  switch (kind) {
    case 'image':
      return like('image/%')
    case 'pdf':
      return or(eqm('application/pdf'), ...ext(['pdf']))
    case 'document':
      return or(
        like('%wordprocessingml%'),
        eqm('application/msword'),
        like('text/%'),
        like('%hwp%'),
        like('%hancom%'),
        ...ext(['hwp', 'hwpx', 'doc', 'docx', 'txt', 'md']),
        smallTs
      )
    case 'spreadsheet':
      return or(
        like('%spreadsheet%'),
        eqm('application/vnd.ms-excel'),
        ...ext(['xls', 'xlsx', 'csv'])
      )
    case 'presentation':
      return or(
        like('%presentation%'),
        eqm('application/vnd.ms-powerpoint'),
        ...ext(['ppt', 'pptx'])
      )
    case 'archive':
      return or(
        eqm('application/zip'),
        like('%x-7z%'),
        like('%x-rar%'),
        like('%x-tar%'),
        eqm('application/gzip'),
        ...ext(['zip', '7z', 'rar', 'tar', 'gz'])
      )
    case 'media':
      return or(like('audio/%'), and(like('video/%'), sql`not ${smallTs}`))
  }
}

/** LIKE 메타문자 이스케이프(원본 escapeLike) — `escape '\'`와 함께 쓴다 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, c => `\\${c}`)
}

export type FileListFilter = {
  readable: ReadableScope
  channelId?: string
  uploaderId?: string
  /** ISO(포함) */
  from?: string
  /** ISO(배타) */
  to?: string
  kind?: FileKindFilterValue
  /** 파일명 부분 일치(대소문자 무시) */
  q?: string
  /** ''(루트) = folder_path is null, 그 밖에는 정확히 같은 폴더 */
  folder?: string
  /** true면 이전 버전도(원본 versions=all) */
  allVersions?: boolean
  sort?: { column: 'name' | 'created_at' | 'size'; ascending: boolean }
  offset: number
  /** 한 건 더 읽어 다음 쪽 유무를 안다 — 호출부가 pageSize + 1을 넘긴다 */
  limit: number
}

export type FileListRecord = WorkAttachmentRecord & {
  channels: { id: string; name: string; slug: string | null; kind: 'public' | 'private' | 'dm' }
  staff: { user_id: string; display_name: string } | null
}

/**
 * 자료실·채널 파일 탭 목록(원본 listFiles). 읽을 수 있는 채널 + 지워지지 않은 메시지의 첨부만.
 * 정렬은 기본 최신순이고 id가 동률을 깬다.
 */
export async function listFileRecords(filter: FileListFilter): Promise<FileListRecord[]> {
  const sort = filter.sort ?? { column: 'created_at' as const, ascending: false }
  const column =
    sort.column === 'name'
      ? workAttachments.name
      : sort.column === 'size'
        ? workAttachments.size
        : workAttachments.createdAt
  const order = sort.ascending ? asc : desc
  const where = and(
    inReadable(filter.readable),
    isNull(workMessages.deletedAt),
    filter.allVersions ? undefined : eq(workAttachments.isLatest, true),
    filter.channelId ? eq(workAttachments.channelId, filter.channelId) : undefined,
    filter.uploaderId ? eq(workAttachments.uploaderId, filter.uploaderId) : undefined,
    filter.from ? gte(workAttachments.createdAt, new Date(filter.from)) : undefined,
    filter.to ? lt(workAttachments.createdAt, new Date(filter.to)) : undefined,
    filter.kind ? kindFilterSql(filter.kind) : undefined,
    filter.q
      ? sql`lower(${workAttachments.name}) like ${`%${escapeLike(filter.q.toLowerCase())}%`} escape '\\'`
      : undefined,
    filter.folder === undefined
      ? undefined
      : filter.folder === ''
        ? isNull(workAttachments.folderPath)
        : eq(workAttachments.folderPath, filter.folder)
  )
  const rows = await db
    .select({
      ...attachmentColumns,
      chId: workChannels.id,
      chName: workChannels.name,
      chSlug: workChannels.slug,
      chKind: workChannels.kind,
      uploaderName: memberProfiles.displayName,
    })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .innerJoin(workChannels, eq(workChannels.id, workAttachments.channelId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workAttachments.uploaderId))
    .where(where)
    .orderBy(order(column), order(workAttachments.id))
    .limit(filter.limit)
    .offset(filter.offset)
  return rows.map(r => ({
    ...toAttachmentRecord(r),
    channels: {
      id: r.chId,
      name: r.chName,
      slug: r.chSlug,
      kind: r.chKind === 'private' || r.chKind === 'dm' ? r.chKind : 'public',
    },
    staff: r.uploaderId
      ? { user_id: r.uploaderId, display_name: r.uploaderName?.trim() || '이름 없음' }
      : null,
  }))
}

/**
 * 한 폴더의 직속 하위 폴더 이름과 하위 포함 파일 수(원본 RPC channel_subfolders, 0022·0032).
 * 읽을 수 없는 채널이면 빈 목록. 최신 버전·지워지지 않은 메시지만 센다. 이름순은 호출부(toChannelFolders)가 맞춘다.
 */
export async function listSubfolderCounts(
  channelId: string,
  path: string,
  readable: ReadableScope
): Promise<{ name: string; file_count: number }[]> {
  if (!readable.has(channelId)) return []
  const prefix = path === '' ? null : `${path}/`
  const rows = await db
    .select({ folderPath: workAttachments.folderPath, n: count() })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(
      and(
        eq(workAttachments.channelId, channelId),
        isNull(workMessages.deletedAt),
        eq(workAttachments.isLatest, true),
        isNotNull(workAttachments.folderPath),
        prefix
          ? sql`substr(${workAttachments.folderPath}, 1, ${prefix.length}) = ${prefix}`
          : undefined
      )
    )
    .groupBy(workAttachments.folderPath)
  const byName = new Map<string, number>()
  for (const r of rows) {
    const rest = prefix ? (r.folderPath ?? '').slice(prefix.length) : (r.folderPath ?? '')
    const name = rest.split('/')[0]
    if (!name) continue
    byName.set(name, (byName.get(name) ?? 0) + Number(r.n))
  }
  return [...byName.entries()].map(([name, n]) => ({ name, file_count: n }))
}

/** 자료실 필터 선택지: 읽을 수 있는 채널(DM·보관 제외, 이름순) */
export async function listFilterChannels(
  readable: ReadableScope
): Promise<{ id: string; name: string }[]> {
  const ids = [...readable]
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: workChannels.id, name: workChannels.name })
    .from(workChannels)
    .where(
      and(
        inArray(workChannels.id, ids),
        sql`${workChannels.kind} <> 'dm'`,
        isNull(workChannels.archivedAt)
      )
    )
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 자료실 필터 선택지: 읽을 수 있는 채널에 파일을 올린 사람(이름순) */
export async function listFileUploaders(
  readable: ReadableScope
): Promise<{ user_id: string; display_name: string }[]> {
  const ids = [...readable]
  if (ids.length === 0) return []
  const rows = await db
    .selectDistinct({ id: memberProfiles.id, name: memberProfiles.displayName })
    .from(workAttachments)
    .innerJoin(memberProfiles, eq(memberProfiles.id, workAttachments.uploaderId))
    .where(inArray(workAttachments.channelId, ids))
  return rows
    .map(r => ({ user_id: r.id, display_name: r.name?.trim() || '이름 없음' }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'))
}

/**
 * 채널에서 공유된 링크(원본 message_links, 0025) 최신순 + 링크가 든 메시지의 작성자·부모 — 채널 파일 탭 "링크"와
 * DM "공유됨" 탭(원본 lib/tabs/links.ts loadChannelLinks의 조회 부분). 읽을 수 없는 채널이면 빈 목록.
 */
export async function listChannelLinkRecords(
  channelId: string,
  readable: ReadableScope,
  limit: number
): Promise<{
  items: {
    messageId: string
    url: string
    createdAt: string
    authorId: string | null
    authorName: string | null
    parentId: string | null
  }[]
  total: number
}> {
  if (!readable.has(channelId)) return { items: [], total: 0 }
  const where = and(eq(workMessageLinks.channelId, channelId), isNull(workMessages.deletedAt))
  const [totalRow] = await db
    .select({ n: count() })
    .from(workMessageLinks)
    .innerJoin(workMessages, eq(workMessages.id, workMessageLinks.messageId))
    .where(where)
  const rows = await db
    .select({
      messageId: workMessageLinks.messageId,
      url: workMessageLinks.url,
      createdAt: workMessageLinks.createdAt,
      authorId: workMessages.authorId,
      parentId: workMessages.parentId,
      authorName: memberProfiles.displayName,
    })
    .from(workMessageLinks)
    .innerJoin(workMessages, eq(workMessages.id, workMessageLinks.messageId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workMessages.authorId))
    .where(where)
    .orderBy(desc(workMessageLinks.createdAt), desc(workMessageLinks.messageId))
    .limit(limit)
  return {
    items: rows.map(r => ({
      messageId: r.messageId,
      url: r.url,
      createdAt: isoNN(r.createdAt),
      authorId: r.authorId,
      authorName: r.authorId ? r.authorName?.trim() || '이름 없음' : null,
      parentId: r.parentId,
    })),
    total: Number(totalRow?.n ?? 0),
  }
}
