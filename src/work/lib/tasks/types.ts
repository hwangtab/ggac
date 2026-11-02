import type { WorkTaskRecord } from '@/db/queries/work/tasks'

/**
 * ggac 이식: 원본 `Database['work']['Tables']['tasks']['Row']` 자리 — 쿼리 계층(`@/db/queries/work/tasks`)의 행 모양
 * (원본 PostgREST와 같은 snake_case·ISO 문자열)에서 임베드를 뺀 것이다.
 */
export type TaskRow = Omit<WorkTaskRecord, 'channel' | 'assignee'>
export type TaskStatus = 'open' | 'done'

/** 화면이 쓰는 할 일 한 건(채널·사람 이름을 붙인 모양) */
export type TaskItem = {
  id: string
  channel_id: string
  channel_name: string
  /** /c/<slug> 링크용(DM·slug 없음이면 null) */
  channel_slug: string | null
  channel_kind: 'public' | 'private' | 'dm'
  message_id: string | null
  title: string
  note: string | null
  assignee_id: string | null
  assignee_name: string | null
  due_on: string | null
  status: TaskStatus
  created_by: string
  completed_at: string | null
  created_at: string
  /** 보관된 채널의 할 일 — 읽기 전용(0035 restrictive 정책과 같은 규칙) */
  channel_archived?: boolean
  /** 대화(kind='dm') 채널의 표시 이름 — 1:1 은 "다이렉트 메시지 · 상대 이름", 그룹은 "그룹 채팅[ · 이름]". 없으면 channel_name 규칙 */
  chat_label?: string | null
  /** 1:1 다이렉트 메시지의 상대 user_id(내 id 를 알 때만) — chat_label 계산용, 화면은 쓰지 않는다 */
  chat_peer_id?: string | null
  /** 그룹 채팅 여부와 사용자가 붙인 이름 */
  chat_group?: boolean
  chat_group_title?: string | null
}

export type TaskChannelOption = {
  id: string
  name: string
  kind: 'public' | 'private' | 'dm'
  group?: boolean
}
/**
 * 담당자 후보(활성 staff). guest 는 공개 채널이라도 멤버일 때만 후보, admin(업무툴 관리자 owner·admin)은
 * 비공개 채널도 멤버가 아니어도 후보(0037 — assignees.ts)
 */
export type TaskStaffOption = {
  user_id: string
  display_name: string
  guest?: boolean
  admin?: boolean
}

/** select 열(채널·담당자 임베드) — 임베드 FK 이름은 0006 에 고정 */
export const TASK_COLUMNS =
  'id, channel_id, message_id, title, note, assignee_id, due_on, status, created_by, completed_at, created_at, channel:channels!tasks_channel_id_fkey(name, slug, kind, dm_key, archived_at, is_group, title), assignee:staff!tasks_assignee_id_fkey(display_name)' as const
