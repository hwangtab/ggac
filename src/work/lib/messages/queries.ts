import {
  fetchMessagePageRecords,
  fetchMessageRecord,
  fetchMessageRecords,
  fetchMyBookmarkedIds,
  fetchPinnedMessageIds,
  fetchThreadRecords,
  type WorkMessageRecord,
} from '@/db/queries/work/messages'
import { listAttachmentsForMessages, type ReadableScope } from '@/db/queries/work/files'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import {
  MESSAGE_PAGE_SIZE,
  QUOTE_BODY_MAX,
  sortAttachments,
  type AttachmentRow,
  type ChatMessage,
  type MessageCursor,
  type MessagePage,
} from './types'

/**
 * 메시지 조회(서버 전용) — 원본 kosmart-work `lib/messages/queries.ts`와 **같은 이름·같은 결과 모양**.
 * 원본은 RLS 클라이언트(`supabase`)가 읽을 수 없는 채널을 걸렀다. 여기서는 첫 인자(가드 결과 — `WorkServerClient`)로
 * 읽기 범위(원본 readable_channel_ids)를 계산해 쿼리 계층에 **명시적으로** 넘긴다.
 *
 * 첨부(attachments)는 원본 MESSAGE_COLUMNS 임베드처럼 메시지마다 붙인다(2단계 — 같은 읽기 범위로 한 번에 읽는다).
 */

/** 쿼리 계층 레코드 → 화면 메시지(원본 toChatMessage: 인용 본문은 앞부분만, 첨부는 정렬) */
export function toChatMessage(
  row: WorkMessageRecord,
  attachments: AttachmentRow[] = []
): ChatMessage {
  return {
    ...row,
    reactions: row.reactions ?? [],
    attachments: sortAttachments(attachments),
    quoted_message_id: row.quoted_message_id ?? null,
    quoted: row.quoted ? { ...row.quoted, body: row.quoted.body.slice(0, QUOTE_BODY_MAX) } : null,
    forwarded_from_id: row.forwarded_from_id ?? null,
    forwarded: row.forwarded ?? null,
  }
}

async function scope(supabase: WorkServerClient) {
  return readableChannelIds(viewerOf(supabase))
}

/** 메시지 id → 첨부(지워진 메시지는 첨부를 보이지 않는다 — 원본 attachments_select 는 삭제 메시지를 걸렀다) */
async function attachmentsByMessage(
  rows: Pick<WorkMessageRecord, 'id' | 'deleted_at' | 'attachments_count'>[],
  readable: ReadableScope
): Promise<Map<string, AttachmentRow[]>> {
  const out = new Map<string, AttachmentRow[]>()
  const ids = rows.filter(r => !r.deleted_at && r.attachments_count > 0).map(r => r.id)
  if (ids.length === 0) return out
  for (const a of await listAttachmentsForMessages(ids, readable)) {
    const list = out.get(a.message_id)
    if (list) list.push(a)
    else out.set(a.message_id, [a])
  }
  return out
}

/** 레코드 묶음 → 화면 메시지(첨부 임베드) */
async function toChatMessages(
  rows: WorkMessageRecord[],
  readable: ReadableScope
): Promise<ChatMessage[]> {
  const byMessage = await attachmentsByMessage(rows, readable)
  return rows.map(r => toChatMessage(r, byMessage.get(r.id) ?? []))
}

/**
 * 여러 메시지의 첨부(실시간 갱신 재조회 — 원본과 같은 키 모양). 읽을 수 없는 채널·지워진 메시지는 빈 배열.
 * 원본처럼 요청 id 마다 키를 둔다(첨부가 없으면 빈 배열).
 */
export async function fetchAttachmentsFor(
  supabase: WorkServerClient,
  messageIds: string[]
): Promise<Record<string, AttachmentRow[]>> {
  const ids = [...new Set(messageIds)].slice(0, 100)
  const out: Record<string, AttachmentRow[]> = {}
  for (const id of ids) out[id] = []
  if (ids.length === 0) return out
  const readable = await scope(supabase)
  // 지워진 메시지의 첨부는 돌려주지 않는다 — 읽을 수 있는 살아 있는 메시지만 먼저 고른다
  const live = (await fetchMessageRecords(ids, readable)).filter(m => !m.deleted_at)
  for (const a of await listAttachmentsForMessages(
    live.map(m => m.id),
    readable
  )) {
    out[a.message_id]?.push(a)
  }
  for (const id of ids) out[id] = sortAttachments(out[id])
  return out
}

/** 최상위 메시지 최신 limit개(+ before 커서). 오래된 것 → 최신 순. 읽을 수 없는 채널이면 빈 페이지 */
export async function fetchMessagePage(
  supabase: WorkServerClient,
  channelId: string,
  opts: { before?: MessageCursor; limit?: number } = {}
): Promise<MessagePage> {
  const readable = await scope(supabase)
  const before = opts.before
    ? { createdAt: new Date(opts.before.created_at), id: opts.before.id }
    : undefined
  const page = await fetchMessagePageRecords(channelId, readable, {
    before,
    limit: opts.limit ?? MESSAGE_PAGE_SIZE,
  })
  return { messages: await toChatMessages(page.messages, readable), hasMore: page.hasMore }
}

/** 스레드: 부모 + 답글 전부(오래된 순). 부모를 읽을 수 없으면 null */
export async function fetchThread(
  supabase: WorkServerClient,
  parentId: string
): Promise<{ parent: ChatMessage; replies: ChatMessage[] } | null> {
  const readable = await scope(supabase)
  const thread = await fetchThreadRecords(parentId, readable)
  if (!thread) return null
  const [parent, ...replies] = await toChatMessages([thread.parent, ...thread.replies], readable)
  return { parent, replies }
}

export async function fetchMessage(
  supabase: WorkServerClient,
  messageId: string
): Promise<ChatMessage | null> {
  const readable = await scope(supabase)
  const row = await fetchMessageRecord(messageId, readable)
  if (!row) return null
  const { sensitive: _sensitive, ...rest } = row
  const [message] = await toChatMessages([rest], readable)
  return message
}

/** 한 건 + 민감 표시(전달 액션 전용 — 화면 모양에는 sensitive가 없다) */
export async function fetchMessageWithSensitive(
  supabase: WorkServerClient,
  messageId: string
): Promise<{ message: ChatMessage; sensitive: boolean } | null> {
  const readable = await scope(supabase)
  const row = await fetchMessageRecord(messageId, readable)
  if (!row) return null
  const { sensitive, ...rest } = row
  const [message] = await toChatMessages([rest], readable)
  return { message, sensitive }
}

/** 채널 고정 메시지 id 목록(최근 고정 순) — 곁가지라 실패해도 화면을 죽이지 않는다(원본 soft) */
export async function fetchPinnedIds(
  supabase: WorkServerClient,
  channelId: string
): Promise<string[]> {
  try {
    return await fetchPinnedMessageIds(channelId, await scope(supabase))
  } catch (e) {
    console.error('[query] 고정 메시지 조회 실패:', e)
    return []
  }
}

/**
 * 내 북마크 중 주어진 메시지에 해당하는 것. 원본처럼 userId를 받지만 **가드의 사용자만** 본다
 * (원본은 RLS가 본인 행만 돌려줬다 — 남의 id를 넘겨도 남의 북마크가 보이지 않게).
 */
export async function fetchMyBookmarkIds(
  supabase: WorkServerClient,
  _userId: string,
  messageIds: string[]
): Promise<string[]> {
  try {
    return await fetchMyBookmarkedIds(supabase.user.id, messageIds)
  } catch (e) {
    console.error('[query] 북마크 조회 실패:', e)
    return []
  }
}

/**
 * id로 메시지 여러 건(폴링 신호 재조회). 읽을 수 없거나 없는 메시지는 결과에 없다. 순서는 보장하지 않는다.
 */
export async function fetchMessagesByIds(
  supabase: WorkServerClient,
  messageIds: string[]
): Promise<ChatMessage[]> {
  if (messageIds.length === 0) return []
  const readable = await scope(supabase)
  const rows = await fetchMessageRecords(messageIds.slice(0, 100), readable)
  return toChatMessages(rows, readable)
}

/** 고정 메시지 본문(우측 패널) — 고정 순서, 지워진 메시지 제외 */
export async function fetchPinnedMessages(
  supabase: WorkServerClient,
  channelId: string
): Promise<ChatMessage[]> {
  const readable = await scope(supabase)
  const ids = await fetchPinnedMessageIds(channelId, readable)
  if (ids.length === 0) return []
  const rows = await fetchMessageRecords(ids.slice(0, 100), readable)
  const order = new Map(ids.map((id, i) => [id, i]))
  return (await toChatMessages(rows, readable))
    .filter(m => !m.deleted_at)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}
