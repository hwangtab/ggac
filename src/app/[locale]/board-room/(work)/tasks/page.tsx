import type { Metadata } from 'next'
import { requireWorkStaff, type WorkGuardContext } from '@/lib/server/boardWorkAuth'
import { canReadChannel, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { getMessageForTaskTitle } from '@/db/queries/work/tasks'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import TasksPageView from '@work/components/tasks/TasksPageView'
import { todaySeoul } from '@work/lib/tasks/due'
import {
  listTaskChannelMembers,
  listOwnedChannelIds,
  listTaskChannelOptions,
  listTaskStaffOptions,
  listTasks,
} from '@work/lib/tasks/queries'
import { defaultTaskTitle, parseNewTaskSearch, type NewTaskPrefill } from '@work/lib/tasks/schema'
import { parseTaskView, resolveTaskChannelFilter } from '@work/lib/tasks/views'

/**
 * 메시지에서 연 새 할 일 폼의 제목 기본값 — 본문을 URL 에 싣지 않으므로 서버가 messageId 로 읽는다(읽을 수 있는 채널만).
 * 민감 표시 메시지·삭제·읽기 실패는 빈 제목(사용자가 직접 쓴다).
 */
async function withMessageTitle(ctx: WorkGuardContext, prefill: NewTaskPrefill) {
  if (!prefill.messageId || !prefill.channelId || prefill.title) return prefill
  try {
    if (!(await canReadChannel(viewerOf(ctx), prefill.channelId))) return prefill
    const body = await getMessageForTaskTitle(prefill.messageId, prefill.channelId)
    return body ? { ...prefill, title: defaultTaskTitle(body) } : prefill
  } catch (e) {
    console.error('[tasks] 메시지 제목 기본값:', e)
    return prefill
  }
}

export const metadata: Metadata = { title: '할 일' }

/**
 * 할 일 — 원본 `app/(app)/tasks/page.tsx`. ?view=(내 할 일·오늘 마감·기한 지남·예정·내가 만든·완료됨·전체) 또는
 * ?channel=(그 채널만). 메시지 메뉴의 "할 일로 만들기"는 ?new=1&channel=&message= 로 폼을 미리 채운다.
 * 목록은 내가 읽을 수 있는 채널의 할 일만이다(원본 tasks_select = can_read_channel — `listTasks`가 읽기 범위로 거른다).
 * `data-testid="board-work-tasks"`는 권한 E2E가 보는 표식이다.
 */
export default async function BoardWorkTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const raw = await searchParams
  const parsedPrefill = parseNewTaskSearch(raw)
  const prefill = parsedPrefill && (await withMessageTitle(ctx, parsedPrefill))
  const view = parseTaskView(raw.view)
  const channelFilter = resolveTaskChannelFilter(raw)

  const [{ tasks, openTruncated }, channels, staffOptions, ownedChannelIds] = await Promise.all([
    listTasks(ctx, user.id),
    listTaskChannelOptions(ctx, user.id),
    listTaskStaffOptions(ctx),
    listOwnedChannelIds(ctx, user.id),
  ])
  // 담당자 후보: 새 할 일 폼의 채널 + 화면에 보이는 할 일의 채널
  const channelMembers = await listTaskChannelMembers(ctx, [
    ...channels.map(c => c.id),
    ...tasks.map(t => t.channel_id),
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board-work-tasks">
      <TasksPageView
        // 메시지에서 다시 들어오면(쿼리 변경) 폼 상태를 새로 잡는다
        key={prefill ? `${prefill.channelId}:${prefill.messageId}` : 'plain'}
        initialTasks={tasks}
        openTruncated={openTruncated}
        me={user.id}
        isAdmin={isWorkAdminRole(staff.role)}
        today={todaySeoul()}
        channels={channels}
        staff={staffOptions}
        channelMembers={channelMembers}
        ownedChannelIds={ownedChannelIds}
        prefill={prefill}
        view={view}
        channelFilter={channelFilter}
      />
    </div>
  )
}
