/**
 * 채널 접근 판정에 쓰는 **원자료**만 읽는다(권한 규칙은 모른다).
 * 규칙(원본 can_read_channel·is_channel_member·is_channel_owner, kosmart-work 0001·0037)은
 * `src/lib/server/boardWorkChannelAuth.ts`가 이 값으로 판정한다.
 */
import { and, eq, inArray } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workChannelMembers, workChannels, workMessages } from '../../schema/index.ts'

export type WorkChannelKind = 'public' | 'private' | 'dm'
export type WorkMemberRole = 'owner' | 'member'

export type ChannelAccessRow = {
  id: string
  kind: WorkChannelKind
  isGroup: boolean
  archived: boolean
  postPolicy: 'everyone' | 'owners'
  /** 조회한 사용자의 멤버십 역할. 멤버가 아니면 null */
  memberRole: WorkMemberRole | null
}

function normalizeKind(kind: string): WorkChannelKind {
  return kind === 'private' || kind === 'dm' ? kind : 'public'
}

function toAccess(row: {
  id: string
  kind: string
  isGroup: boolean
  archivedAt: Date | null
  postPolicy: string
  role: string | null
}): ChannelAccessRow {
  return {
    id: row.id,
    kind: normalizeKind(row.kind),
    isGroup: row.isGroup,
    archived: row.archivedAt !== null,
    postPolicy: row.postPolicy === 'owners' ? 'owners' : 'everyone',
    memberRole: row.role === 'owner' ? 'owner' : row.role === 'member' ? 'member' : null,
  }
}

const accessColumns = {
  id: workChannels.id,
  kind: workChannels.kind,
  isGroup: workChannels.isGroup,
  archivedAt: workChannels.archivedAt,
  postPolicy: workChannels.postPolicy,
  role: workChannelMembers.role,
}

/** 채널 한 개 + 그 사용자의 멤버십. 채널이 없으면 null */
export async function getChannelAccess(
  channelId: string,
  userId: string
): Promise<ChannelAccessRow | null> {
  const rows = await db
    .select(accessColumns)
    .from(workChannels)
    .leftJoin(
      workChannelMembers,
      and(eq(workChannelMembers.channelId, workChannels.id), eq(workChannelMembers.userId, userId))
    )
    .where(eq(workChannels.id, channelId))
    .limit(1)
  return rows[0] ? toAccess(rows[0]) : null
}

/**
 * 모든 채널(보관 포함) + 그 사용자의 멤버십. 읽기 범위 계산용 — 원본 `readable_channel_ids()`가
 * 채널마다 can_read_channel을 부른 것과 같은 자리다(이사 20명 규모라 채널 수가 작다).
 */
export async function listChannelAccess(userId: string): Promise<ChannelAccessRow[]> {
  const rows = await db
    .select(accessColumns)
    .from(workChannels)
    .leftJoin(
      workChannelMembers,
      and(eq(workChannelMembers.channelId, workChannels.id), eq(workChannelMembers.userId, userId))
    )
  return rows.map(toAccess)
}

/** 메시지 → 채널 id(원본 message_channel_id). 없는 메시지는 결과에 없다 */
export async function getMessageChannelIds(messageIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(messageIds)]
  if (ids.length === 0) return out
  const rows = await db
    .select({ id: workMessages.id, channelId: workMessages.channelId })
    .from(workMessages)
    .where(inArray(workMessages.id, ids))
  for (const r of rows) out.set(r.id, r.channelId)
  return out
}
