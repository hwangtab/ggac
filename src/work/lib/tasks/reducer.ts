import type { TaskItem } from './types'

/** 할 일 목록 리듀서 — 낙관적 갱신과 서버 확정/되돌리기를 같은 액션으로 다룬다. */
export type TaskAction =
  | { type: 'add'; task: TaskItem }
  | { type: 'toggle'; id: string; done: boolean; at: string }
  | {
      type: 'patch'
      id: string
      patch: Partial<Pick<TaskItem, 'title' | 'note' | 'assignee_id' | 'assignee_name' | 'due_on'>>
    }
  | { type: 'replace'; task: TaskItem }
  | { type: 'remove'; id: string }
  /** 서버가 새로 내려준 목록으로 통째로 바꾼다(router.refresh 뒤 낡은 목록 방지) */
  | { type: 'reset'; tasks: TaskItem[] }

export function taskReducer(state: TaskItem[], action: TaskAction): TaskItem[] {
  switch (action.type) {
    case 'add':
      return state.some(t => t.id === action.task.id) ? state : [action.task, ...state]
    case 'toggle':
      return state.map(t =>
        t.id === action.id
          ? {
              ...t,
              status: action.done ? 'done' : 'open',
              completed_at: action.done ? action.at : null,
            }
          : t
      )
    case 'patch':
      return state.map(t => (t.id === action.id ? { ...t, ...action.patch } : t))
    case 'replace':
      return state.map(t => (t.id === action.task.id ? action.task : t))
    case 'remove':
      return state.filter(t => t.id !== action.id)
    case 'reset':
      return action.tasks
    default:
      return state
  }
}

/** 미완료 먼저 → 마감 빠른 순(없으면 뒤) → 최근 생성 순. 완료는 최근 완료 순 */
export function sortTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    if (a.status === 'done') return (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
    if (a.due_on !== b.due_on) {
      if (!a.due_on) return 1
      if (!b.due_on) return -1
      return a.due_on.localeCompare(b.due_on)
    }
    return b.created_at.localeCompare(a.created_at)
  })
}

/**
 * "내 할 일" = 담당자가 나 **또는** 내가 만들었고 담당자가 없는 것(QA #23).
 * 내가 만들어 남에게 맡긴 일은 그 사람의 할 일이다(채널별 탭에서는 보인다).
 * 사이드바·헤더 배지(countMyOpenTasks)도 같은 정의를 쓴다.
 */
export function isMine(task: TaskItem, me: string): boolean {
  return task.assignee_id === me || (task.created_by === me && task.assignee_id === null)
}

export type TaskGroup = {
  channelId: string
  name: string
  kind: TaskItem['channel_kind']
  /** 대화(kind='dm') 묶음의 표시 라벨(1:1 은 상대 이름 포함). 없으면 name 규칙 */
  label: string | null
  tasks: TaskItem[]
}

/** 채널별 묶음(채널 이름 순). 각 묶음 안은 sortTasks */
export function groupByChannel(tasks: TaskItem[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>()
  for (const t of sortTasks(tasks)) {
    const g = map.get(t.channel_id) ?? {
      channelId: t.channel_id,
      name: t.channel_name,
      kind: t.channel_kind,
      label: t.chat_label ?? null,
      tasks: [],
    }
    g.tasks.push(t)
    map.set(t.channel_id, g)
  }
  return [...map.values()].sort((a, b) =>
    (a.label ?? a.name).localeCompare(b.label ?? b.name, 'ko')
  )
}

/** 원본 메시지 링크: /c/<slug>#msg-<id> (DM 은 /dm/<channelId>) */
export function taskMessageHref(task: TaskItem): string | null {
  if (!task.message_id) return null
  if (task.channel_kind === 'dm') return `/dm/${task.channel_id}#msg-${task.message_id}`
  if (!task.channel_slug) return null
  return `/c/${task.channel_slug}#msg-${task.message_id}`
}
