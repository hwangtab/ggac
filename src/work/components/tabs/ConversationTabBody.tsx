import { FileQuestionIcon } from 'lucide-work'
import { EmptyState, NoticeBanner } from '@work/components/layout/page'
import TasksView from '@work/components/tasks/TasksView'
import NoteTabView from '@work/components/notes/NoteTabView'
import type { WorkGuardContext } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import type { ChannelDetail } from '@work/lib/channels/types'
import { todaySeoul } from '@work/lib/tasks/due'
import { listTaskChannelMembers, listTaskStaffOptions } from '@work/lib/tasks/queries'
import { getNote } from '@work/lib/notes/queries'
import { listChannelTasks, loadFileTabData } from '@work/lib/tabs/queries'
import FileTabView from './FileTabView'
import { parseTabConfig } from '@work/lib/tabs/schema'
import type { ConversationTabItem } from '@work/lib/tabs/types'
import WebsiteTabView from './WebsiteTabView'

/**
 * 추가 탭 한 개의 본문(서버 컴포넌트) — kind 별로 갈라 그린다. 원본 kosmart-work `components/tabs/ConversationTabBody.tsx`.
 * - note: 대화 공용 메모(NoteTabView — 보기·편집·이력, 낙관적 잠금)
 * - website: 링크 카드(WebsiteTabView — ggac 이식: 탭 안 표시는 CSP 허용 목록 전까지 끔)
 * - tasks: TasksView 를 이 채널로 고정
 * - file: 형식별 뷰어 + 이전 버전(FileTabView, 3단계 — 계보 최신을 보여 준다)
 * 원본의 wiki·timeline 종류는 가져오지 않았다.
 */
export default async function ConversationTabBody({
  tab,
  channel,
  auth,
  access,
}: {
  tab: ConversationTabItem
  channel: ChannelDetail
  /** ggac 이식: 원본 supabase·user·staff 세 인자 자리 */
  auth: WorkGuardContext
  /** 내 멤버십·보관 여부(쓰기 UI 판단). 없으면 제한하지 않는다 */
  access?: { isMember: boolean; isChannelOwner: boolean; archived: boolean }
}) {
  const { user, staff } = auth

  if (tab.kind === 'file') {
    const config = parseTabConfig('file', tab.config)
    if (!config) {
      return (
        <div className="p-4">
          <NoticeBanner tone="destructive" role="alert">
            이 탭의 설정을 읽을 수 없습니다. 탭을 제거하고 다시 추가해 주세요.
          </NoticeBanner>
        </div>
      )
    }
    const data = await loadFileTabData(auth, channel.id, config)
    return <FileTabView current={data.current} history={data.history} />
  }

  if (tab.kind === 'note') {
    const config = parseTabConfig('note', tab.config)
    const note = config ? await getNote(auth, config.noteId, channel.id) : null
    if (!note) {
      return (
        <EmptyState
          icon={FileQuestionIcon}
          as="p"
          title="메모를 찾을 수 없습니다"
          description="메모가 지워졌거나 읽을 권한이 없습니다. 탭을 제거하고 다시 추가해 주세요."
        />
      )
    }
    // 쓰기는 대화 멤버이면서 내부 staff(게스트 제외) — 실제 차단은 서버 액션·쿼리 계층이 한다.
    // 보관된 채널은 관리자 포함 모두에게 읽기 전용 UI(관리자는 보관 해제 후 편집)
    const frozen = channel.archived_at !== null
    return (
      <NoteTabView
        note={note}
        canEdit={staff.role !== 'guest' && access?.isMember === true && !frozen}
      />
    )
  }

  if (tab.kind === 'website') return <WebsiteTabView title={tab.title} config={tab.config} />

  if (tab.kind !== 'tasks') {
    return (
      <div className="p-4">
        <NoticeBanner tone="destructive" role="alert">
          이 탭의 설정을 읽을 수 없습니다. 탭을 제거하고 다시 추가해 주세요.
        </NoticeBanner>
      </div>
    )
  }

  // tasks
  const [tasks, staffOptions, channelMembers] = await Promise.all([
    listChannelTasks(auth, channel.id),
    listTaskStaffOptions(auth),
    listTaskChannelMembers(auth, [channel.id]),
  ])
  const kind = channel.kind
  return (
    <TasksView
      initialTasks={tasks}
      me={user.id}
      isAdmin={isWorkAdminRole(staff.role)}
      today={todaySeoul()}
      channels={[{ id: channel.id, name: channel.name, kind, group: channel.isGroup }]}
      staff={staffOptions}
      channelMembers={channelMembers}
      prefill={null}
      lockedChannelId={channel.id}
      ownedChannelIds={access?.isChannelOwner ? [channel.id] : []}
      readOnly={access?.archived === true}
      canCreate={access ? access.isMember : true}
    />
  )
}
