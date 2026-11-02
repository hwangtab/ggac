import { cache } from 'react'
import { canAccessBoardRoom } from '@/lib/server/authz'
import {
  readableChannelIds,
  viewerOf,
  visibleStaffIds,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import {
  countUnreadByChannel,
  getChannelRecordById,
  getChannelRecordBySlug,
  getMembershipRecord,
  lastActivityByChannel,
  listActiveNonDmChannels,
  listCategoryRecords,
  listChannelMemberRecords,
  listMemberIdsByChannel,
  listMyActiveMemberships,
  type WorkChannelRecord,
} from '@/db/queries/work/channels'
import { getDisplayNames, listWorkPeople, type WorkPersonRow } from '@/db/queries/work/directory'
import type { ChannelListItem } from '@work/components/layout/channel-items'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { ChannelCategory } from './sections'
import { otherDmUserId } from './dm'
import { dmPeerFromKey } from './dm-peers'
import { groupDisplayName } from './group'
import { normalizePostPolicy } from './post-policy'
import type {
  BrowsableChannel,
  ChannelDetail,
  ChannelMemberSummary,
  MyMembership,
  StaffSummary,
} from './types'

/**
 * 채널 조회(서버 전용) — 원본 kosmart-work `lib/channels/queries.ts`와 **같은 이름·같은 결과 모양**.
 * 첫 인자는 원본의 RLS 클라이언트 자리인 가드 결과(`WorkServerClient`)다. 원본 RLS가 하던 거르기를
 * 여기서 읽기 범위(`readableChannelIds`)로 명시한다. '내 것'은 인자로 받은 userId가 아니라 **가드의 사용자**로 읽는다
 * (원본은 RLS가 본인 행만 돌려줬으므로, 남의 id를 넘겨도 결과가 바뀌지 않아야 한다).
 */

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko')

export type SidebarChannels = {
  channels: ChannelListItem[]
  dms: ChannelListItem[]
  /** 1:1 DM 채널 id → 상대 user_id (접속 점 매핑) */
  dmPeers: Record<string, string>
}

export type UnreadCounts = Map<string, { unread: number; mentions: number }>

function me(supabase: WorkServerClient): WorkViewer {
  return viewerOf(supabase)
}

/** 원본 RPC my_channel_unread_counts. strict가 아니면 실패해도 사이드바를 죽이지 않는다(로그) */
export async function fetchUnreadCounts(
  supabase: WorkServerClient,
  opts: { strict?: boolean } = {}
): Promise<UnreadCounts> {
  try {
    return await countUnreadByChannel(supabase.user.id)
  } catch (e) {
    if (opts.strict) throw e
    console.error('[query] 안 읽은 수 조회 실패:', e)
    return new Map()
  }
}

async function softNames(ids: string[]): Promise<Map<string, string>> {
  try {
    return await getDisplayNames(ids)
  } catch (e) {
    console.error('[query] 이름 조회 실패:', e)
    return new Map()
  }
}

/**
 * 사이드바: 내가 멤버인(보관 안 된) 채널과 채팅(1:1 DM·그룹).
 * channels는 이름순, dms(채팅)는 최근 활동순(마지막 메시지가 없는 대화는 맨 뒤에 이름순).
 */
export async function listSidebarChannels(
  supabase: WorkServerClient,
  _userId: string
): Promise<SidebarChannels> {
  const userId = supabase.user.id
  const [rows, counts] = await Promise.all([
    listMyActiveMemberships(userId),
    fetchUnreadCounts(supabase),
  ])

  const dmPeerIds = new Set<string>()
  const dmPeers: Record<string, string> = {}
  const groupIds: string[] = []
  for (const row of rows) {
    const c = row.channel
    if (c.kind !== 'dm') continue
    if (c.is_group) {
      groupIds.push(c.id)
      continue
    }
    const other = otherDmUserId(c.dm_key, userId)
    if (other) dmPeerIds.add(other)
    const peer = dmPeerFromKey(c.dm_key, userId)
    if (peer) dmPeers[c.id] = peer
  }

  const [groupMembers, lastActivity] = await Promise.all([
    groupIds.length > 0
      ? listMemberIdsByChannel(groupIds).catch(e => {
          console.error('[query] 그룹 멤버 조회 실패:', e)
          return new Map<string, string[]>()
        })
      : Promise.resolve(new Map<string, string[]>()),
    lastActivityByChannel(userId).catch(e => {
      console.error('[query] 최근 활동 조회 실패:', e)
      return new Map<string, number>()
    }),
  ])
  const nameIds = new Set(dmPeerIds)
  for (const list of groupMembers.values()) for (const id of list) nameIds.add(id)
  const names = await softNames([...nameIds])

  const channels: ChannelListItem[] = []
  const dms: ChannelListItem[] = []
  for (const row of rows) {
    const c = row.channel
    const count = counts.get(c.id)
    const base = {
      id: c.id,
      kind: c.kind,
      unread: count?.unread ?? 0,
      mentions: count?.mentions ?? 0,
      starred: row.starred,
      muted: row.muted,
      ...(lastActivity.has(c.id) ? { lastActivityAt: lastActivity.get(c.id) } : {}),
    }
    if (c.kind === 'dm' && c.is_group) {
      const members = (groupMembers.get(c.id) ?? []).map(id => ({
        id,
        name: names.get(id) ?? '알 수 없음',
      }))
      dms.push({
        ...base,
        slug: null,
        name: groupDisplayName({ title: c.title, members, meId: userId }),
        group: true,
      })
    } else if (c.kind === 'dm') {
      const other = otherDmUserId(c.dm_key, userId)
      const isSelf = other === userId.toLowerCase()
      const peerName = names.get(other ?? '') ?? (isSelf ? '나' : '알 수 없음')
      dms.push({ ...base, slug: null, name: isSelf ? `${peerName} (나)` : peerName })
    } else {
      channels.push({ ...base, slug: c.slug, name: c.name, categoryId: c.category_id })
    }
  }
  channels.sort(byName)
  dms.sort((a, b) => {
    const diff = (lastActivity.get(b.id) ?? -Infinity) - (lastActivity.get(a.id) ?? -Infinity)
    if (diff !== 0 && !Number.isNaN(diff)) return diff
    return byName(a, b)
  })
  return { channels, dms, dmPeers }
}

/** 채널 카테고리 목록(position 순). 곁가지라 실패하면 빈 목록(전부 "기타") */
export async function listChannelCategories(
  _supabase: WorkServerClient
): Promise<ChannelCategory[]> {
  try {
    return await listCategoryRecords()
  } catch (e) {
    console.error('[query] 채널 카테고리 조회 실패:', e)
    return []
  }
}

function toDetail(row: WorkChannelRecord): ChannelDetail {
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    archived_at: row.archived_at,
    created_by: row.created_by,
    created_at: row.created_at,
    isGroup: false,
    postPolicy: normalizePostPolicy(row.post_policy),
  }
}

/** slug → 채널(공개·비공개). 읽을 수 없거나 없으면 null(호출부가 notFound) */
export async function getChannelBySlug(
  supabase: WorkServerClient,
  slug: string
): Promise<ChannelDetail | null> {
  const row = await getChannelRecordBySlug(slug)
  if (!row) return null
  const readable = await readableChannelIds(me(supabase))
  return readable.has(row.id) ? toDetail(row) : null
}

/** DM 채널(1:1 또는 그룹). 내가 멤버가 아니면 null(관리자도 남의 DM은 못 본다). name은 표시 이름 */
export async function getDmChannel(
  supabase: WorkServerClient,
  id: string,
  _userId: string
): Promise<(ChannelDetail & { peerId: string | null }) | null> {
  const userId = supabase.user.id
  const row = await getChannelRecordById(id)
  if (!row || row.kind !== 'dm') return null
  const readable = await readableChannelIds(me(supabase))
  if (!readable.has(row.id)) return null
  if (row.is_group) {
    const memberIds = (await listMemberIdsByChannel([row.id])).get(row.id) ?? []
    const names = await softNames(memberIds)
    return {
      ...toDetail(row),
      slug: null,
      postPolicy: undefined,
      name: groupDisplayName({
        title: row.title,
        members: memberIds.map(m => ({ id: m, name: names.get(m) ?? '알 수 없음' })),
        meId: userId,
      }),
      isGroup: true,
      groupTitle: row.title,
      peerId: null,
    }
  }
  const peerId = otherDmUserId(row.dm_key, userId)
  if (!peerId) return null
  const peerName = (await softNames([peerId])).get(peerId) ?? '알 수 없음'
  return {
    ...toDetail(row),
    slug: null,
    postPolicy: undefined,
    name: peerId === userId.toLowerCase() ? `${peerName} (나)` : peerName,
    isGroup: false,
    peerId,
  }
}

/** 현재 사용자의 멤버십(없으면 null — 공개 채널 미리보기) */
export async function getMyMembership(
  supabase: WorkServerClient,
  channelId: string,
  _userId: string
): Promise<MyMembership | null> {
  return getMembershipRecord(channelId, supabase.user.id)
}

/** 채널 멤버(들어온 순). 읽을 수 없는 채널이면 빈 목록(원본 channel_members_select) */
export async function listChannelMembers(
  supabase: WorkServerClient,
  channelId: string
): Promise<ChannelMemberSummary[]> {
  const readable = await readableChannelIds(me(supabase))
  if (!readable.has(channelId)) return []
  return listChannelMemberRecords(channelId)
}

function toStaffSummary(p: WorkPersonRow): StaffSummary {
  const active = canAccessBoardRoom(p)
  return {
    user_id: p.user_id,
    display_name: p.display_name,
    title: p.director_title,
    role: active && p.is_admin ? 'admin' : 'member',
    status: active ? 'active' : 'left',
    status_emoji: p.status_emoji,
    status_text: p.status_text,
    status_until: p.status_until,
  }
}

/**
 * 작성자 이름·멘션 후보·멤버 추가용 사람 목록(원본 staff 디렉터리) — ggac 이사회 구성원(`member_profiles`).
 * 지금 이사·감사·관리자면 status 'active', 이사에서 빠졌지만 업무툴 흔적이 있는 사람은 'left'(옛 글에 이름이 붙게).
 * 요청마다 한 번(react cache — 레이아웃과 채널 화면이 같은 요청에서 함께 부른다).
 */
export const listStaffDirectory = cache(
  async (supabase: WorkServerClient): Promise<StaffSummary[]> => {
    const [people, visible] = await Promise.all([listWorkPeople(), visibleStaffIds(me(supabase))])
    const rows = visible ? people.filter(p => visible.has(p.user_id)) : people
    return rows.map(toStaffSummary)
  }
)

/** /c 채널 찾아보기: 내가 읽을 수 있는 공개·비공개 채널(보관 제외) + 참여 여부 */
export async function listBrowsableChannels(
  supabase: WorkServerClient,
  _userId: string
): Promise<BrowsableChannel[]> {
  const viewer = me(supabase)
  const [rows, readable, memberships] = await Promise.all([
    listActiveNonDmChannels(),
    readableChannelIds(viewer),
    listMyActiveMemberships(viewer.userId),
  ])
  const mine = new Set(memberships.map(m => m.channel_id))
  return rows
    .filter((r): r is WorkChannelRecord & { slug: string } => r.slug !== null && readable.has(r.id))
    .map(r => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      topic: r.topic,
      isMember: mine.has(r.id),
    }))
    .sort(byName)
}

/** 채널 변경 번호(폴링 시작 커서) — 읽을 수 없으면 null */
export async function getChannelRev(
  supabase: WorkServerClient,
  channelId: string
): Promise<number | null> {
  const readable = await readableChannelIds(me(supabase))
  if (!readable.has(channelId)) return null
  return (await getChannelRecordById(channelId))?.rev ?? null
}
