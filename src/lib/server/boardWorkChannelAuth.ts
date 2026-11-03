import {
  getChannelAccess,
  getMessageChannelIds,
  listChannelAccess,
  type ChannelAccessRow,
} from '@/db/queries/work/access'
import { listMemberIdsByChannel } from '@/db/queries/work/channels'
import { isWorkAdminRole, type WorkGuardContext, type WorkStaffRole } from './boardWorkAuth'

/**
 * 이사회 업무툴 **채널 단위** 권한 — 원본 kosmart-work Postgres RLS 헬퍼를 옮겼다(설계 §5).
 * 진입 게이트(`requireWorkStaff`, boardWorkAuth.ts)를 지난 사람에 대해 "이 채널을 읽을 수 있나·관리할 수 있나"를 판정한다.
 * ggac에는 RLS가 없으므로 **모든 server action·라우트가 이 판정을 직접 부른다.** 쿼리 계층
 * (`src/db/queries/work/*`)은 권한을 모르고, 여기서 계산한 읽기 범위·쓰기 자격을 인자로 받는다.
 *
 * | 원본(SQL)                      | 여기                                   |
 * | ------------------------------ | -------------------------------------- |
 * | is_staff / is_internal_staff   | 게이트 통과 / `isInternalStaff`(guest 제외) |
 * | is_work_admin (0033)           | `isWorkAdmin` — staff.role owner·admin(=ggac 관리자, 요청마다 다시 읽음) |
 * | is_channel_member / _owner     | `ChannelAccessRow.memberRole`          |
 * | can_read_channel (0037)        | `canReadChannelRow`                    |
 * | readable_channel_ids (0018)    | `readableChannelIds`                   |
 * | visible_staff_ids (0026)       | `visibleStaffIds`(1단계는 게스트가 없어 늘 null = 제한 없음) |
 *
 * 원본 `is_channel_member`는 "활성 staff인 멤버"였다. 여기서는 게이트(`canAccessBoardRoom`)가 활성 여부를 먼저 보므로
 * 이사에서 빠진 사람은 멤버십 행이 남아 있어도 아예 들어오지 못한다(설계 §3).
 */

export type WorkViewer = { userId: string; role: WorkStaffRole }

export function viewerOf(ctx: Pick<WorkGuardContext, 'user' | 'staff'>): WorkViewer {
  return { userId: ctx.user.id, role: ctx.staff.role }
}

/** 원본 is_internal_staff — guest(서브관리자)가 아닌 활성 구성원 */
export function isInternalStaff(viewer: WorkViewer): boolean {
  return viewer.role !== 'guest'
}

/** 원본 is_work_admin — 업무툴 관리자(owner·admin) */
export function isWorkAdmin(viewer: WorkViewer): boolean {
  return isWorkAdminRole(viewer.role)
}

/**
 * 원본 can_read_channel(kosmart-work 0037 최종판):
 *   멤버 / 또는 공개 채널 + 내부 구성원 / 또는 비공개(DM 아님) 채널 + 업무툴 관리자.
 * **DM·그룹 채팅(kind 'dm')은 멤버만** — 관리자도 자기가 없는 DM·그룹은 읽지 못한다.
 */
export function canReadChannelRow(
  viewer: WorkViewer,
  row: Pick<ChannelAccessRow, 'kind' | 'memberRole'>
): boolean {
  if (row.memberRole) return true
  if (row.kind === 'public') return isInternalStaff(viewer)
  if (row.kind === 'private') return isWorkAdmin(viewer)
  return false
}

/** 원본 readable_channel_ids(): 읽을 수 있는 채널 id 전부(보관 포함 — 보관 채널도 읽기는 된다) */
export async function readableChannelIds(viewer: WorkViewer): Promise<Set<string>> {
  const rows = await listChannelAccess(viewer.userId)
  return new Set(rows.filter(r => canReadChannelRow(viewer, r)).map(r => r.id))
}

export type ChannelAccessDecision = ChannelAccessRow & {
  canRead: boolean
  isMember: boolean
  isOwner: boolean
}

/** 채널 하나에 대한 판정 묶음. 채널이 없으면 null */
export async function loadChannelAccess(
  viewer: WorkViewer,
  channelId: string
): Promise<ChannelAccessDecision | null> {
  const row = await getChannelAccess(channelId, viewer.userId)
  if (!row) return null
  return {
    ...row,
    canRead: canReadChannelRow(viewer, row),
    isMember: row.memberRole !== null,
    isOwner: row.memberRole === 'owner',
  }
}

export async function canReadChannel(viewer: WorkViewer, channelId: string): Promise<boolean> {
  return (await loadChannelAccess(viewer, channelId))?.canRead ?? false
}

/** 메시지 하나의 채널 판정(원본 message_channel_id → can_read_channel / is_channel_member). 없으면 null */
export async function loadMessageAccess(
  viewer: WorkViewer,
  messageId: string
): Promise<ChannelAccessDecision | null> {
  const channelId = (await getMessageChannelIds([messageId])).get(messageId)
  return channelId ? loadChannelAccess(viewer, channelId) : null
}

/**
 * 공지 채널(post_policy 'owners')에 최상위 글을 올릴 수 있는가 — 채널 owner 또는 업무툴 관리자
 * (원본 harden_messages_write 0028의 `is_channel_owner or is_work_admin`).
 */
export function canPostRestricted(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'isOwner'>
) {
  return access.isOwner || isWorkAdmin(viewer)
}

/** 원본 channels_update 정책: 채널 owner 또는 (업무툴 관리자이고 DM이 아님) */
export function canManageChannel(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'isOwner' | 'kind'>
): boolean {
  return access.isOwner || (isWorkAdmin(viewer) && access.kind !== 'dm')
}

/**
 * 원본 channel_members_insert 정책(DM 제외):
 *   본인이 공개 채널에 참여(내부 구성원) / 채널 owner / 업무툴 관리자.
 * `selfJoin`이면 본인을 넣는 경우.
 */
export function canInsertChannelMember(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'isOwner' | 'kind'>,
  selfJoin: boolean
): boolean {
  if (access.kind === 'dm') return false
  if (selfJoin && access.kind === 'public' && isInternalStaff(viewer)) return true
  return access.isOwner || isWorkAdmin(viewer)
}

/**
 * 원본 visible_staff_ids(0026): 게스트는 자기가 멤버인 채널(DM·그룹 포함)의 공동 멤버와 자기 자신만 본다.
 * 내부 구성원은 제한이 없다(null). 1단계에는 게스트가 없지만 규칙은 원본대로 둔다.
 */
export async function visibleStaffIds(viewer: WorkViewer): Promise<Set<string> | null> {
  if (viewer.role !== 'guest') return null
  const rows = await listChannelAccess(viewer.userId)
  const mine = rows.filter(r => r.memberRole !== null).map(r => r.id)
  const visible = new Set<string>([viewer.userId])
  for (const ids of (await listMemberIdsByChannel(mine)).values())
    for (const id of ids) visible.add(id)
  return visible
}
