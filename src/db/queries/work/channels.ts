/**
 * 업무툴 채널·멤버십·그룹·카테고리 쿼리 계층 — 원본 kosmart-work `work.channels`·`channel_members`·
 * `channel_categories`와 그 트리거·RPC를 옮겼다(설계 §5).
 *
 * **권한을 모른다.** "이 사람이 채널을 만들·보관·멤버 추가할 수 있는가"(원본 RLS channels_update·
 * channel_members_insert …)는 호출부가 판정한다. 여기서는 원본 트리거가 지키던 데이터 규칙을 지킨다:
 * - add_channel_creator: 공개·비공개 채널을 만든 사람을 owner 멤버로 넣는다(DM 제외)
 * - harden_channels_write: DM은 post_policy를 바꾸지 않고(everyone 고정)·카테고리에 넣지 않는다
 * - harden_channel_members_write: 남을 넣을 때는 role 'member'·개인 설정(뮤트·별표·알림 수준) 기본값
 * - sync_member_notify_level(0027): muted ↔ notify_level='off'를 늘 같게
 * - channels_name_active_uidx(0013): 보관되지 않은 공개·비공개 채널 이름 유일(공백·대소문자 무시)
 * - 폴링: 사이드바 목록이 바뀌는 사람의 membership_rev를 올린다(§6-1)
 * RPC `my_channel_unread_counts`(0002)·`my_chat_last_activity`(0021)·`my_channel_last_activity`(0030)도 여기 있다.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  workChannelCategories,
  workChannelMembers,
  workChannels,
  workMemberPrefs,
  workMentions,
} from '../../schema/index.ts'

import type { WorkChannelKind, WorkMemberRole } from './access.ts'
import {
  bumpMembershipRev,
  channelMemberIds,
  iso,
  isoNN,
  WorkWriteError,
  type WorkExecutor,
} from './_shared.ts'
import { insertSystemMessage } from './messages.ts'

/** 원본 channels_name_active_uidx 판정 키(lower(btrim(name)) — 앱은 NFC로 맞춘 뒤 비교했다) */
export function channelNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase()
}

export type WorkChannelRecord = {
  id: string
  kind: WorkChannelKind
  slug: string | null
  name: string
  topic: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  dm_key: string | null
  is_group: boolean
  title: string | null
  post_policy: string
  category_id: string | null
  rev: number
}

const channelColumns = {
  id: workChannels.id,
  kind: workChannels.kind,
  slug: workChannels.slug,
  name: workChannels.name,
  topic: workChannels.topic,
  archivedAt: workChannels.archivedAt,
  createdBy: workChannels.createdBy,
  createdAt: workChannels.createdAt,
  dmKey: workChannels.dmKey,
  isGroup: workChannels.isGroup,
  title: workChannels.title,
  postPolicy: workChannels.postPolicy,
  categoryId: workChannels.categoryId,
  rev: workChannels.rev,
}

type ChannelSelect = {
  id: string
  kind: string
  slug: string | null
  name: string
  topic: string | null
  archivedAt: Date | null
  createdBy: string | null
  createdAt: Date
  dmKey: string | null
  isGroup: boolean
  title: string | null
  postPolicy: string
  categoryId: string | null
  rev: number
}

function kindOf(kind: string): WorkChannelKind {
  return kind === 'private' || kind === 'dm' ? kind : 'public'
}

function toChannel(r: ChannelSelect): WorkChannelRecord {
  return {
    id: r.id,
    kind: kindOf(r.kind),
    slug: r.slug,
    name: r.name,
    topic: r.topic,
    archived_at: iso(r.archivedAt),
    created_by: r.createdBy,
    created_at: isoNN(r.createdAt),
    dm_key: r.dmKey,
    is_group: r.isGroup,
    title: r.title,
    post_policy: r.postPolicy,
    category_id: r.categoryId,
    rev: r.rev,
  }
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

export async function getChannelRecordById(channelId: string): Promise<WorkChannelRecord | null> {
  const rows = await db
    .select(channelColumns)
    .from(workChannels)
    .where(eq(workChannels.id, channelId))
    .limit(1)
  return rows[0] ? toChannel(rows[0]) : null
}

/** slug → 공개·비공개 채널(DM 제외) */
export async function getChannelRecordBySlug(slug: string): Promise<WorkChannelRecord | null> {
  const rows = await db
    .select(channelColumns)
    .from(workChannels)
    .where(and(eq(workChannels.slug, slug), ne(workChannels.kind, 'dm')))
    .limit(1)
  return rows[0] ? toChannel(rows[0]) : null
}

export async function getChannelRecords(channelIds: string[]): Promise<WorkChannelRecord[]> {
  const ids = [...new Set(channelIds)]
  if (ids.length === 0) return []
  const rows = await db
    .select(channelColumns)
    .from(workChannels)
    .where(inArray(workChannels.id, ids))
  return rows.map(toChannel)
}

/** 보관 안 된 공개·비공개 채널(이름순) — /c 찾아보기 후보. 읽기 범위는 호출부가 거른다 */
export async function listActiveNonDmChannels(): Promise<WorkChannelRecord[]> {
  const rows = await db
    .select(channelColumns)
    .from(workChannels)
    .where(and(ne(workChannels.kind, 'dm'), isNull(workChannels.archivedAt)))
    .orderBy(asc(workChannels.name))
  return rows.map(toChannel)
}

export type MembershipWithChannel = {
  channel_id: string
  starred: boolean
  muted: boolean
  channel: WorkChannelRecord
}

/** 내가 멤버인(보관 안 된) 채널·DM·그룹 — 원본 listSidebarChannels의 첫 조회 */
export async function listMyActiveMemberships(userId: string): Promise<MembershipWithChannel[]> {
  const rows = await db
    .select({
      ...channelColumns,
      starred: workChannelMembers.starred,
      muted: workChannelMembers.muted,
    })
    .from(workChannelMembers)
    .innerJoin(workChannels, eq(workChannels.id, workChannelMembers.channelId))
    .where(and(eq(workChannelMembers.userId, userId), isNull(workChannels.archivedAt)))
  return rows.map(r => ({
    channel_id: r.id,
    starred: r.starred,
    muted: r.muted,
    channel: toChannel(r),
  }))
}

export type NotifyLevelOverride = {
  channel_id: string
  notify_level: string
  channel: { name: string; slug: string | null; kind: WorkChannelKind }
}

/**
 * 알림 수준을 기본값에서 바꾼(notify_level이 null이 아닌) 내 멤버십 — 원본 알림 설정 화면의
 * `channel_members … .not('notify_level','is',null)` 조회. 보관 채널도 포함한다(원본과 같다).
 */
export async function listNotifyLevelOverrides(userId: string): Promise<NotifyLevelOverride[]> {
  const rows = await db
    .select({
      channelId: workChannelMembers.channelId,
      notifyLevel: workChannelMembers.notifyLevel,
      name: workChannels.name,
      slug: workChannels.slug,
      kind: workChannels.kind,
    })
    .from(workChannelMembers)
    .innerJoin(workChannels, eq(workChannels.id, workChannelMembers.channelId))
    .where(and(eq(workChannelMembers.userId, userId), isNotNull(workChannelMembers.notifyLevel)))
    .orderBy(asc(workChannels.name))
  return rows.map(r => ({
    channel_id: r.channelId,
    notify_level: r.notifyLevel as string,
    channel: { name: r.name, slug: r.slug, kind: r.kind as WorkChannelKind },
  }))
}

/** 여러 채널의 멤버 id(그룹 이름 나열·같은 구성 그룹 찾기) */
export async function listMemberIdsByChannel(channelIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ids = [...new Set(channelIds)]
  if (ids.length === 0) return out
  const rows = await db
    .select({ channelId: workChannelMembers.channelId, userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(inArray(workChannelMembers.channelId, ids))
  for (const r of rows) {
    const list = out.get(r.channelId) ?? []
    list.push(r.userId)
    out.set(r.channelId, list)
  }
  return out
}

export type MembershipRecord = {
  role: WorkMemberRole
  last_read_at: string
  muted: boolean
  notify_level: string | null
  starred: boolean
}

export async function getMembershipRecord(
  channelId: string,
  userId: string
): Promise<MembershipRecord | null> {
  const rows = await db
    .select({
      role: workChannelMembers.role,
      lastReadAt: workChannelMembers.lastReadAt,
      muted: workChannelMembers.muted,
      notifyLevel: workChannelMembers.notifyLevel,
      starred: workChannelMembers.starred,
    })
    .from(workChannelMembers)
    .where(and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId)))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return {
    role: r.role === 'owner' ? 'owner' : 'member',
    last_read_at: isoNN(r.lastReadAt),
    muted: r.muted,
    notify_level: r.notifyLevel,
    starred: r.starred,
  }
}

export async function listChannelMemberRecords(
  channelId: string
): Promise<{ user_id: string; role: WorkMemberRole; joined_at: string }[]> {
  const rows = await db
    .select({
      userId: workChannelMembers.userId,
      role: workChannelMembers.role,
      joinedAt: workChannelMembers.joinedAt,
    })
    .from(workChannelMembers)
    .where(eq(workChannelMembers.channelId, channelId))
    .orderBy(asc(workChannelMembers.joinedAt))
  return rows.map(r => ({
    user_id: r.userId,
    role: r.role === 'owner' ? 'owner' : 'member',
    joined_at: isoNN(r.joinedAt),
  }))
}

/**
 * 원본 RPC `my_channel_unread_counts`(0002): 내가 멤버인 채널마다
 *  - unread  : last_read_at 이후, 남이 쓴, 지워지지 않은 최상위 메시지 수(스레드 답글 제외)
 *  - mentions: 그 채널 메시지(답글 포함)에서 나를 부른, 아직 읽지 않은 멘션 수(지워진 메시지 제외)
 * 멤버인 채널만 세므로 읽기 범위 인자가 따로 필요 없다(원본도 security invoker로 같은 범위였다).
 */
export async function countUnreadByChannel(
  userId: string
): Promise<Map<string, { unread: number; mentions: number }>> {
  const result = await db.all<{ channel_id: string; unread: number; mentions: number }>(sql`
    select cm.channel_id as channel_id,
      (select count(*) from work_messages m
        where m.channel_id = cm.channel_id
          and m.parent_id is null
          and m.deleted_at is null
          and m.created_at > cm.last_read_at
          and (m.author_id is null or m.author_id <> ${userId})) as unread,
      (select count(*) from work_mentions mn
        join work_messages m2 on m2.id = mn.message_id
        where mn.user_id = ${userId}
          and mn.read_at is null
          and m2.channel_id = cm.channel_id
          and m2.deleted_at is null) as mentions
    from work_channel_members cm
    where cm.user_id = ${userId}
  `)
  const map = new Map<string, { unread: number; mentions: number }>()
  for (const r of result) {
    map.set(r.channel_id, { unread: Number(r.unread ?? 0), mentions: Number(r.mentions ?? 0) })
  }
  return map
}

/**
 * 원본 RPC `my_chat_last_activity`(0021, DM·그룹만) · `my_channel_last_activity`(0030, 전부):
 * 내가 멤버인 채널마다 지워지지 않은 마지막 메시지(답글 포함) 시각(ms). 메시지가 없으면 결과에 없다.
 */
export async function lastActivityByChannel(
  userId: string,
  opts: { dmOnly?: boolean } = {}
): Promise<Map<string, number>> {
  const rows = await db.all<{ channel_id: string; last_at: number | null }>(sql`
    select cm.channel_id as channel_id,
      (select max(m.created_at) from work_messages m
        where m.channel_id = cm.channel_id and m.deleted_at is null) as last_at
    from work_channel_members cm
    join work_channels c on c.id = cm.channel_id
    where cm.user_id = ${userId} ${opts.dmOnly ? sql`and c.kind = 'dm'` : sql``}
  `)
  const map = new Map<string, number>()
  for (const r of rows) if (r.last_at != null) map.set(r.channel_id, Number(r.last_at))
  return map
}

export async function listCategoryRecords(): Promise<
  { id: string; name: string; position: number }[]
> {
  return db
    .select({
      id: workChannelCategories.id,
      name: workChannelCategories.name,
      position: workChannelCategories.position,
    })
    .from(workChannelCategories)
    .orderBy(asc(workChannelCategories.position), asc(workChannelCategories.createdAt))
}

/** 공지 채널(post_policy='owners') 중 내가 멤버인 것과 내 역할 — 전달 대상 제한 표시 */
export async function listMyOwnersPolicyChannels(
  userId: string
): Promise<{ id: string; role: WorkMemberRole }[]> {
  const rows = await db
    .select({ id: workChannels.id, role: workChannelMembers.role })
    .from(workChannelMembers)
    .innerJoin(workChannels, eq(workChannels.id, workChannelMembers.channelId))
    .where(and(eq(workChannelMembers.userId, userId), eq(workChannels.postPolicy, 'owners')))
  return rows.map(r => ({ id: r.id, role: r.role === 'owner' ? 'owner' : 'member' }))
}

/** slug 후보 중 이미 쓰인 것(base로 시작하는 slug) — 원본 createChannel의 like 조회 */
export async function listSlugsWithPrefix(base: string): Promise<string[]> {
  const rows = await db
    .select({ slug: workChannels.slug })
    .from(workChannels)
    .where(
      and(
        isNotNull(workChannels.slug),
        sql`substr(${workChannels.slug}, 1, ${base.length}) = ${base}`
      )
    )
    .limit(1000)
  return rows.map(r => r.slug).filter((s): s is string => !!s)
}

// ── 쓰기 공통 ────────────────────────────────────────────────────────────────

/** 보관 안 된 공개·비공개 채널 중 이름 키가 같은 것이 있나(exceptId 제외) */
async function hasActiveNameClash(
  tx: WorkExecutor,
  name: string,
  exceptId?: string
): Promise<boolean> {
  const rows = await tx
    .select({ id: workChannels.id, name: workChannels.name })
    .from(workChannels)
    .where(and(ne(workChannels.kind, 'dm'), isNull(workChannels.archivedAt)))
  const key = channelNameKey(name)
  return rows.some(r => r.id !== exceptId && channelNameKey(r.name) === key)
}

/** SQLite 유일성 위반인가(원본 23505 자리). libsql 오류는 code 'SQLITE_CONSTRAINT…'·메시지 'UNIQUE constraint failed' */
export function isSqliteUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>()
  let e: unknown = error
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e)
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof code === 'string' && /SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/.test(code)) return true
    if (typeof message === 'string' && message.includes('UNIQUE constraint failed')) return true
    e = cause
  }
  return false
}

/** harden_channel_members_write + sync_member_notify_level: 새 멤버 행(남을 넣을 때의 기본값) */
function newMemberRow(channelId: string, userId: string, role: WorkMemberRole = 'member') {
  const now = new Date()
  return {
    channelId,
    userId,
    role,
    muted: false,
    starred: false,
    notifyLevel: null,
    joinedAt: now,
    lastReadAt: now,
  }
}

// ── 채널 ─────────────────────────────────────────────────────────────────────

export type CreateChannelOutcome =
  | { status: 'created' }
  | { status: 'name_taken' }
  | { status: 'slug_taken' }
  | { status: 'category_missing' }

/**
 * 공개·비공개 채널 만들기 + 만든 사람을 owner로(add_channel_creator). 이름·slug 충돌과 카테고리 존재를
 * 같은 트랜잭션에서 다시 본다(유일 인덱스가 경합을 한 번 더 막는다).
 */
export async function createChannelRow(input: {
  id: string
  kind: 'public' | 'private'
  name: string
  slug: string
  topic: string | null
  categoryId: string | null
  creatorId: string
}): Promise<CreateChannelOutcome> {
  try {
    return await db.transaction(async tx => {
      if (await hasActiveNameClash(tx, input.name)) return { status: 'name_taken' } as const
      const [slugRow] = await tx
        .select({ id: workChannels.id })
        .from(workChannels)
        .where(eq(workChannels.slug, input.slug))
        .limit(1)
      if (slugRow) return { status: 'slug_taken' } as const
      if (input.categoryId) {
        const [cat] = await tx
          .select({ id: workChannelCategories.id })
          .from(workChannelCategories)
          .where(eq(workChannelCategories.id, input.categoryId))
          .limit(1)
        if (!cat) return { status: 'category_missing' } as const
      }
      await tx.insert(workChannels).values({
        id: input.id,
        kind: input.kind,
        name: input.name,
        slug: input.slug,
        topic: input.topic,
        categoryId: input.categoryId,
        createdBy: input.creatorId,
        dmKey: null,
        isGroup: false,
        title: null,
        archivedAt: null,
      })
      await tx
        .insert(workChannelMembers)
        .values(newMemberRow(input.id, input.creatorId, 'owner'))
        .onConflictDoNothing()
      await bumpMembershipRev(tx, [input.creatorId])
      return { status: 'created' } as const
    })
  } catch (e) {
    if (isSqliteUniqueViolation(e)) {
      const text =
        String((e as { message?: unknown })?.message ?? '') +
        String((e as { cause?: unknown })?.cause ?? '')
      return text.includes('slug') ? { status: 'slug_taken' } : { status: 'name_taken' }
    }
    throw e
  }
}

/** 멤버 추가(이미 있으면 그대로). 실제로 들어간 사람만 돌려주고 그 사람들의 membership_rev를 올린다 */
export async function addChannelMemberRows(
  channelId: string,
  userIds: string[]
): Promise<string[]> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  return db.transaction(async tx => {
    const inserted = await tx
      .insert(workChannelMembers)
      .values(ids.map(id => newMemberRow(channelId, id)))
      .onConflictDoNothing()
      .returning({ userId: workChannelMembers.userId })
    const added = inserted.map(r => r.userId)
    await bumpMembershipRev(tx, added)
    return added
  })
}

/** 본인 탈퇴(DM·그룹은 대상이 아니다 — 원본 channel_members_delete의 kind<>'dm'). 지웠으면 true */
export async function removeSelfFromChannel(channelId: string, userId: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [channel] = await tx
      .select({ kind: workChannels.kind })
      .from(workChannels)
      .where(eq(workChannels.id, channelId))
      .limit(1)
    if (!channel || channel.kind === 'dm') return false
    const removed = await tx
      .delete(workChannelMembers)
      .where(
        and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId))
      )
      .returning({ userId: workChannelMembers.userId })
    if (removed.length === 0) return false
    await bumpMembershipRev(tx, [userId])
    return true
  })
}

/** 주제 바꾸기. 채널이 없으면 null */
export async function setChannelTopicRow(
  channelId: string,
  topic: string | null
): Promise<{ topic: string | null } | null> {
  const rows = await db
    .update(workChannels)
    .set({ topic })
    .where(eq(workChannels.id, channelId))
    .returning({ topic: workChannels.topic })
  return rows[0] ?? null
}

/** 글쓰기 권한(DM은 바꾸지 않는다 — harden_channels_write가 everyone으로 고정) */
export async function setChannelPostPolicyRow(
  channelId: string,
  policy: 'everyone' | 'owners'
): Promise<{ post_policy: string } | null> {
  const rows = await db
    .update(workChannels)
    .set({ postPolicy: policy })
    .where(and(eq(workChannels.id, channelId), ne(workChannels.kind, 'dm')))
    .returning({ postPolicy: workChannels.postPolicy })
  return rows[0] ? { post_policy: rows[0].postPolicy } : null
}

/** 보관(DM 제외, 보관 안 된 것만). 멤버 전원의 사이드바가 바뀐다 */
export async function archiveChannelRow(
  channelId: string
): Promise<{ id: string; name: string } | null> {
  return db.transaction(async tx => {
    const rows = await tx
      .update(workChannels)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(workChannels.id, channelId),
          ne(workChannels.kind, 'dm'),
          isNull(workChannels.archivedAt)
        )
      )
      .returning({ id: workChannels.id, name: workChannels.name })
    if (!rows[0]) return null
    await bumpMembershipRev(tx, await channelMemberIds(tx, channelId))
    return rows[0]
  })
}

/** 보관 해제(같은 이름의 보관 안 된 채널이 있으면 거부) */
export async function unarchiveChannelRow(
  channelId: string
): Promise<{ status: 'ok' } | { status: 'name_taken' } | { status: 'not_archived' }> {
  try {
    return await db.transaction(async tx => {
      const [channel] = await tx
        .select({
          name: workChannels.name,
          archivedAt: workChannels.archivedAt,
          kind: workChannels.kind,
        })
        .from(workChannels)
        .where(eq(workChannels.id, channelId))
        .limit(1)
      if (!channel || channel.kind === 'dm' || !channel.archivedAt) {
        return { status: 'not_archived' } as const
      }
      if (await hasActiveNameClash(tx, channel.name, channelId)) {
        return { status: 'name_taken' } as const
      }
      await tx.update(workChannels).set({ archivedAt: null }).where(eq(workChannels.id, channelId))
      await bumpMembershipRev(tx, await channelMemberIds(tx, channelId))
      return { status: 'ok' } as const
    })
  } catch (e) {
    if (isSqliteUniqueViolation(e)) return { status: 'name_taken' }
    throw e
  }
}

/** 채널을 카테고리로(null=기타). DM은 대상이 아니다. 카테고리가 없으면 category_missing */
export async function moveChannelCategoryRow(
  channelId: string,
  categoryId: string | null
): Promise<{ status: 'ok' } | { status: 'not_found' } | { status: 'category_missing' }> {
  return db.transaction(async tx => {
    if (categoryId) {
      const [cat] = await tx
        .select({ id: workChannelCategories.id })
        .from(workChannelCategories)
        .where(eq(workChannelCategories.id, categoryId))
        .limit(1)
      if (!cat) return { status: 'category_missing' } as const
    }
    const rows = await tx
      .update(workChannels)
      .set({ categoryId })
      .where(and(eq(workChannels.id, channelId), ne(workChannels.kind, 'dm')))
      .returning({ id: workChannels.id })
    return rows[0] ? ({ status: 'ok' } as const) : ({ status: 'not_found' } as const)
  })
}

// ── 내 멤버십 설정 ──────────────────────────────────────────────────────────

/**
 * 별표·뮤트(본인 행). 뮤트는 sync_member_notify_level 규칙으로 알림 수준과 맞춘다:
 * 켜면 notify_level='off', 끄면 'off'였던 것만 기본(null)으로.
 */
export async function setMemberFlagRow(
  channelId: string,
  userId: string,
  column: 'starred' | 'muted',
  value: boolean
): Promise<boolean> {
  return db.transaction(async tx => {
    const where = and(
      eq(workChannelMembers.channelId, channelId),
      eq(workChannelMembers.userId, userId)
    )
    const [current] = await tx
      .select({ notifyLevel: workChannelMembers.notifyLevel })
      .from(workChannelMembers)
      .where(where)
      .limit(1)
    if (!current) return false
    if (column === 'starred') {
      await tx.update(workChannelMembers).set({ starred: value }).where(where)
    } else {
      const notifyLevel = value ? 'off' : current.notifyLevel === 'off' ? null : current.notifyLevel
      await tx.update(workChannelMembers).set({ muted: value, notifyLevel }).where(where)
    }
    return true
  })
}

/** 알림 수준(본인 행). muted는 notify_level='off'와 같게(sync_member_notify_level) */
export async function setNotifyLevelRow(
  channelId: string,
  userId: string,
  stored: 'all' | 'mentions' | 'off' | null
): Promise<boolean> {
  const rows = await db
    .update(workChannelMembers)
    .set({ notifyLevel: stored, muted: stored === 'off' })
    .where(and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId)))
    .returning({ userId: workChannelMembers.userId })
  return rows.length > 0
}

/** 읽음: last_read_at = readAt, 그 채널(답글 포함)의 내 안 읽은 멘션 read_at = readAt. 지운 멘션 수를 돌려준다 */
export async function markChannelReadRow(
  channelId: string,
  userId: string,
  readAt: Date
): Promise<number> {
  return db.transaction(async tx => {
    await tx
      .update(workChannelMembers)
      .set({ lastReadAt: readAt })
      .where(
        and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId))
      )
    const cleared = await tx
      .update(workMentions)
      .set({ readAt })
      .where(
        and(
          eq(workMentions.userId, userId),
          isNull(workMentions.readAt),
          sql`${workMentions.messageId} in (select id from work_messages where channel_id = ${channelId})`
        )
      )
      .returning({ messageId: workMentions.messageId })
    return cleared.length
  })
}

// ── DM·그룹 ─────────────────────────────────────────────────────────────────

/**
 * DM 열기: dm_key로 찾고 없으면 만든다(kind 'dm', name 'dm' — 원본 service_role 경로). 두 사람을 멤버로
 * (자기 자신과의 DM이면 한 명). 새로 생겼거나 멤버가 새로 들어간 사람의 membership_rev를 올린다.
 */
export async function openDmRow(input: {
  key: string
  creatorId: string
  memberIds: string[]
}): Promise<{ id: string }> {
  const attempt = () =>
    db.transaction(async tx => {
      const [existing] = await tx
        .select({ id: workChannels.id })
        .from(workChannels)
        .where(and(eq(workChannels.dmKey, input.key), eq(workChannels.kind, 'dm')))
        .limit(1)
      let id = existing?.id
      if (!id) {
        id = crypto.randomUUID()
        await tx.insert(workChannels).values({
          id,
          kind: 'dm',
          name: 'dm',
          slug: null,
          dmKey: input.key,
          isGroup: false,
          createdBy: input.creatorId,
        })
      }
      const inserted = await tx
        .insert(workChannelMembers)
        .values([...new Set(input.memberIds)].map(u => newMemberRow(id!, u)))
        .onConflictDoNothing()
        .returning({ userId: workChannelMembers.userId })
      await bumpMembershipRev(
        tx,
        inserted.map(r => r.userId)
      )
      return { id }
    })
  try {
    return await attempt()
  } catch (e) {
    // 동시에 상대도 DM을 열었다(dm_key 유일 충돌) — 그쪽 행을 쓴다
    if (isSqliteUniqueViolation(e)) return attempt()
    throw e
  }
}

/** 그룹 만들기(kind 'dm' + is_group, dm_key 'group:<id>', name 'group'). 멤버 전원의 membership_rev */
export async function createGroupRow(input: {
  id: string
  creatorId: string
  memberIds: string[]
  title: string | null
}): Promise<void> {
  await db.transaction(async tx => {
    await tx.insert(workChannels).values({
      id: input.id,
      kind: 'dm',
      isGroup: true,
      name: 'group',
      title: input.title,
      dmKey: `group:${input.id.toLowerCase()}`,
      slug: null,
      createdBy: input.creatorId,
    })
    const members = [...new Set(input.memberIds)]
    await tx
      .insert(workChannelMembers)
      .values(members.map(u => newMemberRow(input.id, u)))
      .onConflictDoNothing()
    await bumpMembershipRev(tx, members)
  })
}

/** 그룹 채널의 멤버 id. 그룹이 아니거나 없으면 null */
export async function getGroupMemberIds(channelId: string): Promise<string[] | null> {
  const [channel] = await db
    .select({ id: workChannels.id })
    .from(workChannels)
    .where(and(eq(workChannels.id, channelId), eq(workChannels.isGroup, true)))
    .limit(1)
  if (!channel) return null
  const rows = await db
    .select({ userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(eq(workChannelMembers.channelId, channelId))
  return rows.map(r => r.userId)
}

/** 내가 속한 이름 없는 그룹(channelId → 멤버 id) — 같은 구성 그룹 찾기(Q2) */
export async function listMyUnnamedGroups(userId: string): Promise<Map<string, string[]>> {
  const mine = await db
    .select({ id: workChannels.id })
    .from(workChannelMembers)
    .innerJoin(workChannels, eq(workChannels.id, workChannelMembers.channelId))
    .where(
      and(
        eq(workChannelMembers.userId, userId),
        eq(workChannels.isGroup, true),
        isNull(workChannels.title)
      )
    )
    .orderBy(asc(workChannels.createdAt))
  return listMemberIdsByChannel(mine.map(r => r.id))
}

/** 그룹에 사람 추가 + 시스템 메시지(한 트랜잭션). 들어간 사람 id */
export async function addGroupMemberRows(input: {
  channelId: string
  actorId: string
  userIds: string[]
  systemBody: string
}): Promise<string[]> {
  return db.transaction(async tx => {
    const inserted = await tx
      .insert(workChannelMembers)
      .values([...new Set(input.userIds)].map(u => newMemberRow(input.channelId, u)))
      .onConflictDoNothing()
      .returning({ userId: workChannelMembers.userId })
    const added = inserted.map(r => r.userId)
    if (added.length > 0) {
      await insertSystemMessage(tx, {
        channelId: input.channelId,
        authorId: input.actorId,
        body: input.systemBody,
      })
      await bumpMembershipRev(tx, await channelMemberIds(tx, input.channelId))
    }
    return added
  })
}

/** 그룹 이름 바꾸기 + 시스템 메시지. 멤버 전원의 사이드바 이름이 바뀐다 */
export async function renameGroupRow(input: {
  channelId: string
  actorId: string
  title: string | null
  systemBody: string
}): Promise<boolean> {
  return db.transaction(async tx => {
    const rows = await tx
      .update(workChannels)
      .set({ title: input.title })
      .where(and(eq(workChannels.id, input.channelId), eq(workChannels.isGroup, true)))
      .returning({ id: workChannels.id })
    if (!rows[0]) return false
    await insertSystemMessage(tx, {
      channelId: input.channelId,
      authorId: input.actorId,
      body: input.systemBody,
    })
    await bumpMembershipRev(tx, await channelMemberIds(tx, input.channelId))
    return true
  })
}

/** 그룹 나가기: 시스템 메시지를 먼저 남기고(남은 사람이 본다) 내 행을 지운다 */
export async function leaveGroupRow(input: {
  channelId: string
  userId: string
  systemBody: string
}): Promise<boolean> {
  return db.transaction(async tx => {
    await insertSystemMessage(tx, {
      channelId: input.channelId,
      authorId: input.userId,
      body: input.systemBody,
    })
    const removed = await tx
      .delete(workChannelMembers)
      .where(
        and(
          eq(workChannelMembers.channelId, input.channelId),
          eq(workChannelMembers.userId, input.userId)
        )
      )
      .returning({ userId: workChannelMembers.userId })
    if (removed.length === 0) throw new WorkWriteError('not_found', '참여 중인 그룹이 아닙니다')
    await bumpMembershipRev(
      tx,
      await channelMemberIds(tx, input.channelId).then(ids => [...ids, input.userId])
    )
    return true
  })
}

/** 그룹에서 내보내기: 지운 뒤 시스템 메시지(내보낸 사람에게는 보이지 않게) */
export async function removeGroupMemberRow(input: {
  channelId: string
  actorId: string
  targetId: string
  systemBody: string
}): Promise<boolean> {
  return db.transaction(async tx => {
    const removed = await tx
      .delete(workChannelMembers)
      .where(
        and(
          eq(workChannelMembers.channelId, input.channelId),
          eq(workChannelMembers.userId, input.targetId)
        )
      )
      .returning({ userId: workChannelMembers.userId })
    if (removed.length === 0) return false
    await insertSystemMessage(tx, {
      channelId: input.channelId,
      authorId: input.actorId,
      body: input.systemBody,
    })
    await bumpMembershipRev(tx, [...(await channelMemberIds(tx, input.channelId)), input.targetId])
    return true
  })
}

// ── 카테고리 ────────────────────────────────────────────────────────────────

async function hasCategoryNameClash(tx: WorkExecutor, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: workChannelCategories.id, name: workChannelCategories.name })
    .from(workChannelCategories)
  const key = name.trim().toLowerCase()
  return rows.some(r => r.id !== exceptId && r.name.trim().toLowerCase() === key)
}

export async function createCategoryRow(input: {
  id: string
  name: string
  createdBy: string
}): Promise<{ status: 'created'; position: number } | { status: 'conflict' }> {
  try {
    return await db.transaction(async tx => {
      if (await hasCategoryNameClash(tx, input.name)) return { status: 'conflict' } as const
      const [last] = await tx
        .select({ position: workChannelCategories.position })
        .from(workChannelCategories)
        .orderBy(desc(workChannelCategories.position))
        .limit(1)
      const position = (last?.position ?? -1) + 1
      await tx
        .insert(workChannelCategories)
        .values({ id: input.id, name: input.name, position, createdBy: input.createdBy })
      return { status: 'created', position } as const
    })
  } catch (e) {
    if (isSqliteUniqueViolation(e)) return { status: 'conflict' }
    throw e
  }
}

export async function renameCategoryRow(
  categoryId: string,
  name: string
): Promise<'ok' | 'not_found' | 'conflict'> {
  try {
    return await db.transaction(async tx => {
      if (await hasCategoryNameClash(tx, name, categoryId)) return 'conflict' as const
      const rows = await tx
        .update(workChannelCategories)
        .set({ name })
        .where(eq(workChannelCategories.id, categoryId))
        .returning({ id: workChannelCategories.id })
      return rows[0] ? ('ok' as const) : ('not_found' as const)
    })
  } catch (e) {
    if (isSqliteUniqueViolation(e)) return 'conflict'
    throw e
  }
}

/** ids 순서대로 position 0..을 다시 매긴다(ids에 없는 카테고리는 그대로) */
export async function reorderCategoryRows(ids: string[]): Promise<void> {
  await db.transaction(async tx => {
    for (const [position, id] of ids.entries()) {
      await tx
        .update(workChannelCategories)
        .set({ position })
        .where(eq(workChannelCategories.id, id))
    }
  })
}

/** 삭제 — 안의 채널은 기타로(FK on delete set null) */
export async function deleteCategoryRow(categoryId: string): Promise<{ name: string } | null> {
  const rows = await db
    .delete(workChannelCategories)
    .where(eq(workChannelCategories.id, categoryId))
    .returning({ name: workChannelCategories.name })
  return rows[0] ?? null
}

// ── 첫 진입(#전체) ──────────────────────────────────────────────────────────

export const EVERYONE_CHANNEL_SLUG = '전체'
export const EVERYONE_CHANNEL_NAME = '전체'

/**
 * 처음 들어온 사람을 `#전체` 공개 채널에 넣는다(설계 §3 — 원본의 초대 수락 단계 자리). 채널이 없으면 만든다
 * (만든 사람 없음 → owner 없음, 관리자가 관리한다). prefs 행도 이때 생긴다 — 그 created_at이 "처음 들어온 시각"이고
 * 활동 확인 시각의 기본값으로 쓴다(inbox.ts). 이미 다 돼 있으면 쓰지 않는다(읽기 2번).
 */
export async function ensureWorkspaceEntryRows(
  userId: string
): Promise<{ channelId: string | null }> {
  const findChannel = async (tx: WorkExecutor) => {
    const [bySlug] = await tx
      .select({ id: workChannels.id })
      .from(workChannels)
      .where(and(eq(workChannels.slug, EVERYONE_CHANNEL_SLUG), ne(workChannels.kind, 'dm')))
      .limit(1)
    return bySlug?.id ?? null
  }
  const channelId = await findChannel(db)
  if (channelId) {
    const [member] = await db
      .select({ userId: workChannelMembers.userId })
      .from(workChannelMembers)
      .where(
        and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId))
      )
      .limit(1)
    const [prefs] = await db
      .select({ userId: workMemberPrefs.userId })
      .from(workMemberPrefs)
      .where(eq(workMemberPrefs.userId, userId))
      .limit(1)
    if (member && prefs) return { channelId }
  }
  return db.transaction(async tx => {
    await tx.insert(workMemberPrefs).values({ userId }).onConflictDoNothing()
    let id = await findChannel(tx)
    if (!id) {
      const clash = await hasActiveNameClash(tx, EVERYONE_CHANNEL_NAME)
      if (clash) {
        // 같은 이름의 다른 채널이 이미 있다(관리자가 만든 것) — 자동 채널은 만들지 않는다
        return { channelId: null }
      }
      // 동시에 처음 들어온 두 사람이 함께 만들 수 있다 — 유일 인덱스 충돌은 무시하고 다시 찾는다
      await tx
        .insert(workChannels)
        .values({
          id: crypto.randomUUID(),
          kind: 'public',
          name: EVERYONE_CHANNEL_NAME,
          slug: EVERYONE_CHANNEL_SLUG,
          topic: '이사회 업무툴 전체 공지와 이야기',
          createdBy: null,
        })
        .onConflictDoNothing()
      id = await findChannel(tx)
      if (!id) return { channelId: null }
    }
    const inserted = await tx
      .insert(workChannelMembers)
      .values(newMemberRow(id, userId))
      .onConflictDoNothing()
      .returning({ userId: workChannelMembers.userId })
    if (inserted.length > 0) await bumpMembershipRev(tx, [userId])
    return { channelId: id }
  })
}
