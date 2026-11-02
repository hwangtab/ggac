'use client'

import { useRouter } from '@work/lib/nav/navigation'
import { tasksHref } from '@work/lib/tasks/views'
import TasksView from './TasksView'

/**
 * `/tasks` 페이지용 얇은 래퍼. URL 로 연 새 할 일 폼(`?new=1`, 메시지 미리 채우기)을 닫거나 저장하면
 * `new`·`message`·`title` 파라미터를 지워(`router.replace`), 같은 `+ 새 할 일` 링크를 다시 눌러도 URL 이 바뀌어 폼이 다시 열린다.
 */
export default function TasksPageView(props: React.ComponentProps<typeof TasksView>) {
  const router = useRouter()
  const { prefill, view, channelFilter } = props
  return (
    <TasksView
      {...props}
      onDismissPrefill={
        prefill
          ? () => router.replace(tasksHref({ view, channel: channelFilter }), { scroll: false })
          : undefined
      }
    />
  )
}
