'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { canAccessBoardRoom } from '@/lib/server/authz'
import {
  canInsertChannelMember,
  canManageChannel,
  isWorkAdmin,
  loadChannelAccess,
  viewerOf,
  visibleStaffIds,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import {
  addChannelMemberRows,
  archiveChannelRow,
  createChannelRow,
  getChannelRecordById,
  listSlugsWithPrefix,
  markChannelReadRow,
  openDmRow,
  removeSelfFromChannel,
  setChannelPostPolicyRow,
  setChannelTopicRow,
  setMemberFlagRow,
  unarchiveChannelRow,
} from '@/db/queries/work/channels'
import { getWorkPeople } from '@/db/queries/work/directory'
import { logAudit } from '@work/lib/audit/log'
import { dbFailure, fail, FORBIDDEN_MESSAGE, invalid, ok, type ActionResult } from './action-result'
import { refreshShell, writeLimited } from './action-support'
import { dmKey } from './dm'
import {
  addMembersSchema,
  channelIdInputSchema,
  createChannelSchema,
  DUPLICATE_CHANNEL_NAME_MESSAGE,
  nextFreeSlug,
  openDmSchema,
  toChannelSlug,
  toggleFlagSchema,
  updatePostPolicySchema,
  updateTopicSchema,
} from './schema'
import { normalizePostPolicy, type PostPolicy } from './post-policy'

/**
 * 채널 server action — 원본 kosmart-work `lib/channels/actions.ts`와 같은 이름·입력·반환 모양.
 * 원본 RLS(channels_update·channel_members_insert/delete …)가 하던 판정은 `boardWorkChannelAuth`로 여기서 하고,
 * 원본 트리거(생성자 owner 등록·이름 유일·뮤트↔알림 수준)는 쿼리 계층이 지킨다.
 */

/** 활성 구성원(=지금 이사회 업무툴에 들어올 수 있는 사람)만 — 원본 staff.status='active' 자리 */
async function activeStaffIds(ids: string[]): Promise<string[]> {
  const people = await getWorkPeople(ids)
  return ids.filter(id => {
    const p = people.get(id)
    return p ? canAccessBoardRoom(p) : false
  })
}

/** 채널 만들기(공개/비공개). slug는 이름에서 만들고, 겹치면 -2, -3 … */
export async function createChannel(
  input: unknown
): Promise<ActionResult<{ id: string; slug: string; addedCount: number; memberError?: string }>> {
  const ctx = await requireWorkStaff()
  const { staff } = ctx
  const parsed = createChannelSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (staff.role === 'guest') return fail('서브관리자는 채널을 만들 수 없습니다.')
  const limited = await writeLimited(staff.user_id)
  if (limited) return limited

  const base = toChannelSlug(parsed.data.name)
  let used: Set<string>
  try {
    used = new Set(await listSlugsWithPrefix(base))
  } catch (e) {
    return dbFailure('createChannel:slug', e)
  }
  const categoryId = parsed.data.categoryId ?? null

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = nextFreeSlug(base, used)
    const id = crypto.randomUUID()
    let outcome: Awaited<ReturnType<typeof createChannelRow>>
    try {
      outcome = await createChannelRow({
        id,
        kind: parsed.data.kind,
        name: parsed.data.name,
        slug,
        topic: parsed.data.topic,
        categoryId,
        creatorId: staff.user_id,
      })
    } catch (e) {
      return dbFailure('createChannel', e)
    }
    if (outcome.status === 'name_taken') return fail(DUPLICATE_CHANNEL_NAME_MESSAGE)
    if (outcome.status === 'category_missing') {
      return fail('선택한 카테고리를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.')
    }
    if (outcome.status === 'slug_taken') {
      used.add(slug)
      continue
    }
    await logAudit(
      staff.user_id,
      'channel.create',
      { type: 'channel', id },
      {
        name: parsed.data.name,
        slug,
        kind: parsed.data.kind,
        ...(categoryId ? { category_id: categoryId } : {}),
      }
    )
    // 멤버 초대 — 실패해도 채널은 이미 만들어졌으니 되돌리지 않고 결과에 알린다
    const memberIds = [...new Set(parsed.data.memberIds ?? [])].filter(u => u !== staff.user_id)
    let addedCount = 0
    let memberError: string | undefined
    if (memberIds.length > 0) {
      const added = await addMembersCore(viewerOf(ctx), id, memberIds)
      if (added.ok) addedCount = added.data.added
      else memberError = added.error
    }
    refreshShell()
    return ok({ id, slug, addedCount, ...(memberError ? { memberError } : {}) })
  }
  return fail('같은 이름의 채널이 많습니다. 다른 이름으로 시도해 주세요.')
}

/** 공개 채널 참여(본인). 비공개 채널은 업무툴 관리자만 스스로 참여한다(0037) */
export async function joinChannel(input: unknown): Promise<ActionResult<{ slug: string | null }>> {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (staff.role === 'guest') return fail(FORBIDDEN_MESSAGE)
  const viewer = viewerOf(ctx)

  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  let channel: Awaited<ReturnType<typeof getChannelRecordById>>
  try {
    ;[access, channel] = await Promise.all([
      loadChannelAccess(viewer, parsed.data.channelId),
      getChannelRecordById(parsed.data.channelId),
    ])
  } catch (e) {
    return dbFailure('joinChannel:channel', e)
  }
  // 읽을 수 없는 채널은 있는지조차 알리지 않는다
  const canJoin =
    access?.canRead &&
    (access.kind === 'public' || (access.kind === 'private' && isWorkAdmin(viewer)))
  if (!access || !channel || !canJoin) return fail('참여할 수 없는 채널입니다.')
  if (access.archived) return fail('보관된 채널에는 참여할 수 없습니다.')

  let added: string[]
  try {
    added = await addChannelMemberRows(channel.id, [user.id])
  } catch (e) {
    return dbFailure('joinChannel', e)
  }
  if (added.length > 0) {
    await logAudit(
      user.id,
      'channel.join',
      { type: 'channel', id: channel.id },
      { user_id: user.id }
    )
  }
  refreshShell()
  return ok({ slug: channel.slug })
}

/** 채널 나가기(본인). DM·그룹은 나갈 수 없다(그룹은 leaveGroupChat) */
export async function leaveChannel(input: unknown): Promise<ActionResult> {
  const { user, staff } = await requireWorkStaff()
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  let removed: boolean
  try {
    removed = await removeSelfFromChannel(parsed.data.channelId, user.id)
  } catch (e) {
    return dbFailure('leaveChannel', e)
  }
  if (!removed) return fail('나갈 수 없는 채널입니다.')
  await logAudit(
    staff.user_id,
    'channel.member_remove',
    { type: 'channel', id: parsed.data.channelId },
    { user_id: user.id, self: true }
  )
  refreshShell()
  return ok(undefined)
}

/** 주제 편집(채널 owner·관리자) */
export async function updateChannelTopic(
  input: unknown
): Promise<ActionResult<{ topic: string | null }>> {
  const ctx = await requireWorkStaff()
  const parsed = updateTopicSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  const access = await loadChannelAccess(viewer, parsed.data.channelId).catch(() => null)
  if (!access || !canManageChannel(viewer, access)) {
    return fail('채널 소유자나 관리자만 주제를 바꿀 수 있습니다.')
  }
  try {
    const row = await setChannelTopicRow(parsed.data.channelId, parsed.data.topic)
    if (!row) return fail('채널 소유자나 관리자만 주제를 바꿀 수 있습니다.')
    refreshShell()
    return ok({ topic: row.topic })
  } catch (e) {
    return dbFailure('updateChannelTopic', e)
  }
}

/** 글쓰기 권한 변경(채널 owner·업무툴 관리자, DM 제외) — 공지 채널 */
export async function updateChannelPostPolicy(
  input: unknown
): Promise<ActionResult<{ policy: PostPolicy }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = updatePostPolicySchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  const access = await loadChannelAccess(viewer, parsed.data.channelId).catch(() => null)
  if (!access || access.kind === 'dm' || !canManageChannel(viewer, access)) {
    return fail('채널 소유자나 관리자만 글쓰기 권한을 바꿀 수 있습니다.')
  }
  let row: Awaited<ReturnType<typeof setChannelPostPolicyRow>>
  try {
    row = await setChannelPostPolicyRow(parsed.data.channelId, parsed.data.policy)
  } catch (e) {
    return dbFailure('updateChannelPostPolicy', e)
  }
  if (!row) return fail('채널 소유자나 관리자만 글쓰기 권한을 바꿀 수 있습니다.')
  await logAudit(
    user.id,
    'channel.post_policy',
    { type: 'channel', id: parsed.data.channelId },
    { policy: parsed.data.policy }
  )
  refreshShell()
  return ok({ policy: normalizePostPolicy(row.post_policy) })
}

/**
 * 멤버 추가 공통 본체 — 활성 구성원만, 감사 로그. 원본 channel_members_insert 정책(채널 owner·관리자, DM 제외)을
 * 여기서 판정한다. 채널 존재·보관 검사는 호출부 몫(addChannelMembers가 한다, createChannel은 방금 만든 채널).
 */
async function addMembersCore(
  viewer: WorkViewer,
  channelId: string,
  userIds: string[]
): Promise<ActionResult<{ added: number }>> {
  let active: string[]
  try {
    const access = await loadChannelAccess(viewer, channelId)
    if (!access || !canInsertChannelMember(viewer, access, false)) {
      return fail('채널 소유자나 관리자만 멤버를 추가할 수 있습니다.')
    }
    active = await activeStaffIds(userIds)
    // 게스트가 부르는 경우 자기 공동 멤버만(원본 visible_staff_ids — 1단계엔 게스트가 없다)
    const visible = await visibleStaffIds(viewer)
    if (visible) active = active.filter(id => visible.has(id))
  } catch (e) {
    return dbFailure('addChannelMembers:staff', e)
  }
  if (active.length === 0) return fail('추가할 수 있는 사람이 없습니다.')

  let added: string[]
  try {
    added = await addChannelMemberRows(channelId, active)
  } catch (e) {
    return dbFailure('addChannelMembers', e)
  }
  if (added.length > 0) {
    await logAudit(
      viewer.userId,
      'channel.member_add',
      { type: 'channel', id: channelId },
      { user_ids: added }
    )
  }
  return ok({ added: added.length })
}

/** 멤버 추가(채널 owner·관리자). 활성 구성원만 */
export async function addChannelMembers(input: unknown): Promise<ActionResult<{ added: number }>> {
  const ctx = await requireWorkStaff()
  const parsed = addMembersSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const { channelId } = parsed.data
  const userIds = [...new Set(parsed.data.userIds)]
  const viewer = viewerOf(ctx)

  const access = await loadChannelAccess(viewer, channelId).catch(() => null)
  if (!access || !access.canRead || access.kind === 'dm') {
    return fail('멤버를 추가할 수 없는 채널입니다.')
  }
  if (access.archived) return fail('보관된 채널입니다.')

  const added = await addMembersCore(viewer, channelId, userIds)
  if (!added.ok) return added
  refreshShell()
  return added
}

/** 채널 보관(채널 owner·관리자) */
export async function archiveChannel(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  const access = await loadChannelAccess(viewer, parsed.data.channelId).catch(() => null)
  if (!access || access.kind === 'dm' || !canManageChannel(viewer, access)) {
    return fail('채널 소유자나 관리자만 보관할 수 있습니다.')
  }
  let row: Awaited<ReturnType<typeof archiveChannelRow>>
  try {
    row = await archiveChannelRow(parsed.data.channelId)
  } catch (e) {
    return dbFailure('archiveChannel', e)
  }
  if (!row) return fail('채널 소유자나 관리자만 보관할 수 있습니다.')
  await logAudit(
    ctx.user.id,
    'channel.archive',
    { type: 'channel', id: row.id },
    { name: row.name }
  )
  refreshShell()
  return ok(undefined)
}

/** 채널 보관 해제(채널 owner·관리자). 같은 이름의 보관 안 된 채널이 있으면 거부 */
export async function unarchiveChannel(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const { staff } = ctx
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (staff.role === 'guest') return fail(FORBIDDEN_MESSAGE)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let channel: Awaited<ReturnType<typeof getChannelRecordById>>
  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  try {
    ;[channel, access] = await Promise.all([
      getChannelRecordById(parsed.data.channelId),
      loadChannelAccess(viewer, parsed.data.channelId),
    ])
  } catch (e) {
    return dbFailure('unarchiveChannel:channel', e)
  }
  // 권한 없는 사람에게는 채널이 있는지·보관됐는지 알리지 않는다
  if (!channel || !access || channel.kind === 'dm' || !canManageChannel(viewer, access)) {
    return fail('채널 소유자나 관리자만 보관을 해제할 수 있습니다.')
  }
  if (!channel.archived_at) return fail('보관된 채널이 아닙니다.')

  let outcome: Awaited<ReturnType<typeof unarchiveChannelRow>>
  try {
    outcome = await unarchiveChannelRow(channel.id)
  } catch (e) {
    return dbFailure('unarchiveChannel', e)
  }
  if (outcome.status === 'name_taken') {
    return fail(
      `${DUPLICATE_CHANNEL_NAME_MESSAGE} 그 채널의 이름을 바꾸거나 보관한 뒤 해제해 주세요.`
    )
  }
  if (outcome.status !== 'ok') return fail('보관된 채널이 아닙니다.')
  await logAudit(
    staff.user_id,
    'channel.unarchive',
    { type: 'channel', id: channel.id },
    { name: channel.name }
  )
  refreshShell()
  return ok(undefined)
}

async function setMemberFlag(
  column: 'starred' | 'muted',
  input: unknown,
  userId: string
): Promise<ActionResult<{ value: boolean }>> {
  const parsed = toggleFlagSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  let updated: boolean
  try {
    updated = await setMemberFlagRow(parsed.data.channelId, userId, column, parsed.data.value)
  } catch (e) {
    return dbFailure(`setChannel:${column}`, e)
  }
  if (!updated) return fail('참여한 채널에서만 바꿀 수 있습니다.')
  refreshShell()
  return ok({ value: parsed.data.value })
}

export async function setChannelStarred(input: unknown): Promise<ActionResult<{ value: boolean }>> {
  const { user } = await requireWorkStaff()
  return setMemberFlag('starred', input, user.id)
}

export async function setChannelMuted(input: unknown): Promise<ActionResult<{ value: boolean }>> {
  const { user } = await requireWorkStaff()
  return setMemberFlag('muted', input, user.id)
}

/**
 * 읽음 처리: last_read_at = now, 그 채널(답글 포함)의 내 멘션 read_at = now.
 * 스크롤마다 불리므로 쓰기 레이트 리밋(WORK_WRITE)을 세지 않는다 — 본인 행만 바뀐다.
 */
export async function markChannelRead(
  input: unknown
): Promise<ActionResult<{ readAt: string; clearedMentions: number }>> {
  const { user } = await requireWorkStaff()
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const readAt = new Date()
  try {
    const clearedMentions = await markChannelReadRow(parsed.data.channelId, user.id, readAt)
    return ok({ readAt: readAt.toISOString(), clearedMentions })
  } catch (e) {
    return dbFailure('markChannelRead', e)
  }
}

/**
 * DM 열기: dm_key로 기존 DM을 찾고, 없으면 만든다. 두 사람을 멤버로(이미 있으면 그대로).
 * 자기 자신과의 DM(나와의 채팅 — 메모용)도 연다: dm_key `<me>:<me>`, 멤버는 나 한 명.
 * 상대는 지금 업무툴에 들어올 수 있는 사람(이사·감사·관리자)이어야 한다.
 */
export async function openDm(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = openDmSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const peerId = parsed.data.userId.toLowerCase()
  const me = user.id.toLowerCase()
  const isSelf = peerId === me

  try {
    if (!isSelf) {
      const visible = await visibleStaffIds(viewerOf(ctx))
      if (visible && ![...visible].some(id => id.toLowerCase() === peerId)) {
        return fail('대화할 수 없는 사람입니다.')
      }
      const [peer] = await activeStaffIds([peerId])
      if (!peer) return fail('대화할 수 없는 사람입니다.')
    }
  } catch (e) {
    return dbFailure('openDm:peer', e)
  }

  try {
    const { id } = await openDmRow({
      key: dmKey(me, peerId),
      creatorId: me,
      memberIds: [...new Set([me, peerId])],
    })
    refreshShell()
    return ok({ id })
  } catch (e) {
    return dbFailure('openDm:create', e)
  }
}
