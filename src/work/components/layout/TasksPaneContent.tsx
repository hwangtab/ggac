'use client'

import Link from '@work/lib/nav/link'
import { usePathname, useSearchParams } from '@work/lib/nav/navigation'
import {
  AlarmClockOffIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CheckCheckIcon,
  CheckSquareIcon,
  HashIcon,
  LayersIcon,
  LockIcon,
  PenLineIcon,
  PlusIcon,
  type LucideIcon,
} from 'lucide-work'
import { cn } from '@work/lib/utils'
import { groupChannelsForPane } from '@work/lib/channels/sort'
import {
  TASK_VIEWS,
  TASK_VIEW_LABEL,
  parseTaskView,
  resolveTaskChannelFilter,
  tasksHref,
  type TaskView,
} from '@work/lib/tasks/views'
import type { ChannelListItem } from './channel-items'
import { useShellData } from './shell-context'
import { PANE_ACTION_CLASS, ROW_ACTIVE_CLASS, ROW_CLASS } from './pane-styles'
import SubTitle from './SubTitle'
import { EmptyState } from './page'

const VIEW_ICON: Record<TaskView, LucideIcon> = {
  mine: CheckSquareIcon,
  today: CalendarCheckIcon,
  overdue: AlarmClockOffIcon,
  upcoming: CalendarClockIcon,
  created: PenLineIcon,
  done: CheckCheckIcon,
  all: LayersIcon,
}

const itemClass = ROW_CLASS
const activeClass = ROW_ACTIVE_CLASS

/** 현재 URL 의 보기·채널 필터와 새 할 일 링크(보기·채널을 유지한 채 폼만 연다) */
export function useTasksPaneState() {
  const pathname = usePathname() ?? '/'
  const params = useSearchParams()
  const onTasks = pathname === '/tasks' || pathname.startsWith('/tasks/')
  const view = parseTaskView(params?.get('view') ?? undefined)
  // 서버(/tasks 페이지)와 같은 규칙 — 메시지에서 "할 일로 만들기"로 들어오면 channel 은 필터가 아니다
  const channel = onTasks ? resolveTaskChannelFilter(Object.fromEntries(params ?? [])) : null
  return { onTasks, view, channel }
}

/** 머리글의 `+ 새 할 일` — 보기·채널을 유지하고 `new=1` 로 폼을 연다(채널이면 그 채널로 미리 채워진다) */
export function NewTaskPaneAction() {
  const { view, channel } = useTasksPaneState()
  return (
    <Link href={tasksHref({ view, channel, extra: { new: '1' } })} className={PANE_ACTION_CLASS}>
      <PlusIcon aria-hidden="true" className="size-3.5" />새 할 일
    </Link>
  )
}

/**
 * 할 일 목록 패널 — 보기(내 할 일·오늘 마감·기한 지남·예정·내가 만든·완료됨·전체) + 채널별(DM 제외).
 * 개수 배지는 없다: 개수는 /tasks 페이지가 조회한 할 일에서만 알 수 있고, 레이아웃 조회를 늘리지 않기 위해
 * 패널은 링크만 그린다(레일 "할 일" 배지가 내 미완료 수를 이미 보인다). 페이지 머리글이 현재 보기의 건수를 보인다.
 */
export default function TasksPaneContent({ channels }: { channels: ChannelListItem[] }) {
  const { onTasks, view, channel } = useTasksPaneState()
  const { channelSort = 'section', categories } = useShellData()
  const groups = groupChannelsForPane(
    channels.filter(c => c.kind !== 'dm'),
    channelSort,
    categories
  )

  return (
    <nav aria-label="할 일 보기">
      <ul aria-label="보기" className="space-y-px">
        {TASK_VIEWS.map(v => {
          const Icon = VIEW_ICON[v]
          const active = onTasks && !channel && view === v
          return (
            <li key={v}>
              <Link
                href={tasksHref({ view: v })}
                aria-current={active ? 'page' : undefined}
                className={cn(itemClass, active && activeClass)}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {TASK_VIEW_LABEL[v]}
              </Link>
            </li>
          )
        })}
      </ul>

      <SubTitle>채널</SubTitle>
      {groups.length === 0 ? (
        <EmptyState compact title="참여한 채널이 없습니다" />
      ) : (
        groups.map(group => (
          <section key={group.key} aria-label={`${group.label} 채널`}>
            {groups.length > 1 && (
              <h4 className="px-3 pt-2 pb-1 text-xs text-sidebar-foreground/70">{group.label}</h4>
            )}
            <ul className="space-y-px">
              {group.items.map(c => {
                const active = channel === c.id
                const Icon = c.kind === 'private' ? LockIcon : HashIcon
                return (
                  <li key={c.id}>
                    <Link
                      href={tasksHref({ channel: c.id })}
                      aria-current={active ? 'page' : undefined}
                      className={cn(itemClass, active && activeClass)}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate" title={c.name}>
                        {c.name}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </nav>
  )
}
