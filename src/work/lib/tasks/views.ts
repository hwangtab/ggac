import { z } from 'zod'
import { daysUntil } from './due'
import { isMine, sortTasks } from './reducer'
import type { TaskItem } from './types'

/**
 * 할 일 "보기" — 목록 패널(데스크톱)과 모바일 칩이 같은 키·판정을 쓴다. 순수 모듈(조회 없음).
 * URL 은 `/tasks?view=<key>` 와 `/tasks?channel=<id>`(채널이 있으면 채널이 보기보다 우선).
 */
export const TASK_VIEWS = [
  'mine',
  'today',
  'overdue',
  'upcoming',
  'created',
  'done',
  'all',
] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export const DEFAULT_TASK_VIEW: TaskView = 'mine'

export const TASK_VIEW_LABEL: Record<TaskView, string> = {
  mine: '내 할 일',
  today: '오늘 마감',
  overdue: '기한 지남',
  upcoming: '예정',
  created: '내가 만든 할 일',
  done: '완료됨',
  all: '전체(채널별)',
}

/** 보기별 빈 상태 문구 */
export const TASK_VIEW_EMPTY: Record<TaskView, string> = {
  mine: '나에게 맡겨진 할 일이 없습니다',
  today: '오늘 마감인 할 일이 없습니다',
  overdue: '기한이 지난 할 일이 없습니다',
  upcoming: '마감이 남은 할 일이 없습니다',
  created: '내가 만든 할 일이 없습니다',
  done: '완료한 할 일이 없습니다',
  all: '읽을 수 있는 채널에 할 일이 없습니다',
}

/** 완료됨 보기가 담는 건수 한계 — listTasks 의 DONE_LIMIT(최근 완료 50건)와 같다 */
export const DONE_VIEW_LIMIT = 50

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** `?view=` → 보기. 없거나 잘못된 값은 기본(내 할 일). */
export function parseTaskView(raw: string | string[] | undefined): TaskView {
  const v = first(raw)
  return (TASK_VIEWS as readonly string[]).includes(v ?? '') ? (v as TaskView) : DEFAULT_TASK_VIEW
}

/** `?channel=` → 채널 id(uuid 만). 잘못된 값은 null. */
export function parseTaskChannel(raw: string | string[] | undefined): string | null {
  const r = z.string().uuid().safeParse(first(raw))
  return r.success ? r.data : null
}

/**
 * 할 일 목록의 채널 필터 — 서버(`/tasks` 페이지)와 목록 패널이 **같은 규칙**을 쓴다.
 * "할 일로 만들기"(`new=1` + 유효한 `channel`·`message`)의 `channel` 은 필터가 아니라 폼 미리 채우기라서 null(내 할 일).
 */
export function resolveTaskChannelFilter(
  sp: Record<string, string | string[] | undefined>
): string | null {
  const channel = parseTaskChannel(sp.channel)
  if (!channel) return null
  const fromMessage = first(sp.new) === '1' && parseTaskChannel(sp.message) !== null
  return fromMessage ? null : channel
}

/**
 * `/tasks` 링크. 기본 보기(내 할 일)는 view 를 생략한다. 채널이 있으면 채널만 쓴다(채널이 보기보다 우선).
 * extra 는 `new=1` 같은 부가 쿼리.
 */
export function tasksHref(
  opts: { view?: TaskView; channel?: string | null; extra?: Record<string, string> } = {}
): string {
  const p = new URLSearchParams()
  if (opts.channel) p.set('channel', opts.channel)
  else if (opts.view && opts.view !== DEFAULT_TASK_VIEW) p.set('view', opts.view)
  for (const [k, v] of Object.entries(opts.extra ?? {})) p.set(k, v)
  const qs = p.toString()
  return qs ? `/tasks?${qs}` : '/tasks'
}

/**
 * 한 건이 보기에 속하는가. "내 할 일"은 reducer.isMine 과 같은 정의(담당=나 또는 내가 만들었고 담당자 없음).
 * - today/overdue/upcoming: 내 할 일 중 미완료이고 마감일이 오늘 / 지남 / 미래
 * - created: 내가 만든 것(남에게 맡긴 것 포함, 완료 포함)
 * - done: 담당이거나 내가 만들었고 완료 — 서버가 최근 완료 50건만 주므로 그 범위
 * - all: 전부(화면이 채널별로 묶는다)
 */
export function matchesView(task: TaskItem, view: TaskView, me: string, today: string): boolean {
  const open = task.status === 'open'
  switch (view) {
    case 'mine':
      return isMine(task, me)
    case 'today':
      return open && isMine(task, me) && task.due_on === today
    case 'overdue':
      return open && isMine(task, me) && task.due_on !== null && daysUntil(task.due_on, today) < 0
    case 'upcoming':
      return open && isMine(task, me) && task.due_on !== null && daysUntil(task.due_on, today) > 0
    case 'created':
      return task.created_by === me
    case 'done':
      return !open && (task.assignee_id === me || task.created_by === me)
    case 'all':
      return true
  }
}

/** 보기에 맞는 할 일(정렬 포함). all 은 정렬만 한다. */
export function filterByView(
  tasks: TaskItem[],
  view: TaskView,
  me: string,
  today: string
): TaskItem[] {
  return sortTasks(tasks.filter(t => matchesView(t, view, me, today)))
}
