/**
 * 업무툴 메시지 쿼리 계층 — 원본 kosmart-work `work.messages`·`reactions`·`pins`·`bookmarks`·`mentions`·
 * `message_links`와 그 트리거를 옮겼다(설계 §5).
 *
 * **권한을 모른다.** 읽기는 호출부가 계산한 읽기 범위(`readable` — 원본 `readable_channel_ids()`)를 인자로 받아
 * WHERE에 넣는다(원본 RLS `messages_select`·`reactions_select`·`pins_select` 자리). 쓰기 자격(채널 멤버인가·관리자인가·
 * 공지 채널에 글을 올릴 수 있는가)은 호출부가 판정해 플래그로 넘긴다.
 *
 * 대신 원본 트리거가 지키던 **정합성 규칙은 호출부와 무관하게 여기서 지킨다**(같은 db.transaction 안):
 * - harden_messages_write(0001·0028): 작성자=행위자, kind='text', 카운터 0, 전달 원본 null(일반 전송),
 *   답글 부모는 존재·최상위·같은 채널, 인용은 존재·같은 채널, 보관 채널 쓰기 금지, 공지 채널 최상위 글 제한,
 *   수정은 작성자·삭제 전, 삭제는 작성자·관리자, 지워진 메시지는 되살리지 않음
 * - blank_deleted_message: 지우면 본문을 비운다
 * - sync_thread_counters: 답글 수·마지막 답글 시각을 매번 다시 센다(지워지지 않은 답글)
 * - sync_message_links(0025·0039): 본문 링크 색인을 다시 만든다
 * - harden_reactions/pins/bookmarks: 사용자·고정한 사람을 행위자로, 고정 대상은 그 채널 메시지
 * - *_live_insert(0008): 지워진 메시지에는 반응·고정·북마크를 새로 달지 않는다, 보관 채널도 마찬가지
 * - guard_mention_target(0008): 멘션 대상은 그 채널 멤버, 지워진 메시지는 멘션하지 않는다
 * - 폴링 커서(§6): 화면에 보이는 것이 바뀌는 쓰기마다 채널 rev를 올리고 바뀐 메시지의 rev에 적는다
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  workBookmarks,
  workChannelMembers,
  workChannels,
  workMentions,
  workMessageLinks,
  workMessages,
  workPins,
  workReactions,
} from '../../schema/index.ts'

import {
  bumpChannelRev,
  iso,
  isoNN,
  recomputeLatestForMessage,
  WorkWriteError,
  type WorkExecutor,
} from './_shared.ts'
import { extractMessageUrls } from './links.ts'

export type WorkMessageKind = 'text' | 'system' | 'bot'

export type WorkReactionLite = { emoji: string; user_id: string }

export type WorkQuotedRecord = {
  id: string
  author_id: string | null
  kind: WorkMessageKind
  body: string
  deleted_at: string | null
  parent_id: string | null
}

export type WorkForwardedRecord = {
  id: string
  channel_id: string
  parent_id: string | null
  deleted_at: string | null
  channel: { slug: string | null; kind: string } | null
}

/** 원본 `MESSAGE_COLUMNS` 임베드와 같은 모양(snake_case·ISO). 첨부는 2단계 — 호출부가 `[]`를 붙인다 */
export type WorkMessageRecord = {
  id: string
  channel_id: string
  parent_id: string | null
  author_id: string | null
  kind: WorkMessageKind
  body: string
  attachments_count: number
  reply_count: number
  last_reply_at: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  quoted_message_id: string | null
  forwarded_from_id: string | null
  reactions: WorkReactionLite[]
  quoted: WorkQuotedRecord | null
  forwarded: WorkForwardedRecord | null
}

export type ReadableScope = ReadonlySet<string>

const baseColumns = {
  id: workMessages.id,
  channelId: workMessages.channelId,
  parentId: workMessages.parentId,
  authorId: workMessages.authorId,
  kind: workMessages.kind,
  body: workMessages.body,
  attachmentsCount: workMessages.attachmentsCount,
  replyCount: workMessages.replyCount,
  lastReplyAt: workMessages.lastReplyAt,
  editedAt: workMessages.editedAt,
  deletedAt: workMessages.deletedAt,
  createdAt: workMessages.createdAt,
  quotedMessageId: workMessages.quotedMessageId,
  forwardedFromId: workMessages.forwardedFromId,
  sensitive: workMessages.sensitive,
}

type BaseRow = {
  id: string
  channelId: string
  parentId: string | null
  authorId: string | null
  kind: string
  body: string
  attachmentsCount: number
  replyCount: number
  lastReplyAt: Date | null
  editedAt: Date | null
  deletedAt: Date | null
  createdAt: Date
  quotedMessageId: string | null
  forwardedFromId: string | null
  sensitive: boolean
}

function kindOf(kind: string): WorkMessageKind {
  return kind === 'system' || kind === 'bot' ? kind : 'text'
}

function readableList(readable: ReadableScope): string[] {
  return [...readable]
}

/** 읽기 범위가 비면 아무 행도 돌려주지 않는다(빈 IN 대신 거짓 조건) */
function inReadable(readable: ReadableScope) {
  const ids = readableList(readable)
  return ids.length > 0 ? inArray(workMessages.channelId, ids) : sql`0`
}

/** 기본 행 → 화면 레코드. 반응(지워지지 않은 메시지만 — reactions_live_select)·인용·전달 임베드를 붙인다 */
async function hydrate(rows: BaseRow[], readable: ReadableScope): Promise<WorkMessageRecord[]> {
  if (rows.length === 0) return []
  const liveIds = rows.filter(r => !r.deletedAt).map(r => r.id)
  const quotedIds = [...new Set(rows.map(r => r.quotedMessageId).filter((v): v is string => !!v))]
  const forwardedIds = [
    ...new Set(rows.map(r => r.forwardedFromId).filter((v): v is string => !!v)),
  ]

  const [reactionRows, quotedRows, forwardedRows] = await Promise.all([
    liveIds.length > 0
      ? db
          .select({
            messageId: workReactions.messageId,
            emoji: workReactions.emoji,
            userId: workReactions.userId,
          })
          .from(workReactions)
          .where(inArray(workReactions.messageId, liveIds))
          .orderBy(asc(workReactions.createdAt))
      : Promise.resolve([]),
    quotedIds.length > 0
      ? db
          .select({
            id: workMessages.id,
            channelId: workMessages.channelId,
            authorId: workMessages.authorId,
            kind: workMessages.kind,
            body: workMessages.body,
            deletedAt: workMessages.deletedAt,
            parentId: workMessages.parentId,
          })
          .from(workMessages)
          .where(and(inArray(workMessages.id, quotedIds), inReadable(readable)))
      : Promise.resolve([]),
    forwardedIds.length > 0
      ? db
          .select({
            id: workMessages.id,
            channelId: workMessages.channelId,
            parentId: workMessages.parentId,
            deletedAt: workMessages.deletedAt,
            slug: workChannels.slug,
            channelKind: workChannels.kind,
          })
          .from(workMessages)
          .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
          .where(and(inArray(workMessages.id, forwardedIds), inReadable(readable)))
      : Promise.resolve([]),
  ])

  const reactions = new Map<string, WorkReactionLite[]>()
  for (const r of reactionRows) {
    const list = reactions.get(r.messageId) ?? []
    list.push({ emoji: r.emoji, user_id: r.userId })
    reactions.set(r.messageId, list)
  }
  const quoted = new Map<string, WorkQuotedRecord>()
  for (const q of quotedRows) {
    quoted.set(q.id, {
      id: q.id,
      author_id: q.authorId,
      kind: kindOf(q.kind),
      body: q.body,
      deleted_at: iso(q.deletedAt),
      parent_id: q.parentId,
    })
  }
  const forwarded = new Map<string, WorkForwardedRecord>()
  for (const f of forwardedRows) {
    forwarded.set(f.id, {
      id: f.id,
      channel_id: f.channelId,
      parent_id: f.parentId,
      deleted_at: iso(f.deletedAt),
      channel: { slug: f.slug, kind: f.channelKind },
    })
  }

  return rows.map(r => ({
    id: r.id,
    channel_id: r.channelId,
    parent_id: r.parentId,
    author_id: r.authorId,
    kind: kindOf(r.kind),
    body: r.body,
    attachments_count: r.attachmentsCount,
    reply_count: r.replyCount,
    last_reply_at: iso(r.lastReplyAt),
    edited_at: iso(r.editedAt),
    deleted_at: iso(r.deletedAt),
    created_at: isoNN(r.createdAt),
    quoted_message_id: r.quotedMessageId,
    forwarded_from_id: r.forwardedFromId,
    reactions: r.deletedAt ? [] : (reactions.get(r.id) ?? []),
    quoted: r.quotedMessageId ? (quoted.get(r.quotedMessageId) ?? null) : null,
    forwarded: r.forwardedFromId ? (forwarded.get(r.forwardedFromId) ?? null) : null,
  }))
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

/** id로 여러 건(읽을 수 없거나 없는 메시지는 결과에 없다 — 원본 fetchMessagesByIds). 최대 100개 */
export async function fetchMessageRecords(
  messageIds: string[],
  readable: ReadableScope
): Promise<WorkMessageRecord[]> {
  const ids = [...new Set(messageIds)].slice(0, 100)
  if (ids.length === 0 || readable.size === 0) return []
  const rows = await db
    .select(baseColumns)
    .from(workMessages)
    .where(and(inArray(workMessages.id, ids), inReadable(readable)))
  return hydrate(rows, readable)
}

/** 한 건 + 민감 표시(전달이 이어받는다). 읽을 수 없으면 null */
export async function fetchMessageRecord(
  messageId: string,
  readable: ReadableScope
): Promise<(WorkMessageRecord & { sensitive: boolean }) | null> {
  if (readable.size === 0) return null
  const rows = await db
    .select(baseColumns)
    .from(workMessages)
    .where(and(eq(workMessages.id, messageId), inReadable(readable)))
    .limit(1)
  if (!rows[0]) return null
  const [record] = await hydrate(rows, readable)
  return { ...record, sensitive: rows[0].sensitive }
}

export type MessageCursorMs = { createdAt: Date; id: string }

/** 최상위 메시지 최신 limit개(+ before 커서). 오래된 것 → 최신 순. 읽을 수 없는 채널이면 빈 페이지 */
export async function fetchMessagePageRecords(
  channelId: string,
  readable: ReadableScope,
  opts: { before?: MessageCursorMs; limit?: number } = {}
): Promise<{ messages: WorkMessageRecord[]; hasMore: boolean }> {
  if (!readable.has(channelId)) return { messages: [], hasMore: false }
  const limit = opts.limit ?? 50
  const conds = [eq(workMessages.channelId, channelId), isNull(workMessages.parentId)]
  if (opts.before) {
    const t = opts.before.createdAt
    conds.push(
      or(
        lt(workMessages.createdAt, t),
        and(eq(workMessages.createdAt, t), lt(workMessages.id, opts.before.id))
      )!
    )
  }
  const rows = await db
    .select(baseColumns)
    .from(workMessages)
    .where(and(...conds))
    .orderBy(desc(workMessages.createdAt), desc(workMessages.id))
    .limit(limit + 1)
  const hasMore = rows.length > limit
  const page = await hydrate(rows.slice(0, limit), readable)
  return { messages: page.reverse(), hasMore }
}

/** 스레드: 부모 + 답글(오래된 순, 최대 1000). 부모를 읽을 수 없거나 답글이면 null */
export async function fetchThreadRecords(
  parentId: string,
  readable: ReadableScope
): Promise<{ parent: WorkMessageRecord; replies: WorkMessageRecord[] } | null> {
  const parent = await fetchMessageRecord(parentId, readable)
  if (!parent || parent.parent_id) return null
  const rows = await db
    .select(baseColumns)
    .from(workMessages)
    .where(and(eq(workMessages.parentId, parentId), inReadable(readable)))
    .orderBy(asc(workMessages.createdAt), asc(workMessages.id))
    .limit(1000)
  const { sensitive: _s, ...rest } = parent
  return { parent: rest, replies: await hydrate(rows, readable) }
}

/** 채널 고정 메시지 id(최근 고정 순). 지워진 메시지의 고정은 빠진다(pins_live_select) */
export async function fetchPinnedMessageIds(
  channelId: string,
  readable: ReadableScope
): Promise<string[]> {
  if (!readable.has(channelId)) return []
  const rows = await db
    .select({ messageId: workPins.messageId })
    .from(workPins)
    .innerJoin(workMessages, eq(workMessages.id, workPins.messageId))
    .where(and(eq(workPins.channelId, channelId), isNull(workMessages.deletedAt)))
    .orderBy(desc(workPins.createdAt))
  return rows.map(r => r.messageId)
}

/** 내 북마크 중 주어진 메시지에 해당하는 것(최대 200개 대조) */
export async function fetchMyBookmarkedIds(
  userId: string,
  messageIds: string[]
): Promise<string[]> {
  const ids = [...new Set(messageIds)].slice(0, 200)
  if (ids.length === 0) return []
  const rows = await db
    .select({ messageId: workBookmarks.messageId })
    .from(workBookmarks)
    .where(and(eq(workBookmarks.userId, userId), inArray(workBookmarks.messageId, ids)))
  return rows.map(r => r.messageId)
}

/**
 * 폴링(§6-2): 이 채널에서 rev가 (since, upto]인 메시지 id. upto는 같은 응답에 싣는 채널 rev —
 * 두 읽기 사이에 커밋된 쓰기는 다음 폴링에서 잡힌다(빠지지 않는다). limit+1개까지 읽어 넘치면 호출부가 resync.
 */
export async function listChangedMessageIds(
  channelId: string,
  sinceRev: number,
  uptoRev: number,
  limit: number
): Promise<string[]> {
  const rows = await db
    .select({ id: workMessages.id })
    .from(workMessages)
    .where(
      and(
        eq(workMessages.channelId, channelId),
        gt(workMessages.rev, sinceRev),
        lte(workMessages.rev, uptoRev)
      )
    )
    .orderBy(asc(workMessages.rev))
    .limit(limit + 1)
  return rows.map(r => r.id)
}

// ── 쓰기 공통(트리거 자리) ───────────────────────────────────────────────────

async function loadChannelForWrite(tx: WorkExecutor, channelId: string) {
  const [channel] = await tx
    .select({
      id: workChannels.id,
      kind: workChannels.kind,
      archivedAt: workChannels.archivedAt,
      postPolicy: workChannels.postPolicy,
    })
    .from(workChannels)
    .where(eq(workChannels.id, channelId))
    .limit(1)
  return channel ?? null
}

async function loadMessageForWrite(tx: WorkExecutor, messageId: string) {
  const [row] = await tx
    .select({
      id: workMessages.id,
      channelId: workMessages.channelId,
      parentId: workMessages.parentId,
      authorId: workMessages.authorId,
      kind: workMessages.kind,
      body: workMessages.body,
      deletedAt: workMessages.deletedAt,
      forwardedFromId: workMessages.forwardedFromId,
      createdAt: workMessages.createdAt,
      archivedAt: workChannels.archivedAt,
    })
    .from(workMessages)
    .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
    .where(eq(workMessages.id, messageId))
    .limit(1)
  return row ?? null
}

/**
 * 작성자가 그 채널의 멤버인가 — 원본 `messages_insert` WITH CHECK의 `is_channel_member`는 **쓰는 문장 안에서**
 * 평가됐다. 호출부(action)도 먼저 판정하지만, 그 사이 멤버십이 빠지는 경우(그룹에서 내보내짐·비공개 채널에서
 * 빠짐)까지 막으려고 쓰기 트랜잭션 안에서 한 번 더 본다(독립 권한 검토 2026-11-02, TOCTOU).
 * "메시지 작성자는 그 채널 멤버다"는 누가 부르든 같은 데이터 규칙이라 쿼리 층에 둔다.
 */
async function assertAuthorIsMember(
  tx: WorkExecutor,
  channelId: string,
  authorId: string
): Promise<void> {
  const [member] = await tx
    .select({ userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(
      and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, authorId))
    )
    .limit(1)
  if (!member) throw new WorkWriteError('forbidden', '채널 멤버만 글을 쓸 수 있습니다')
}

/** sync_thread_counters: 부모의 답글 수·마지막 답글 시각을 지워지지 않은 답글로 다시 센다. 부모 rev도 같은 값으로 */
async function recountThread(tx: WorkExecutor, parentId: string, rev: number): Promise<void> {
  const [agg] = await tx
    .select({
      cnt: sql<number>`count(*)`,
      lastAt: sql<number | null>`max(${workMessages.createdAt})`,
    })
    .from(workMessages)
    .where(and(eq(workMessages.parentId, parentId), isNull(workMessages.deletedAt)))
  await tx
    .update(workMessages)
    .set({
      replyCount: Number(agg?.cnt ?? 0),
      lastReplyAt: agg?.lastAt != null ? new Date(Number(agg.lastAt)) : null,
      rev,
    })
    .where(eq(workMessages.id, parentId))
}

/** sync_message_links: 본문 링크 색인을 다시 만든다(지워졌거나 빈 본문이면 비운다) */
async function syncLinks(
  tx: WorkExecutor,
  message: { id: string; channelId: string; body: string; createdAt: Date; deleted: boolean }
): Promise<void> {
  await tx.delete(workMessageLinks).where(eq(workMessageLinks.messageId, message.id))
  if (message.deleted || message.body === '') return
  const urls = extractMessageUrls(message.body)
  if (urls.length === 0) return
  await tx
    .insert(workMessageLinks)
    .values(
      urls.map(url => ({
        messageId: message.id,
        channelId: message.channelId,
        url,
        createdAt: message.createdAt,
      }))
    )
    .onConflictDoNothing()
}

/** 답글 부모·인용 대상 검사(원본 harden_messages_write INSERT — 서버 경로 포함 항상) */
async function assertThreadAndQuote(
  tx: WorkExecutor,
  channelId: string,
  parentId: string | null,
  quotedMessageId: string | null
): Promise<void> {
  if (parentId) {
    const [parent] = await tx
      .select({ channelId: workMessages.channelId, parentId: workMessages.parentId })
      .from(workMessages)
      .where(eq(workMessages.id, parentId))
      .limit(1)
    if (!parent) throw new WorkWriteError('invalid_parent', '답글 대상 메시지가 없습니다')
    if (parent.parentId) throw new WorkWriteError('invalid_parent', '스레드는 한 단계만 허용됩니다')
    if (parent.channelId !== channelId) {
      throw new WorkWriteError('invalid_parent', '답글은 같은 채널이어야 합니다')
    }
  }
  if (quotedMessageId) {
    const [quoted] = await tx
      .select({ channelId: workMessages.channelId })
      .from(workMessages)
      .where(eq(workMessages.id, quotedMessageId))
      .limit(1)
    if (!quoted) throw new WorkWriteError('invalid_quote', '인용할 메시지가 없습니다')
    if (quoted.channelId !== channelId) {
      throw new WorkWriteError('invalid_quote', '인용은 같은 채널의 메시지만 할 수 있습니다')
    }
  }
}

type InsertCore = {
  id: string
  channelId: string
  authorId: string
  kind: WorkMessageKind
  body: string
  parentId: string | null
  quotedMessageId: string | null
  forwardedFromId: string | null
  sensitive: boolean
}

/** 행 하나 넣기 + rev·답글 수·링크(같은 트랜잭션) */
async function insertCore(tx: WorkExecutor, m: InsertCore): Promise<{ rev: number }> {
  await assertThreadAndQuote(tx, m.channelId, m.parentId, m.quotedMessageId)
  const rev = await bumpChannelRev(tx, m.channelId)
  const createdAt = new Date()
  await tx.insert(workMessages).values({
    id: m.id,
    channelId: m.channelId,
    parentId: m.parentId,
    authorId: m.authorId,
    kind: m.kind,
    body: m.body,
    attachmentsCount: 0,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    sensitive: m.sensitive,
    quotedMessageId: m.quotedMessageId,
    forwardedFromId: m.forwardedFromId,
    rev,
    createdAt,
  })
  if (m.parentId) await recountThread(tx, m.parentId, rev)
  await syncLinks(tx, { ...m, createdAt, deleted: false })
  return { rev }
}

export type InsertMessageResult =
  | { status: 'created'; rev: number }
  /** 같은 id가 이미 있다(재전송). 행은 건드리지 않았다 — 호출부가 작성자를 대조한다 */
  | { status: 'duplicate'; authorId: string | null; channelId: string }

/**
 * 사용자 메시지 보내기(원본 클라이언트 INSERT + harden_messages_write).
 * 작성자는 `authorId`(행위자 — 호출부가 세션에서 얻은 값), kind는 항상 'text', 카운터·전달 원본은 비운다.
 * `canPostRestricted` = 이 채널 owner이거나 업무툴 관리자인가(공지 채널 최상위 글 판정 — 호출부 몫).
 * 채널 멤버인지는 호출부가 먼저 판정하고, 트랜잭션 안에서 한 번 더 본다(`assertAuthorIsMember`).
 */
export async function insertMessage(input: {
  id: string
  channelId: string
  authorId: string
  body: string
  parentId?: string | null
  quotedMessageId?: string | null
  canPostRestricted: boolean
}): Promise<InsertMessageResult> {
  return db.transaction(async tx => {
    const [existing] = await tx
      .select({ authorId: workMessages.authorId, channelId: workMessages.channelId })
      .from(workMessages)
      .where(eq(workMessages.id, input.id))
      .limit(1)
    if (existing) return { status: 'duplicate', ...existing } as const
    const { rev } = await insertUserMessageInTx(tx, input)
    return { status: 'created', rev } as const
  })
}

/**
 * 사용자 메시지 한 행을 **호출부의 트랜잭션 안에서** 넣는다 — insertMessage와 같은 데이터 규칙(보관 채널 금지·작성자는
 * 채널 멤버·공지 채널 최상위 제한·답글/인용 검사·rev·답글 수·링크). 같은 id 검사는 호출부 몫이다.
 * 파일 버전·새 문서처럼 "게시물 + 첨부"를 한 트랜잭션으로 묶는 쓰기(files.ts commitFileMessage)가 쓴다.
 */
export async function insertUserMessageInTx(
  tx: WorkExecutor,
  input: {
    id: string
    channelId: string
    authorId: string
    body: string
    parentId?: string | null
    quotedMessageId?: string | null
    canPostRestricted: boolean
  }
): Promise<{ rev: number }> {
  const channel = await loadChannelForWrite(tx, input.channelId)
  if (!channel) throw new WorkWriteError('not_found', '채널이 없습니다')
  if (channel.archivedAt) throw new WorkWriteError('archived', '보관된 채널에는 쓸 수 없습니다')
  await assertAuthorIsMember(tx, input.channelId, input.authorId)
  const parentId = input.parentId ?? null
  if (!parentId && channel.postPolicy === 'owners' && !input.canPostRestricted) {
    throw new WorkWriteError('owners_only', '이 채널은 소유자만 글을 올릴 수 있습니다')
  }
  return insertCore(tx, {
    id: input.id,
    channelId: input.channelId,
    authorId: input.authorId,
    kind: 'text',
    body: input.body,
    parentId,
    quotedMessageId: input.quotedMessageId ?? null,
    forwardedFromId: null,
    sensitive: false,
  })
}

/**
 * 전달 메시지(원본은 service_role INSERT — 트리거의 클라이언트 하드닝을 비켜 forwarded_from_id를 싣는다).
 * 원본 action이 하던 검사 중 데이터 규칙(보관·공지 채널)은 여기서도 다시 본다.
 */
export async function insertForwardedMessage(input: {
  id: string
  channelId: string
  authorId: string
  body: string
  forwardedFromId: string
  sensitive: boolean
  canPostRestricted: boolean
}): Promise<{ status: 'created' } | { status: 'duplicate' } | { status: 'conflict' }> {
  return db.transaction(async tx => {
    const [existing] = await tx
      .select({
        authorId: workMessages.authorId,
        channelId: workMessages.channelId,
        forwardedFromId: workMessages.forwardedFromId,
      })
      .from(workMessages)
      .where(eq(workMessages.id, input.id))
      .limit(1)
    if (existing) {
      const same =
        existing.authorId === input.authorId &&
        existing.channelId === input.channelId &&
        existing.forwardedFromId === input.forwardedFromId
      return same ? ({ status: 'duplicate' } as const) : ({ status: 'conflict' } as const)
    }
    const channel = await loadChannelForWrite(tx, input.channelId)
    if (!channel) throw new WorkWriteError('not_found', '채널이 없습니다')
    if (channel.archivedAt) throw new WorkWriteError('archived', '보관된 채널에는 쓸 수 없습니다')
    await assertAuthorIsMember(tx, input.channelId, input.authorId)
    if (channel.postPolicy === 'owners' && !input.canPostRestricted) {
      throw new WorkWriteError('owners_only', '이 채널은 소유자만 글을 올릴 수 있습니다')
    }
    await insertCore(tx, {
      id: input.id,
      channelId: input.channelId,
      authorId: input.authorId,
      kind: 'text',
      body: input.body,
      parentId: null,
      quotedMessageId: null,
      forwardedFromId: input.forwardedFromId,
      sensitive: input.sensitive,
    })
    return { status: 'created' } as const
  })
}

/**
 * 시스템 메시지(그룹 멤버 추가·나가기·이름 바꾸기 안내 — 원본 service_role INSERT, kind 'system').
 * 트랜잭션 안에서 다른 쓰기와 함께 부를 수 있게 실행기를 받는다.
 */
export async function insertSystemMessage(
  tx: WorkExecutor,
  input: { channelId: string; authorId: string; body: string }
): Promise<void> {
  await insertCore(tx, {
    id: crypto.randomUUID(),
    channelId: input.channelId,
    authorId: input.authorId,
    kind: 'system',
    body: input.body,
    parentId: null,
    quotedMessageId: null,
    forwardedFromId: null,
    sensitive: false,
  })
}

/**
 * 본문 수정(원본 harden_messages_write UPDATE): 작성자 본인·삭제 전·일반 메시지·전달 아님.
 * 보관 채널은 관리자만(messages_active_channel_update). 같은 본문이면 아무것도 바꾸지 않는다.
 */
export async function editMessageBody(input: {
  messageId: string
  actorId: string
  body: string
  actorIsAdmin: boolean
}): Promise<{ status: 'updated' | 'unchanged'; channelId: string }> {
  return db.transaction(async tx => {
    const m = await loadMessageForWrite(tx, input.messageId)
    if (!m) throw new WorkWriteError('not_found', '메시지를 찾을 수 없습니다')
    if (m.authorId !== input.actorId || m.kind !== 'text') {
      throw new WorkWriteError('forbidden', '내가 쓴 메시지만 고칠 수 있습니다')
    }
    if (m.deletedAt) throw new WorkWriteError('deleted', '삭제된 메시지는 고칠 수 없습니다')
    if (m.forwardedFromId) throw new WorkWriteError('forbidden', '전달된 메시지는 고칠 수 없습니다')
    if (m.archivedAt && !input.actorIsAdmin) {
      throw new WorkWriteError('archived', '보관된 채널의 메시지는 고칠 수 없습니다')
    }
    if (m.body === input.body) return { status: 'unchanged', channelId: m.channelId } as const
    const rev = await bumpChannelRev(tx, m.channelId)
    await tx
      .update(workMessages)
      .set({ body: input.body, editedAt: new Date(), rev })
      .where(eq(workMessages.id, m.id))
    await syncLinks(tx, {
      id: m.id,
      channelId: m.channelId,
      body: input.body,
      createdAt: m.createdAt,
      deleted: false,
    })
    return { status: 'updated', channelId: m.channelId } as const
  })
}

/**
 * 소프트 삭제(원본 harden_messages_write + blank_deleted_message + sync_thread_counters + sync_message_links):
 * 작성자 본인 또는 `actorIsAdmin`(업무툴 관리자이면서 그 채널을 읽을 수 있음 — 호출부 판정).
 * 보관 채널은 관리자만. 본문을 비우고, 답글이면 부모 카운터를 다시 세고, 고정돼 있었으면 고정 목록 변경으로 알린다.
 */
export async function softDeleteMessage(input: {
  messageId: string
  actorId: string
  actorIsAdmin: boolean
}): Promise<{
  status: 'deleted' | 'already'
  channelId: string
  authorId: string | null
}> {
  return db.transaction(async tx => {
    const m = await loadMessageForWrite(tx, input.messageId)
    if (!m) throw new WorkWriteError('not_found', '메시지를 찾을 수 없습니다')
    if (m.deletedAt)
      return { status: 'already', channelId: m.channelId, authorId: m.authorId } as const
    if (m.authorId !== input.actorId && !input.actorIsAdmin) {
      throw new WorkWriteError('forbidden', '내가 쓴 메시지만 삭제할 수 있습니다')
    }
    if (m.archivedAt && !input.actorIsAdmin) {
      throw new WorkWriteError('archived', '보관된 채널의 메시지는 지울 수 없습니다')
    }
    const [pinned] = await tx
      .select({ messageId: workPins.messageId })
      .from(workPins)
      .where(eq(workPins.messageId, m.id))
      .limit(1)
    const rev = await bumpChannelRev(tx, m.channelId, { pins: Boolean(pinned) })
    await tx
      .update(workMessages)
      .set({ deletedAt: new Date(), body: '', rev })
      .where(eq(workMessages.id, m.id))
    if (m.parentId) await recountThread(tx, m.parentId, rev)
    await syncLinks(tx, {
      id: m.id,
      channelId: m.channelId,
      body: '',
      createdAt: m.createdAt,
      deleted: true,
    })
    // recompute_latest_after_message_delete(0032): 지운 게시물의 첨부가 속한 계보마다 최신을 다시 정한다 —
    // 최신 버전 게시물이 지워지면 그 앞 버전이 다시 최신이 된다
    await recomputeLatestForMessage(tx, m.id)
    return { status: 'deleted', channelId: m.channelId, authorId: m.authorId } as const
  })
}

/**
 * 반응 토글. 사용자는 `userId`(행위자). 새로 달 때만 "지워지지 않은 메시지·보관 안 된 채널"을 본다
 * (reactions_live_insert). 채널 멤버인지는 호출부 몫(reactions_insert 정책). 어느 쪽이든 메시지 rev를 올린다.
 */
export async function toggleReactionRow(input: {
  messageId: string
  userId: string
  emoji: string
  /** 새로 달 수 있는가(그 채널 멤버 — 원본 reactions_insert). 떼는 것은 본인 반응이면 늘 된다(reactions_delete) */
  canAdd: boolean
}): Promise<{ active: boolean; channelId: string }> {
  return db.transaction(async tx => {
    const m = await loadMessageForWrite(tx, input.messageId)
    if (!m) throw new WorkWriteError('not_found', '메시지를 찾을 수 없습니다')
    // 보관된 채널은 읽기 전용이다 — 떼는 것도 막는다(예전에는 떼기 분기가 보관 검사보다 먼저라 기존 반응이 사라졌다, 2026-11-05 점검)
    if (m.archivedAt) throw new WorkWriteError('archived', '보관된 채널입니다')
    const removed = await tx
      .delete(workReactions)
      .where(
        and(
          eq(workReactions.messageId, input.messageId),
          eq(workReactions.userId, input.userId),
          eq(workReactions.emoji, input.emoji)
        )
      )
      .returning({ emoji: workReactions.emoji })
    if (removed.length > 0) {
      const rev = await bumpChannelRev(tx, m.channelId)
      await tx.update(workMessages).set({ rev }).where(eq(workMessages.id, m.id))
      return { active: false, channelId: m.channelId }
    }
    if (!input.canAdd) throw new WorkWriteError('forbidden', '참여한 채널에서만 반응할 수 있습니다')
    if (m.deletedAt) throw new WorkWriteError('deleted', '삭제된 메시지입니다')
    if (m.archivedAt) throw new WorkWriteError('archived', '보관된 채널입니다')
    await tx
      .insert(workReactions)
      .values({ messageId: input.messageId, userId: input.userId, emoji: input.emoji })
      .onConflictDoNothing()
    const rev = await bumpChannelRev(tx, m.channelId)
    await tx.update(workMessages).set({ rev }).where(eq(workMessages.id, m.id))
    return { active: true, channelId: m.channelId }
  })
}

/**
 * 고정 토글(원본 harden_pins_write·pins_live_insert): 고정한 사람은 행위자, 메시지는 그 채널 것·지워지지 않음,
 * 채널은 보관 안 됨. 채널 멤버인지는 호출부 몫. 고정 목록이 바뀌면 pins_rev를 올린다.
 */
export async function togglePinRow(input: {
  channelId: string
  messageId: string
  actorId: string
}): Promise<{ pinned: boolean }> {
  return db.transaction(async tx => {
    const m = await loadMessageForWrite(tx, input.messageId)
    if (!m || m.channelId !== input.channelId) {
      throw new WorkWriteError('invalid_target', '고정할 메시지가 이 채널에 없습니다')
    }
    // 보관된 채널은 읽기 전용이다 — 고정 해제도 막는다(2026-11-05 점검)
    if (m.archivedAt) throw new WorkWriteError('archived', '보관된 채널입니다')
    const removed = await tx
      .delete(workPins)
      .where(and(eq(workPins.channelId, input.channelId), eq(workPins.messageId, input.messageId)))
      .returning({ messageId: workPins.messageId })
    if (removed.length > 0) {
      await bumpChannelRev(tx, input.channelId, { pins: true })
      return { pinned: false }
    }
    if (m.deletedAt) throw new WorkWriteError('deleted', '삭제된 메시지입니다')
    if (m.archivedAt) throw new WorkWriteError('archived', '보관된 채널입니다')
    await tx
      .insert(workPins)
      .values({ channelId: input.channelId, messageId: input.messageId, pinnedBy: input.actorId })
      .onConflictDoNothing()
    await bumpChannelRev(tx, input.channelId, { pins: true })
    return { pinned: true }
  })
}

/** 북마크 토글(본인). 새로 달 때만 지워지지 않은 메시지인지 본다(bookmarks_live_insert). 읽기 권한은 호출부 몫 */
export async function toggleBookmarkRow(input: {
  userId: string
  messageId: string
  /** 새로 달 수 있는가(그 메시지를 읽을 수 있음 — 원본 bookmarks_insert). 떼는 것은 본인 행이면 늘 된다 */
  canAdd: boolean
}): Promise<{ bookmarked: boolean }> {
  return db.transaction(async tx => {
    const removed = await tx
      .delete(workBookmarks)
      .where(
        and(eq(workBookmarks.userId, input.userId), eq(workBookmarks.messageId, input.messageId))
      )
      .returning({ messageId: workBookmarks.messageId })
    if (removed.length > 0) return { bookmarked: false }
    if (!input.canAdd) throw new WorkWriteError('forbidden', '북마크할 수 없는 메시지입니다')
    const m = await loadMessageForWrite(tx, input.messageId)
    if (!m) throw new WorkWriteError('not_found', '메시지를 찾을 수 없습니다')
    if (m.deletedAt) throw new WorkWriteError('deleted', '삭제된 메시지입니다')
    await tx
      .insert(workBookmarks)
      .values({ userId: input.userId, messageId: input.messageId })
      .onConflictDoNothing()
    return { bookmarked: true }
  })
}

/**
 * 멘션 행(원본 recordMentions + guard_mention_target): 대상은 그 채널 멤버로 한정, `everyone`이면 멤버 전원,
 * 작성자 본인 제외, 지워진 메시지는 멘션하지 않는다. 이미 있는 멘션은 그대로 둔다(읽음 상태 유지).
 * 반환은 대상 전원(원본과 같다 — 이미 있던 행 포함).
 */
export async function recordMentionRows(input: {
  messageId: string
  authorId: string
  explicitIds: string[]
  everyone: boolean
}): Promise<string[]> {
  if (input.explicitIds.length === 0 && !input.everyone) return []
  return db.transaction(async tx => {
    const [m] = await tx
      .select({ channelId: workMessages.channelId, deletedAt: workMessages.deletedAt })
      .from(workMessages)
      .where(eq(workMessages.id, input.messageId))
      .limit(1)
    if (!m || m.deletedAt) return []
    const members = await tx
      .select({ userId: workChannelMembers.userId })
      .from(workChannelMembers)
      .where(eq(workChannelMembers.channelId, m.channelId))
    const byLower = new Map(members.map(r => [r.userId.toLowerCase(), r.userId]))
    const targets = new Set<string>(input.everyone ? byLower.values() : [])
    for (const id of input.explicitIds) {
      const real = byLower.get(id.toLowerCase())
      if (real) targets.add(real)
    }
    for (const id of [...targets]) {
      if (id.toLowerCase() === input.authorId.toLowerCase()) targets.delete(id)
    }
    if (targets.size === 0) return []
    await tx
      .insert(workMentions)
      .values([...targets].map(userId => ({ messageId: input.messageId, userId })))
      .onConflictDoNothing()
    return [...targets]
  })
}

/** 채널 멤버 중 알림 수준이 '모든 새 글'인 다른 사람이 있는가(원본 schedulePush의 채널 푸시 판정 — 5단계용) */
export async function hasAllLevelWatcher(
  channelId: string,
  exceptUserId: string
): Promise<boolean> {
  const rows = await db
    .select({ userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(
      and(
        eq(workChannelMembers.channelId, channelId),
        eq(workChannelMembers.notifyLevel, 'all'),
        sql`${workChannelMembers.userId} <> ${exceptUserId}`
      )
    )
    .limit(1)
  return rows.length > 0
}
