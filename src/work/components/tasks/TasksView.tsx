'use client'

import { chatLabelWithName } from '@work/lib/channels/group'
import { useMemo, useReducer, useState, type ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { CheckSquareIcon, PlusIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { deleteTask, toggleTaskDone, updateTask } from '@work/lib/tasks/actions'
import { assigneeCandidates } from '@work/lib/tasks/assignees'
import { OPEN_LIMIT } from '@work/lib/tasks/limits'
import { groupByChannel, isMine, sortTasks, taskReducer } from '@work/lib/tasks/reducer'
import type { NewTaskPrefill } from '@work/lib/tasks/schema'
import type { TaskChannelOption, TaskItem, TaskStaffOption } from '@work/lib/tasks/types'
import {
  DONE_VIEW_LIMIT,
  TASK_VIEWS,
  TASK_VIEW_EMPTY,
  TASK_VIEW_LABEL,
  filterByView,
  tasksHref,
  type TaskView,
} from '@work/lib/tasks/views'
import { cn } from '@work/lib/utils'
import {
  EmptyState,
  NoticeBanner,
  PageBody,
  PageHeader,
  SectionHeading,
} from '@work/components/layout/page'
import NewTaskForm from './NewTaskForm'
import TaskRow from './TaskRow'
import { useSeoulToday } from './use-today'
import { NativeSelect } from '@work/components/ui/native-select'

export default function TasksView({
  initialTasks,
  me,
  isAdmin,
  today: serverToday,
  channels,
  staff,
  channelMembers,
  prefill,
  lockedChannelId,
  ownedChannelIds,
  readOnly = false,
  canCreate = true,
  view = 'mine',
  channelFilter = null,
  onDismissPrefill,
  openTruncated = false,
}: {
  initialTasks: TaskItem[]
  me: string
  isAdmin: boolean
  /** 서울 기준 오늘(YYYY-MM-DD) — 서버에서 계산해 하이드레이션 불일치를 막는다 */
  today: string
  channels: TaskChannelOption[]
  staff: TaskStaffOption[]
  /** 채널 id → 멤버 id. 담당자 후보를 그 채널을 읽을 수 있는 staff 로 좁힌다(없으면 staff 전원) */
  channelMembers?: Record<string, string[]>
  prefill: NewTaskPrefill | null
  /**
   * 대화의 "할 일" 탭(docs/05 §4-4)이면 그 채널 id — `initialTasks`·`channels` 는 이 채널 것만 넘긴다.
   * 머리글·"내 할 일/채널별" 보기를 없애고 한 목록으로 보이며, 새 할 일 폼의 채널을 고정한다.
   */
  lockedChannelId?: string
  /** 내가 owner 인 채널 id — 다른 사람이 만든 할 일의 수정·완료 단추 표시용 */
  ownedChannelIds?: readonly string[]
  /** 읽기 전용(보관 채널 탭): 새 할 일 폼·체크·고치기·삭제를 숨기거나 막는다 */
  readOnly?: boolean
  /** 새 할 일을 만들 수 있는가(대화 탭: 멤버만). 기본 true */
  canCreate?: boolean
  /** /tasks?view= 로 고른 보기(기본 내 할 일). 대화 탭(lockedChannelId)에서는 쓰지 않는다 */
  view?: TaskView
  /** /tasks?channel= 로 고른 채널 — 있으면 보기보다 우선해 그 채널 할 일만 보인다 */
  channelFilter?: string | null
  /** URL 로 연 새 할 일 폼(`?new=1`·메시지 미리 채우기)을 닫거나 저장한 뒤 URL 에서 그 파라미터를 지운다 */
  onDismissPrefill?: () => void
  /** 미완료가 상한(500건)을 넘어 앞부분(마감 빠른 순)만 읽었다 — 안내 문구를 보인다 */
  openTruncated?: boolean
}) {
  const today = useSeoulToday(serverToday)
  const [tasks, dispatch] = useReducer(taskReducer, initialTasks)
  // 서버가 새 목록을 내려주면(router.refresh·다른 화면에서의 변경) 낡은 클라이언트 상태를 버린다
  const [seenInitial, setSeenInitial] = useState(initialTasks)
  if (seenInitial !== initialTasks) {
    setSeenInitial(initialTasks)
    dispatch({ type: 'reset', tasks: initialTasks })
  }
  const [error, setError] = useState<string | null>(null)

  const mine = useMemo(() => sortTasks(tasks.filter(t => isMine(t, me))), [tasks, me])
  const groups = useMemo(() => groupByChannel(tasks), [tasks])
  const channelTasks = useMemo(() => sortTasks(tasks), [tasks])
  const inChannel = useMemo(
    () => (channelFilter ? sortTasks(tasks.filter(t => t.channel_id === channelFilter)) : []),
    [tasks, channelFilter]
  )
  const viewTasks = useMemo(
    () => (view === 'all' ? [] : filterByView(tasks, view, me, today)),
    [tasks, view, me, today]
  )
  const filterName =
    channels.find(c => c.id === channelFilter)?.name ?? inChannel[0]?.channel_name ?? '선택한 채널'
  const staffName = useMemo(() => new Map(staff.map(s => [s.user_id, s.display_name])), [staff])
  const channelKind = useMemo(() => new Map(channels.map(c => [c.id, c.kind])), [channels])
  const candidatesIn = (channelId: string, kind: TaskChannelOption['kind'] | undefined) =>
    channelMembers && kind
      ? assigneeCandidates(staff, kind, channelMembers[channelId] ?? [])
      : channelMembers
        ? []
        : staff

  // 데스크톱 /tasks 는 본문 상단 버튼 대신 목록 패널 머리글 `+ 새 할 일` 과 빈 상태의 주 버튼을 쓴다(모바일은 패널이 없어 상단 버튼)
  const emptyAction =
    lockedChannelId === undefined && !readOnly && canCreate && channels.length > 0 && !prefill ? (
      <Link
        href={tasksHref({ view, channel: channelFilter, extra: { new: '1' } })}
        className={cn(buttonVariants({ size: 'sm' }), 'hidden md:inline-flex')}
      >
        <PlusIcon aria-hidden="true" />새 할 일 만들기
      </Link>
    ) : undefined

  const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

  async function onToggle(task: TaskItem, done: boolean) {
    setError(null)
    dispatch({ type: 'toggle', id: task.id, done, at: new Date().toISOString() })
    try {
      const res = await toggleTaskDone({ id: task.id, done })
      if (!res.ok) {
        dispatch({ type: 'replace', task })
        setError(res.error)
      }
    } catch {
      // 서버 액션이 던지면(오프라인 등) 낙관적 변경을 되돌린다.
      dispatch({ type: 'replace', task })
      setError(NETWORK_ERROR)
    }
  }

  async function onSave(
    task: TaskItem,
    patch: { title: string; assigneeId: string | null; dueOn: string | null }
  ): Promise<boolean> {
    setError(null)
    dispatch({
      type: 'patch',
      id: task.id,
      patch: {
        title: patch.title.trim(),
        assignee_id: patch.assigneeId,
        assignee_name:
          patch.assigneeId === task.assignee_id
            ? task.assignee_name
            : patch.assigneeId
              ? (staffName.get(patch.assigneeId) ?? null)
              : null,
        due_on: patch.dueOn,
      },
    })
    try {
      const res = await updateTask({
        id: task.id,
        title: patch.title,
        // 담당자를 바꾸지 않았다면 보내지 않는다 — 퇴사(비활성)한 담당자 건도 제목·마감일을 고칠 수 있게.
        ...(patch.assigneeId !== task.assignee_id ? { assigneeId: patch.assigneeId } : {}),
        dueOn: patch.dueOn,
      })
      if (!res.ok) {
        dispatch({ type: 'replace', task })
        setError(res.error)
        return false
      }
      return true
    } catch {
      dispatch({ type: 'replace', task })
      setError(NETWORK_ERROR)
      return false
    }
  }

  async function onDelete(task: TaskItem) {
    setError(null)
    dispatch({ type: 'remove', id: task.id })
    try {
      const res = await deleteTask({ id: task.id })
      if (!res.ok) {
        dispatch({ type: 'add', task })
        setError(res.error)
      }
    } catch {
      dispatch({ type: 'add', task })
      setError(NETWORK_ERROR)
    }
  }

  const rowProps = {
    me,
    isAdmin,
    ownedChannelIds,
    readOnly,
    today,
    staff,
    candidatesFor: (t: TaskItem) => candidatesIn(t.channel_id, t.channel_kind),
    onToggle,
    onSave,
    onDelete,
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!lockedChannelId && (
        <PageHeader
          title="할 일"
          hideOnMobile
          subtitle={
            channelFilter
              ? `# ${filterName} ${inChannel.length}건`
              : view === 'mine'
                ? `내 미완료 ${mine.filter(t => t.status === 'open').length}건`
                : view === 'all'
                  ? `${TASK_VIEW_LABEL.all} ${tasks.length}건`
                  : `${TASK_VIEW_LABEL[view]} ${viewTasks.length}건`
          }
        />
      )}
      <PageBody>
        {openTruncated && (
          <NoticeBanner>
            미완료 할 일이 많아 마감이 빠른 앞 {OPEN_LIMIT}개만 표시합니다. 일부를 완료하거나
            정리하면 나머지가 보입니다.
          </NoticeBanner>
        )}

        {!readOnly && canCreate && channels.length > 0 && (
          <NewTaskForm
            channels={channels}
            staff={staff}
            candidatesFor={id => candidatesIn(id, channelKind.get(id))}
            prefill={prefill}
            lockChannel={lockedChannelId !== undefined}
            onCreated={task => dispatch({ type: 'add', task })}
            onDismiss={onDismissPrefill}
            triggerClassName={lockedChannelId === undefined ? 'md:hidden' : undefined}
          />
        )}
        {readOnly && (
          <p className="text-xs text-muted-foreground">
            보관된 채널이라 할 일을 읽기만 할 수 있습니다.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {lockedChannelId ? (
          <section aria-label="이 대화의 할 일">
            {channelTasks.length === 0 ? (
              <TaskEmpty text="이 대화에 할 일이 없습니다" />
            ) : (
              <ul className="divide-y rounded-w-lg border">
                {channelTasks.map(t => (
                  <TaskRow key={t.id} task={t} showChannel={false} {...rowProps} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            <TaskViewNav view={view} channelFilter={channelFilter} channels={channels} />

            {channelFilter ? (
              <section aria-label={`# ${filterName} 할 일`}>
                {inChannel.length === 0 ? (
                  <TaskEmpty text="이 채널에 할 일이 없습니다" action={emptyAction} />
                ) : (
                  <ul className="divide-y rounded-w-lg border">
                    {inChannel.map(t => (
                      <TaskRow key={t.id} task={t} showChannel={false} {...rowProps} />
                    ))}
                  </ul>
                )}
              </section>
            ) : view === 'all' ? (
              <div role="region" aria-label={TASK_VIEW_LABEL.all} className="space-y-6">
                {groups.length === 0 ? (
                  <TaskEmpty text={TASK_VIEW_EMPTY.all} action={emptyAction} />
                ) : (
                  groups.map(g => (
                    <section key={g.channelId} aria-labelledby={`tasks-ch-${g.channelId}`}>
                      <SectionHeading
                        id={`tasks-ch-${g.channelId}`}
                        className="mb-2"
                        count={`· 열린 ${g.tasks.filter(t => t.status === 'open').length}건`}
                      >
                        {g.kind === 'dm' ? (g.label ?? chatLabelWithName(g.name)) : `# ${g.name}`}
                      </SectionHeading>
                      <ul className="divide-y rounded-w-lg border">
                        {g.tasks.map(t => (
                          <TaskRow key={t.id} task={t} showChannel={false} {...rowProps} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>
            ) : (
              <section aria-label={TASK_VIEW_LABEL[view]}>
                {viewTasks.length === 0 ? (
                  <TaskEmpty text={TASK_VIEW_EMPTY[view]} action={emptyAction} />
                ) : (
                  <ul className="divide-y rounded-w-lg border">
                    {viewTasks.map(t => (
                      <TaskRow key={t.id} task={t} {...rowProps} />
                    ))}
                  </ul>
                )}
                {view === 'done' && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    최근 완료한 {DONE_VIEW_LIMIT}건까지 보여 줍니다.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </PageBody>
    </div>
  )
}

function TaskEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <EmptyState icon={CheckSquareIcon} as="p" title={text}>
      {action}
    </EmptyState>
  )
}

/**
 * 모바일(<768px)용 보기 전환 — 데스크톱은 목록 패널이 같은 일을 한다. 링크 칩이라 JS 없이도 동작하고,
 * 채널은 GET 폼(select + 이동)으로 `?channel=` 에 간다.
 */
function TaskViewNav({
  view,
  channelFilter,
  channels,
}: {
  view: TaskView
  channelFilter: string | null
  channels: TaskChannelOption[]
}) {
  const options = channels.filter(c => c.kind !== 'dm')
  return (
    <nav aria-label="할 일 보기" className="space-y-2 md:hidden">
      <ul className="flex flex-wrap gap-1.5">
        {TASK_VIEWS.map(v => {
          const active = !channelFilter && view === v
          return (
            <li key={v}>
              <Link
                href={tasksHref({ view: v })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-full border px-3 text-xs pointer-coarse:h-11 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-accent font-medium text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {TASK_VIEW_LABEL[v]}
              </Link>
            </li>
          )
        })}
      </ul>
      {options.length > 0 && (
        <form method="get" action="/tasks" className="flex items-center gap-2">
          <label htmlFor="tasks-channel-select" className="sr-only">
            채널별로 보기
          </label>
          <NativeSelect id="tasks-channel-select" name="channel" defaultValue={channelFilter ?? ''}>
            <option value="" disabled>
              채널 선택
            </option>
            {options.map(c => (
              <option key={c.id} value={c.id}>
                # {c.name}
              </option>
            ))}
          </NativeSelect>
          <button
            type="submit"
            className="h-8 shrink-0 rounded-w-lg border px-3 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            이동
          </button>
        </form>
      )}
    </nav>
  )
}
