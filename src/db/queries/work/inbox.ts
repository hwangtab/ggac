/**
 * 받은 알림함(멘션·북마크·활동) 쿼리 계층 — 원본 kosmart-work `lib/inbox/queries.ts`의 조회와
 * RPC `my_activity_events`·`my_activity_seen_at`·`my_activity_feed`·`my_activity_new_count`(0019·0027)를 옮겼다.
 *
 * **권한을 모른다.** 원본은 security invoker RPC라 RLS(messages_select·reactions_select)가 읽을 수 없는 채널을
 * 걸렀다. 여기서는 호출부가 계산한 읽기 범위(`readable`)를 WHERE에 명시한다 — 빠뜨리면 그대로 새어 나간다.
 * "내 것"은 user_id를 명시한다(원본도 RLS에 더해 명시했다).
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  memberProfiles,
  workActivityReads,
  workBookmarks,
  workChannels,
  workMemberPrefs,
  workMentions,
  workMessages,
} from '../../schema/index.ts'

import { isoNN } from './_shared.ts'
import type { ReadableScope } from './messages.ts'

export type InboxChannelRecord = { id: string; name: string; slug: string | null; kind: string }

/** 원본 MESSAGE_EMBED(channels·staff 임베드 포함)와 같은 모양 */
export type InboxMessageRecord = {
  id: string
  channel_id: string
  parent_id: string | null
  author_id: string | null
  kind: string
  body: string
  sensitive: boolean
  created_at: string
  channels: InboxChannelRecord | null
  staff: { display_name: string } | null
}

const embedColumns = {
  id: workMessages.id,
  channelId: workMessages.channelId,
  parentId: workMessages.parentId,
  authorId: workMessages.authorId,
  kind: workMessages.kind,
  body: workMessages.body,
  sensitive: workMessages.sensitive,
  createdAt: workMessages.createdAt,
  chId: workChannels.id,
  chName: workChannels.name,
  chSlug: workChannels.slug,
  chKind: workChannels.kind,
  authorName: memberProfiles.displayName,
}

type EmbedRow = {
  id: string
  channelId: string
  parentId: string | null
  authorId: string | null
  kind: string
  body: string
  sensitive: boolean
  createdAt: Date
  chId: string
  chName: string
  chSlug: string | null
  chKind: string
  authorName: string | null
}

function toEmbed(r: EmbedRow): InboxMessageRecord {
  return {
    id: r.id,
    channel_id: r.channelId,
    parent_id: r.parentId,
    author_id: r.authorId,
    kind: r.kind,
    body: r.body,
    sensitive: r.sensitive,
    created_at: isoNN(r.createdAt),
    channels: { id: r.chId, name: r.chName, slug: r.chSlug, kind: r.chKind },
    staff: r.authorName != null ? { display_name: r.authorName } : null,
  }
}

function readableCond(readable: ReadableScope): SQL {
  const ids = [...readable]
  return ids.length > 0 ? inArray(workMessages.channelId, ids)! : sql`0`
}

function readableSqlList(readable: ReadableScope): SQL {
  return sql.join(
    [...readable].map(id => sql`${id}`),
    sql`, `
  )
}

/** 읽지 않은 멘션 수(지워진 메시지·읽을 수 없는 채널 제외) */
export async function countUnreadMentionRows(
  userId: string,
  readable: ReadableScope
): Promise<number> {
  if (readable.size === 0) return 0
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(workMentions)
    .innerJoin(workMessages, eq(workMessages.id, workMentions.messageId))
    .where(
      and(
        eq(workMentions.userId, userId),
        isNull(workMentions.readAt),
        isNull(workMessages.deletedAt),
        readableCond(readable)
      )
    )
  return Number(row?.n ?? 0)
}

/** 받은 멘션(최근 메시지 순) */
export async function listMentionRecords(
  userId: string,
  readable: ReadableScope,
  limit: number
): Promise<(InboxMessageRecord & { read_at: string | null })[]> {
  if (readable.size === 0) return []
  const rows = await db
    .select({ ...embedColumns, readAt: workMentions.readAt })
    .from(workMentions)
    .innerJoin(workMessages, eq(workMessages.id, workMentions.messageId))
    .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workMessages.authorId))
    .where(
      and(eq(workMentions.userId, userId), isNull(workMessages.deletedAt), readableCond(readable))
    )
    .orderBy(desc(workMessages.createdAt))
    .limit(limit)
  return rows.map(r => ({ ...toEmbed(r), read_at: r.readAt ? isoNN(r.readAt) : null }))
}

/** 내 북마크(북마크한 순) */
export async function listBookmarkRecords(
  userId: string,
  readable: ReadableScope,
  limit: number
): Promise<(InboxMessageRecord & { bookmarked_at: string })[]> {
  if (readable.size === 0) return []
  const rows = await db
    .select({ ...embedColumns, bookmarkedAt: workBookmarks.createdAt })
    .from(workBookmarks)
    .innerJoin(workMessages, eq(workMessages.id, workBookmarks.messageId))
    .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workMessages.authorId))
    .where(
      and(eq(workBookmarks.userId, userId), isNull(workMessages.deletedAt), readableCond(readable))
    )
    .orderBy(desc(workBookmarks.createdAt))
    .limit(limit)
  return rows.map(r => ({ ...toEmbed(r), bookmarked_at: isoNN(r.bookmarkedAt) }))
}

/** id로 메시지 임베드(지워지지 않은 것·읽을 수 있는 채널만) — 활동 피드가 이벤트에 붙인다 */
export async function fetchInboxMessages(
  messageIds: string[],
  readable: ReadableScope
): Promise<Map<string, InboxMessageRecord>> {
  const out = new Map<string, InboxMessageRecord>()
  const ids = [...new Set(messageIds)]
  if (ids.length === 0 || readable.size === 0) return out
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db
      .select(embedColumns)
      .from(workMessages)
      .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
      .leftJoin(memberProfiles, eq(memberProfiles.id, workMessages.authorId))
      .where(
        and(
          inArray(workMessages.id, ids.slice(i, i + 200)),
          isNull(workMessages.deletedAt),
          readableCond(readable)
        )
      )
    for (const r of rows) out.set(r.id, toEmbed(r))
  }
  return out
}

export type ActivityEventRow = {
  kind: 'reply' | 'reaction'
  message_id: string
  actor_id: string | null
  emoji: string | null
  /** epoch ms */
  event_at: number
}

/**
 * 원본 RPC `my_activity_events(p_since)`(0027판): 내 스레드의 남의 새 답글 + 내 메시지에 남이 단 반응.
 * - 답글: 지워지지 않은 답글·부모, 남이 씀, 나를 멘션한 답글은 뺀다(멘션으로 따로 센다),
 *         부모가 내 글이거나 내가 그 전에 답글을 단 스레드
 * - 반응: 지워지지 않은 내 메시지에 남이 단 것
 * - 알림을 '끔'으로 둔 채널은 뺀다
 * - **읽을 수 있는 채널만**(원본은 RLS가 걸렀다)
 */
export async function listActivityEventRows(
  userId: string,
  sinceMs: number,
  readable: ReadableScope,
  limit?: number
): Promise<ActivityEventRow[]> {
  if (readable.size === 0) return []
  const list = readableSqlList(readable)
  const notOff = (channelExpr: SQL) => sql`not exists (
      select 1 from work_channel_members off_cm
      where off_cm.channel_id = ${channelExpr}
        and off_cm.user_id = ${userId}
        and off_cm.notify_level = 'off')`
  const rows = await db.all<{
    kind: string
    message_id: string
    actor_id: string | null
    emoji: string | null
    event_at: number
  }>(sql`
    select * from (
      select 'reply' as kind, m.id as message_id, m.author_id as actor_id, null as emoji,
             m.created_at as event_at
      from work_messages m
      join work_messages p on p.id = m.parent_id
      where m.created_at > ${sinceMs}
        and m.deleted_at is null
        and p.deleted_at is null
        and m.channel_id in (${list})
        and (m.author_id is null or m.author_id <> ${userId})
        and not exists (
          select 1 from work_mentions mn where mn.message_id = m.id and mn.user_id = ${userId})
        and ${notOff(sql`m.channel_id`)}
        and (
          p.author_id = ${userId}
          or exists (
            select 1 from work_messages r
            where r.parent_id = m.parent_id
              and r.author_id = ${userId}
              and r.deleted_at is null
              and r.created_at < m.created_at)
        )
      union all
      select 'reaction' as kind, r.message_id as message_id, r.user_id as actor_id, r.emoji as emoji,
             r.created_at as event_at
      from work_reactions r
      join work_messages m on m.id = r.message_id
      where r.created_at > ${sinceMs}
        and m.deleted_at is null
        and m.channel_id in (${list})
        and m.author_id = ${userId}
        and r.user_id <> ${userId}
        and ${notOff(sql`m.channel_id`)}
    )
    order by event_at desc
    ${limit ? sql`limit ${limit}` : sql``}
  `)
  return rows.map(r => ({
    kind: r.kind === 'reaction' ? 'reaction' : 'reply',
    message_id: r.message_id,
    actor_id: r.actor_id,
    emoji: r.emoji,
    event_at: Number(r.event_at),
  }))
}

/**
 * 원본 RPC `my_activity_seen_at`: 활동을 마지막으로 확인한 시각.
 * 원본은 행이 없으면 **0019 배포 시각(2026-10-23 07:00 KST)을 하드코딩**했다 — 옛 활동이 한꺼번에 "새 활동"으로
 * 쏟아지지 않게. 여기서는 그 자리에 **이 사람이 업무툴에 처음 들어온 시각**(work_member_prefs.created_at —
 * `ensureWorkspaceEntryRows`가 첫 진입 때 만든다)을 쓰고, 그것도 없으면 epoch(0)이다.
 */
export async function getActivitySeenAtMs(userId: string): Promise<number> {
  const [read] = await db
    .select({ seenAt: workActivityReads.seenAt })
    .from(workActivityReads)
    .where(eq(workActivityReads.userId, userId))
    .limit(1)
  if (read) return read.seenAt.getTime()
  const [prefs] = await db
    .select({ createdAt: workMemberPrefs.createdAt })
    .from(workMemberPrefs)
    .where(eq(workMemberPrefs.userId, userId))
    .limit(1)
  return prefs ? prefs.createdAt.getTime() : 0
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** 원본 RPC `my_activity_feed(p_limit)`: 최근 30일, 최신순, 1~200개, is_new = 확인 시각 이후 */
export async function listActivityFeedRows(
  userId: string,
  readable: ReadableScope,
  limit = 100
): Promise<(ActivityEventRow & { is_new: boolean })[]> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 100, 1), 200)
  const [seenAt, events] = await Promise.all([
    getActivitySeenAtMs(userId),
    listActivityEventRows(userId, Date.now() - THIRTY_DAYS_MS, readable, capped),
  ])
  return events.map(e => ({ ...e, is_new: e.event_at > seenAt }))
}

/** 원본 RPC `my_activity_new_count`: max(확인 시각, 30일 전) 이후 활동 수 */
export async function countNewActivityRows(
  userId: string,
  readable: ReadableScope
): Promise<number> {
  const seenAt = await getActivitySeenAtMs(userId)
  const events = await listActivityEventRows(
    userId,
    Math.max(seenAt, Date.now() - THIRTY_DAYS_MS),
    readable
  )
  return events.length
}

// ── 쓰기(본인 행만 — user_id를 인자로 받아 고정) ────────────────────────────

export async function markMentionReadRow(userId: string, messageId: string): Promise<number> {
  const rows = await db
    .update(workMentions)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(workMentions.userId, userId),
        eq(workMentions.messageId, messageId),
        isNull(workMentions.readAt)
      )
    )
    .returning({ messageId: workMentions.messageId })
  return rows.length
}

export async function markAllMentionsReadRows(userId: string): Promise<number> {
  const rows = await db
    .update(workMentions)
    .set({ readAt: new Date() })
    .where(and(eq(workMentions.userId, userId), isNull(workMentions.readAt)))
    .returning({ messageId: workMentions.messageId })
  return rows.length
}

export async function removeBookmarkRow(userId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .delete(workBookmarks)
    .where(and(eq(workBookmarks.userId, userId), eq(workBookmarks.messageId, messageId)))
    .returning({ messageId: workBookmarks.messageId })
  return rows.length > 0
}

/** 활동 확인 시각 = 지금(원본 harden_activity_reads_write가 now()로 강제 — 값은 받지 않는다) */
export async function markActivitySeenRow(userId: string): Promise<void> {
  const now = new Date()
  await db
    .insert(workActivityReads)
    .values({ userId, seenAt: now })
    .onConflictDoUpdate({ target: workActivityReads.userId, set: { seenAt: now } })
}
