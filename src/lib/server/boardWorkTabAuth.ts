import {
  isInternalStaff,
  isWorkAdmin,
  type ChannelAccessDecision,
  type WorkViewer,
} from './boardWorkChannelAuth'

/**
 * 이사회 업무툴 대화 탭·메모·할 일 권한 — 원본 kosmart-work RLS 정책을 옮겼다(설계 §5).
 * 채널 판정 묶음(`loadChannelAccess`)을 받아 "이 사람이 이 일을 해도 되나"만 답한다. 데이터 규칙(개수 상한·보관 채널·
 * 작성자 강제·OLD 행 기준 할 일 수정)은 쿼리 계층(`src/db/queries/work/{tabs,notes,tasks}.ts`)이 따로 지킨다.
 *
 * | 원본(SQL)                                         | 여기                    |
 * | ------------------------------------------------- | ----------------------- |
 * | conversation_tabs_select / notes_select / tasks_select = can_read_channel | `access.canRead` |
 * | conversation_tabs_insert: 멤버 ∧ 내부 staff          | `canAddConversationTab` |
 * | can_manage_conversation_tab(0026)                 | `canManageConversationTab` |
 * | conversation_notes_update: 멤버 ∧ 내부 staff        | `canWriteConversationNote` |
 * | tasks_insert: 멤버(작성자 강제는 쿼리 층)            | `canCreateTask`         |
 * | 0033 T1 · 0036 K2 보관 채널 쓰기(관리자 예외)        | `canWriteArchivedTabs`  |
 */

/** 원본 conversation_tabs_insert WITH CHECK — 그 대화의 멤버이면서 내부 staff(게스트 제외) */
export function canAddConversationTab(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'isMember'>
): boolean {
  return access.isMember && isInternalStaff(viewer)
}

/**
 * 원본 can_manage_conversation_tab(0026 최종판):
 *   DM·그룹 → 멤버 ∧ 내부 staff(관리자 예외 없음 — 관리자도 남의 DM 탭은 못 바꾼다)
 *   채널   → (멤버 ∧ 내부 staff ∧ 만든 사람) ∨ 채널 owner ∨ 업무툴 관리자
 * 만든 사람의 프로필이 지워져 `createdBy`가 null이면 owner·관리자만.
 */
export function canManageConversationTab(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'kind' | 'isMember' | 'isOwner'>,
  createdBy: string | null
): boolean {
  if (access.kind === 'dm') return access.isMember && isInternalStaff(viewer)
  if (
    access.isMember &&
    isInternalStaff(viewer) &&
    createdBy !== null &&
    createdBy.toLowerCase() === viewer.userId.toLowerCase()
  ) {
    return true
  }
  return access.isOwner || isWorkAdmin(viewer)
}

/** 원본 conversation_notes_update USING — 그 대화의 멤버이면서 내부 staff */
export function canWriteConversationNote(
  viewer: WorkViewer,
  access: Pick<ChannelAccessDecision, 'isMember'>
): boolean {
  return access.isMember && isInternalStaff(viewer)
}

/** 원본 tasks_insert WITH CHECK — 채널 멤버(게스트 포함) */
export function canCreateTask(access: Pick<ChannelAccessDecision, 'isMember'>): boolean {
  return access.isMember
}

/** 보관된 채널의 탭·메모·할 일을 바꿀 수 있나(원본 restrictive 정책의 `or is_work_admin()`) */
export function canWriteArchivedTabs(viewer: WorkViewer): boolean {
  return isWorkAdmin(viewer)
}
