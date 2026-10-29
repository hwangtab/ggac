/**
 * 폴링 동기화(`POST /api/board-room/work/sync`, 설계 §6·docs/board-work/02-sync.md)의 데이터 접근.
 * 원본 Realtime(브로드캐스트·Presence·typing)의 자리다. 권한을 모른다 — 어떤 채널을 물어도 되는지는
 * 라우트가 읽기 범위로 먼저 거른다. 여기 함수는 받은 채널 id만 본다.
 */
import { and, eq, gt, inArray, ne } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workChannels, workMemberPrefs, workPresence, workTyping } from '../../schema/index.ts'

export type ChannelRevRow = { rev: number; pinsRev: number; tabsRev: number }

export async function getChannelRevs(channelIds: string[]): Promise<Map<string, ChannelRevRow>> {
  const out = new Map<string, ChannelRevRow>()
  const ids = [...new Set(channelIds)]
  if (ids.length === 0) return out
  const rows = await db
    .select({
      id: workChannels.id,
      rev: workChannels.rev,
      pinsRev: workChannels.pinsRev,
      tabsRev: workChannels.tabsRev,
    })
    .from(workChannels)
    .where(inArray(workChannels.id, ids))
  for (const r of rows) out.set(r.id, { rev: r.rev, pinsRev: r.pinsRev, tabsRev: r.tabsRev })
  return out
}

/** 사용자 단위 변경 번호(prefs 행이 없으면 0) */
export async function getMembershipRev(userId: string): Promise<number> {
  const [row] = await db
    .select({ rev: workMemberPrefs.membershipRev })
    .from(workMemberPrefs)
    .where(eq(workMemberPrefs.userId, userId))
    .limit(1)
  return row?.rev ?? 0
}

/** 입력 중(덮어쓴다). scope: 스레드 부모 id, 채널 입력창이면 '' */
export async function upsertTyping(
  channelId: string,
  scope: string,
  userId: string,
  at: Date
): Promise<void> {
  await db
    .insert(workTyping)
    .values({ channelId, scope, userId, at })
    .onConflictDoUpdate({
      target: [workTyping.channelId, workTyping.scope, workTyping.userId],
      set: { at },
    })
}

/** 이 채널에서 since 이후 입력 중인 사람(나 제외) */
export async function listTyping(
  channelId: string,
  since: Date,
  exceptUserId: string
): Promise<{ user_id: string; scope: string; at: number }[]> {
  const rows = await db
    .select({ userId: workTyping.userId, scope: workTyping.scope, at: workTyping.at })
    .from(workTyping)
    .where(
      and(
        eq(workTyping.channelId, channelId),
        gt(workTyping.at, since),
        ne(workTyping.userId, exceptUserId)
      )
    )
  return rows.map(r => ({ user_id: r.userId, scope: r.scope, at: r.at.getTime() }))
}

/** since 이후 접속한 사람(나 포함) */
export async function listPresence(since: Date): Promise<{ user_id: string; last_seen: number }[]> {
  const rows = await db
    .select({ userId: workPresence.userId, lastSeenAt: workPresence.lastSeenAt })
    .from(workPresence)
    .where(gt(workPresence.lastSeenAt, since))
  return rows.map(r => ({ user_id: r.userId, last_seen: r.lastSeenAt.getTime() }))
}

export async function getPresence(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ lastSeenAt: workPresence.lastSeenAt })
    .from(workPresence)
    .where(eq(workPresence.userId, userId))
    .limit(1)
  return row ? row.lastSeenAt.getTime() : null
}

export async function touchPresence(userId: string, at: Date): Promise<void> {
  await db
    .insert(workPresence)
    .values({ userId, lastSeenAt: at })
    .onConflictDoUpdate({ target: workPresence.userId, set: { lastSeenAt: at } })
}
