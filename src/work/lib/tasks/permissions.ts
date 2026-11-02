import type { TaskItem } from './types'

/**
 * 할 일 수정·완료 권한 표시 규칙(DB 의 tasks_update 정책과 같게 유지 — 서버가 RLS 로 다시 막는다).
 * 생성자 · 담당자 · 채널 owner · 업무툴 관리자. 보관 채널·읽기 전용 화면은 관리자 포함 누구도 바꾸지 않는다.
 */
export function canEditTask(
  task: Pick<TaskItem, 'created_by' | 'assignee_id' | 'channel_id' | 'channel_archived'>,
  actor: { me: string; isAdmin: boolean; ownedChannelIds?: readonly string[]; readOnly?: boolean }
): boolean {
  if (actor.readOnly || task.channel_archived) return false
  return (
    task.created_by === actor.me ||
    task.assignee_id === actor.me ||
    actor.isAdmin ||
    (actor.ownedChannelIds?.includes(task.channel_id) ?? false)
  )
}

/** 삭제 권한(tasks_delete: 생성자 또는 관리자). 보관·읽기 전용이면 숨긴다 */
export function canDeleteTask(
  task: Pick<TaskItem, 'created_by' | 'channel_archived'>,
  actor: { me: string; isAdmin: boolean; readOnly?: boolean }
): boolean {
  if (actor.readOnly || task.channel_archived) return false
  return task.created_by === actor.me || actor.isAdmin
}
