'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { canAccessBoardRoom } from '@/lib/server/authz'
import {
  isWorkAdmin,
  viewerOf,
  visibleStaffIds,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import {
  addGroupMemberRows,
  createGroupRow,
  getGroupMemberIds,
  leaveGroupRow,
  listMyUnnamedGroups,
  removeGroupMemberRow,
  renameGroupRow,
} from '@/db/queries/work/channels'
import { getWorkPeople } from '@/db/queries/work/directory'
import { logAudit } from '@work/lib/audit/log'
import { dbFailure, fail, invalid, ok, type ActionResult } from './action-result'
import { refreshShell, writeLimited } from './action-support'
import { findSameMembersGroup, GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS, groupMessages } from './group'
import {
  addGroupMembersSchema,
  channelIdInputSchema,
  createGroupSchema,
  removeGroupMemberSchema,
  renameGroupSchema,
} from './schema'

/**
 * 그룹 채팅 server action — 원본 kosmart-work `lib/channels/group-actions.ts`와 같은 이름·입력·반환 모양.
 * 원본은 전부 service_role로 썼으므로 "호출자가 그 그룹의 멤버인가"를 이 파일이 직접 검사했다 — 여기서도 같다.
 * 내보내기는 업무툴 관리자만(그 그룹의 멤버여야 한다). 시스템 메시지·멤버 변경은 쿼리 계층이 한 트랜잭션으로 한다.
 */

const NOT_PARTICIPANT_MESSAGE = '참여 중인 그룹 채팅이 아닙니다.'

/** 게스트면 대상이 전부 자기 공동 멤버인지(원본 checkGuestReach — 1단계엔 게스트가 없다) */
async function checkGuestReach(viewer: WorkViewer, ids: string[]): Promise<ActionResult | null> {
  let visible: Set<string> | null
  try {
    visible = await visibleStaffIds(viewer)
  } catch (err) {
    return dbFailure('group:visible', err)
  }
  if (!visible) return null
  const lower = new Set([...visible].map(id => id.toLowerCase()))
  return ids.every(id => lower.has(id)) ? null : fail('대화할 수 없는 사람이 있습니다.')
}

/** 대상이 전부 활성 구성원인지 확인하고 이름을 돌려준다 */
async function loadEligibleStaff(
  ids: string[]
): Promise<{ names: Map<string, string>; error?: ActionResult }> {
  let people: Awaited<ReturnType<typeof getWorkPeople>>
  try {
    people = await getWorkPeople(ids)
  } catch (e) {
    return { names: new Map(), error: dbFailure('group:staff', e) }
  }
  const byLower = new Map([...people.values()].map(p => [p.user_id.toLowerCase(), p]))
  const names = new Map<string, string>()
  for (const id of ids) {
    const row = byLower.get(id.toLowerCase())
    if (!row || !canAccessBoardRoom(row)) {
      return { names, error: fail('대화할 수 없는 사람이 있습니다.') }
    }
    names.set(id.toLowerCase(), row.display_name)
  }
  return { names }
}

/** 그룹 멤버(소문자). 그룹이 아니거나 없으면 memberIds null, 조회 실패면 error */
async function loadGroup(
  channelId: string
): Promise<{ memberIds: string[] | null; error?: ActionResult }> {
  try {
    const ids = await getGroupMemberIds(channelId)
    return { memberIds: ids ? ids.map(id => id.toLowerCase()) : null }
  } catch (e) {
    return { memberIds: null, error: dbFailure('group:channel', e) }
  }
}

/**
 * 그룹 만들기. userIds는 본인을 뺀 상대. 본인 포함 3~20명, 전원 활성 구성원.
 * 이름 없는 요청이고 같은 구성의 이름 없는 그룹을 내가 이미 갖고 있으면 그 대화를 돌려준다(existing: true).
 */
export async function createGroupChat(
  input: unknown
): Promise<ActionResult<{ id: string; existing: boolean }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = createGroupSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited

  const me = user.id.toLowerCase()
  const others = [...new Set(parsed.data.userIds.map(id => id.toLowerCase()))].filter(
    id => id !== me
  )
  const all = [me, ...others]
  if (all.length < GROUP_MIN_MEMBERS) return fail('그룹 채팅은 본인 포함 3명 이상이어야 합니다.')
  if (all.length > GROUP_MAX_MEMBERS) {
    return fail(`그룹 채팅은 본인 포함 ${GROUP_MAX_MEMBERS}명까지 만들 수 있습니다.`)
  }

  const unreachable = await checkGuestReach(viewerOf(ctx), others)
  if (unreachable) return unreachable as ActionResult<never>
  const eligible = await loadEligibleStaff(others)
  if (eligible.error) return eligible.error as ActionResult<never>

  if (!parsed.data.name && !parsed.data.forceNew) {
    try {
      const candidates = await listMyUnnamedGroups(me)
      const found = findSameMembersGroup(candidates, all)
      if (found) return ok({ id: found, existing: true })
    } catch (e) {
      return dbFailure('createGroupChat:find', e)
    }
  }

  const id = crypto.randomUUID()
  try {
    await createGroupRow({ id, creatorId: me, memberIds: all, title: parsed.data.name ?? null })
  } catch (e) {
    return dbFailure('createGroupChat:create', e)
  }
  refreshShell()
  return ok({ id, existing: false })
}

/** 사람 추가(그룹 멤버 누구나). 이전 대화도 보인다. 시스템 메시지를 남긴다. */
export async function addGroupMembers(input: unknown): Promise<ActionResult<{ added: number }>> {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const parsed = addGroupMembersSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited

  const me = user.id.toLowerCase()
  const group = await loadGroup(parsed.data.channelId)
  if (group.error) return group.error as ActionResult<never>
  if (!group.memberIds || !group.memberIds.includes(me)) return fail(NOT_PARTICIPANT_MESSAGE)

  const existing = new Set(group.memberIds)
  const fresh = [...new Set(parsed.data.userIds.map(id => id.toLowerCase()))].filter(
    id => !existing.has(id)
  )
  if (fresh.length === 0) return fail('이미 참여 중인 사람입니다.')
  if (existing.size + fresh.length > GROUP_MAX_MEMBERS) {
    return fail(`그룹 채팅은 본인 포함 ${GROUP_MAX_MEMBERS}명까지 만들 수 있습니다.`)
  }
  const unreachable = await checkGuestReach(viewerOf(ctx), fresh)
  if (unreachable) return unreachable as ActionResult<never>
  const eligible = await loadEligibleStaff(fresh)
  if (eligible.error) return eligible.error as ActionResult<never>

  let added: string[]
  try {
    added = await addGroupMemberRows({
      channelId: parsed.data.channelId,
      actorId: me,
      userIds: fresh,
      systemBody: groupMessages.added(
        staff.display_name,
        fresh.map(id => eligible.names.get(id) ?? '알 수 없음')
      ),
    })
  } catch (e) {
    return dbFailure('addGroupMembers', e)
  }
  await logAudit(
    user.id,
    'channel.member_add',
    { type: 'channel', id: parsed.data.channelId },
    { group: true, user_ids: added }
  )
  refreshShell()
  return ok({ added: added.length })
}

/** 이름 바꾸기(그룹 멤버 누구나). 빈 값이면 이름을 지운다 → 참여자 나열로 돌아간다. */
export async function renameGroupChat(
  input: unknown
): Promise<ActionResult<{ title: string | null }>> {
  const { user, staff } = await requireWorkStaff()
  const parsed = renameGroupSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited

  const me = user.id.toLowerCase()
  const group = await loadGroup(parsed.data.channelId)
  if (group.error) return group.error as ActionResult<never>
  if (!group.memberIds || !group.memberIds.includes(me)) return fail(NOT_PARTICIPANT_MESSAGE)

  try {
    const updated = await renameGroupRow({
      channelId: parsed.data.channelId,
      actorId: me,
      title: parsed.data.name,
      systemBody: groupMessages.renamed(staff.display_name, parsed.data.name),
    })
    if (!updated) return fail(NOT_PARTICIPANT_MESSAGE)
  } catch (e) {
    return dbFailure('renameGroupChat', e)
  }
  refreshShell()
  return ok({ title: parsed.data.name })
}

/** 나가기(본인만). 이력은 남고, 마지막 한 명이 나가도 채널은 보존한다. */
export async function leaveGroupChat(input: unknown): Promise<ActionResult> {
  const { user, staff } = await requireWorkStaff()
  const parsed = channelIdInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const me = user.id.toLowerCase()
  const group = await loadGroup(parsed.data.channelId)
  if (group.error) return group.error as ActionResult<never>
  if (!group.memberIds || !group.memberIds.includes(me)) return fail(NOT_PARTICIPANT_MESSAGE)

  try {
    await leaveGroupRow({
      channelId: parsed.data.channelId,
      userId: me,
      systemBody: groupMessages.left(staff.display_name),
    })
  } catch (e) {
    return dbFailure('leaveGroupChat', e)
  }
  await logAudit(
    user.id,
    'channel.member_remove',
    { type: 'channel', id: parsed.data.channelId },
    { group: true, user_id: me, reason: 'leave' }
  )
  refreshShell()
  return ok(undefined)
}

/**
 * 내보내기(업무툴 관리자만 — 그 그룹의 멤버여야 한다). 본인은 나가기로. 이력은 남고, 내보낸 사람은 더 못 본다.
 * 관리자 판정은 요청마다 ggac 프로필을 다시 읽은 가드 결과다(원본 isWorkAdminNow의 즉시 대조와 같은 자리).
 */
export async function removeGroupMember(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const parsed = removeGroupMemberSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (!isWorkAdmin(viewerOf(ctx))) {
    return fail('그룹 채팅에서 내보내기는 관리자만 할 수 있습니다.')
  }
  const limited = await writeLimited(user.id)
  if (limited) return limited

  const me = user.id.toLowerCase()
  const target = parsed.data.userId.toLowerCase()
  if (target === me) return fail('본인은 내보낼 수 없습니다. 그룹 나가기를 쓰세요.')

  const group = await loadGroup(parsed.data.channelId)
  if (group.error) return group.error as ActionResult<never>
  if (!group.memberIds || !group.memberIds.includes(me)) return fail(NOT_PARTICIPANT_MESSAGE)
  if (!group.memberIds.includes(target)) return fail('이 대화에 없는 사람입니다.')

  let targetName = '알 수 없음'
  try {
    targetName = (await getWorkPeople([target])).get(target)?.display_name ?? targetName
  } catch (e) {
    return dbFailure('removeGroupMember:staff', e)
  }

  try {
    const removed = await removeGroupMemberRow({
      channelId: parsed.data.channelId,
      actorId: me,
      targetId: target,
      systemBody: groupMessages.removed(staff.display_name, targetName),
    })
    if (!removed) return fail('이 대화에 없는 사람입니다.')
  } catch (e) {
    return dbFailure('removeGroupMember', e)
  }
  await logAudit(
    user.id,
    'channel.member_remove',
    { type: 'channel', id: parsed.data.channelId },
    { group: true, user_id: target, reason: 'removed' }
  )
  refreshShell()
  return ok(undefined)
}
