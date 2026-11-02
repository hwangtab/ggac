import {
  countNewActivityRows,
  countUnreadMentionRows,
  fetchInboxMessages,
  listActivityFeedRows,
  listBookmarkRecords,
  listMentionRecords,
  type InboxMessageRecord,
} from '@/db/queries/work/inbox'
import { getDisplayNames } from '@/db/queries/work/directory'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { messageLink } from '@work/lib/messages/anchor'
import { authorLabel } from '@work/lib/messages/author-label'
import { messageSnippet } from '@work/lib/search/text'
import type { WorkServerClient } from '@work/lib/supabase/server'

/**
 * 받은 멘션·북마크·활동(서버 전용) — 원본 kosmart-work `lib/inbox/queries.ts`와 **같은 이름·같은 결과 모양**.
 * 원본은 RLS가 읽을 수 없게 된 채널(내보내짐 등)의 메시지를 inner join에서 뺐다. 여기서는 읽기 범위를 명시한다.
 * '내 것'은 가드의 사용자로 읽는다(인자로 받은 userId를 믿지 않는다).
 */

export const INBOX_LIMIT = 100
const PREVIEW_MAX = 160
export const SENSITIVE_PREVIEW = '민감 정보가 포함된 메시지입니다. 열어서 확인하세요.'

export type InboxChannel = { id: string; name: string; slug: string | null; kind: string }

export type InboxItem = {
  messageId: string
  parentId: string | null
  channel: InboxChannel | null
  authorName: string
  /** 미리보기 한 줄(멘션 토큰 → @이름, 마크다운 기호 정리) */
  preview: string
  createdAt: string
  href: string
}

export type MentionItem = InboxItem & { readAt: string | null }
export type BookmarkItem = InboxItem & { bookmarkedAt: string }

function toItem(m: InboxMessageRecord): InboxItem {
  return {
    messageId: m.id,
    parentId: m.parent_id,
    channel: m.channels,
    authorName: authorLabel({ kind: m.kind, authorName: m.staff?.display_name, body: m.body }),
    preview: m.sensitive
      ? SENSITIVE_PREVIEW
      : messageSnippet(m.body, [], PREVIEW_MAX) || '(첨부 파일)',
    createdAt: m.created_at,
    href: messageLink({
      channelId: m.channel_id,
      kind: m.channels?.kind,
      slug: m.channels?.slug,
      messageId: m.id,
      parentId: m.parent_id,
    }),
  }
}

const byNewest = (a: InboxItem, b: InboxItem) => b.createdAt.localeCompare(a.createdAt)

async function scope(supabase: WorkServerClient) {
  return readableChannelIds(viewerOf(supabase))
}

/** 사이드바 "받은 멘션" 배지: 읽지 않은 멘션 수(지워진 메시지 제외). strict가 아니면 실패해도 0(로그) */
export async function countUnreadMentions(
  supabase: WorkServerClient,
  _userId: string,
  opts: { strict?: boolean } = {}
): Promise<number> {
  try {
    return await countUnreadMentionRows(supabase.user.id, await scope(supabase))
  } catch (e) {
    if (opts.strict) throw e
    console.error('[query] 읽지 않은 멘션 수 조회 실패:', e)
    return 0
  }
}

/** 받은 멘션(최근 메시지 순, 최대 INBOX_LIMIT) */
export async function listMyMentions(
  supabase: WorkServerClient,
  _userId: string
): Promise<MentionItem[]> {
  const rows = await listMentionRecords(supabase.user.id, await scope(supabase), INBOX_LIMIT)
  return rows.map(r => ({ ...toItem(r), readAt: r.read_at })).sort(byNewest)
}

/** 내 북마크(북마크한 순, 최대 INBOX_LIMIT) */
export async function listMyBookmarks(
  supabase: WorkServerClient,
  _userId: string
): Promise<BookmarkItem[]> {
  const rows = await listBookmarkRecords(supabase.user.id, await scope(supabase), INBOX_LIMIT)
  return rows.map(r => ({ ...toItem(r), bookmarkedAt: r.bookmarked_at }))
}

/** 활동 항목 종류: 내 스레드의 남의 답글 · 내 메시지에 남이 단 반응 */
export type ActivityKind = 'reply' | 'reaction'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  messageId: string
  parentId: string | null
  channel: InboxChannel | null
  actorName: string
  emoji: string | null
  preview: string
  createdAt: string
  href: string
  isNew: boolean
}

/** 새 답글·반응 수(레일 '활동' 배지). 멘션인 답글은 빠지므로 countUnreadMentions와 겹치지 않는다 */
export async function countNewActivity(
  supabase: WorkServerClient,
  opts: { strict?: boolean } = {}
): Promise<number> {
  try {
    return await countNewActivityRows(supabase.user.id, await scope(supabase))
  } catch (e) {
    if (opts.strict) throw e
    console.error('[query] 새 활동 수 조회 실패:', e)
    return 0
  }
}

/** 활동 피드(답글·반응, 최근 30일, 최신순). 읽을 수 없게 된 메시지는 빠진다 */
export async function listMyActivity(supabase: WorkServerClient): Promise<ActivityItem[]> {
  const readable = await scope(supabase)
  const events = await listActivityFeedRows(supabase.user.id, readable, INBOX_LIMIT)
  if (events.length === 0) return []

  const messages = await fetchInboxMessages(
    events.map(e => e.message_id),
    readable
  )
  const actors = await getDisplayNames(events.map(e => e.actor_id).filter((v): v is string => !!v))

  const items: ActivityItem[] = []
  for (const e of events) {
    const m = messages.get(e.message_id)
    if (!m) continue
    const base = toItem(m)
    const kind: ActivityKind = e.kind === 'reaction' ? 'reaction' : 'reply'
    items.push({
      id: `${kind}:${e.message_id}:${e.actor_id}:${e.emoji ?? ''}`,
      kind,
      messageId: base.messageId,
      parentId: base.parentId,
      channel: base.channel,
      actorName:
        kind === 'reply'
          ? base.authorName
          : ((e.actor_id ? actors.get(e.actor_id) : undefined) ?? '알 수 없는 사용자'),
      emoji: e.emoji,
      preview: base.preview,
      createdAt: new Date(e.event_at).toISOString(),
      href: base.href,
      isNew: e.is_new,
    })
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
