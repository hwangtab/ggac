import type { TaskChannelOption, TaskStaffOption } from './types'

/**
 * 할 일 담당자 후보 규칙(화면·서버 액션 공용, 순수 함수).
 * 담당자는 **그 채널을 읽을 수 있는 활성 staff** 여야 한다 — work.can_read_channel(0037 이후)과 같은 기준:
 *   - 멤버는 어떤 채널이든(DM·그룹 포함)
 *   - 공개 채널: guest(서브관리자)를 뺀 활성 staff 전원
 *   - 비공개 채널: 업무툴 관리자(owner·admin)는 멤버가 아니어도 읽는다
 *   - DM·그룹 채팅: 관리자에게도 열리지 않는다 — 멤버만
 * 활성 여부는 후보 목록(활성 staff 만 담긴다)·서버 조회가 거른다.
 * 관리자 여부는 staff.role 로 본다(후보 표시·검증용 — 읽기 권한 자체는 RLS 가 매번 is_work_admin 으로 판정한다).
 */
export function canReadChannelAsAssignee(
  staff: { guest?: boolean; admin?: boolean },
  channel: { kind: TaskChannelOption['kind']; isMember: boolean }
): boolean {
  if (channel.isMember) return true
  if (channel.kind === 'public') return !staff.guest
  if (channel.kind === 'private') return staff.admin === true && !staff.guest
  return false
}

/** 활성 staff 목록에서 이 채널의 담당자 후보만 */
export function assigneeCandidates(
  staff: readonly TaskStaffOption[],
  kind: TaskChannelOption['kind'],
  memberIds: readonly string[]
): TaskStaffOption[] {
  const members = new Set(memberIds)
  return staff.filter(s => canReadChannelAsAssignee(s, { kind, isMember: members.has(s.user_id) }))
}
