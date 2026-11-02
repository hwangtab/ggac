import { notFound } from 'next/navigation'
import ConversationPageHeader from '@work/components/chat/ConversationPageHeader'
import ConversationTabBar from '@work/components/chat/ConversationTabBar'
import type { WorkGuardContext } from '@/lib/server/boardWorkAuth'
import type { ChannelDetail } from '@work/lib/channels/types'
import { customTabKey } from '@work/lib/tabs/paths'
import { getConversationTab, loadTabBarData } from '@work/lib/tabs/queries'
import ConversationTabBody from './ConversationTabBody'

/** ggac 이식: 원본 `Awaited<ReturnType<typeof requireStaff>>`(supabase·user·staff) 자리 — `requireWorkStaff()`의 결과 */
type Staffed = WorkGuardContext

/**
 * 추가 탭 화면 `/c/<slug>/t/<tabId>` · `/dm/<id>/t/<tabId>` 의 공통 본체(서버 컴포넌트).
 * 호출한 페이지가 가드(requireWorkStaff)와 채널 조회를 마친 뒤 부른다. 탭이 이 채널 소속이 아니거나(다른 대화의 탭 id),
 * 없거나, 읽을 수 없으면 404 — 존재 여부를 드러내지 않는다.
 * `data-testid="board-work-tab"`은 권한 E2E가 "탭 본문이 그려졌다/안 그려졌다"를 보는 표식이다.
 */
export default async function ConversationTabPage({
  channel,
  tabId,
  auth,
}: {
  channel: ChannelDetail
  tabId: string
  auth: Staffed
}) {
  const { user, staff } = auth
  const tab = await getConversationTab(auth, channel.id, tabId, staff.role)
  if (!tab) notFound()
  const tabBar = await loadTabBarData(auth, channel.id, { id: user.id, role: staff.role })

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="board-work-tab"
      data-tab-id={tab.id}
      data-tab-kind={tab.kind}
    >
      <ConversationPageHeader channel={channel} />
      <ConversationTabBar conversation={channel} activeKey={customTabKey(tab.id)} data={tabBar} />
      <div className="flex min-h-0 flex-1 flex-col">
        <ConversationTabBody
          tab={tab}
          channel={channel}
          auth={auth}
          access={{
            isMember: tabBar.isMember,
            isChannelOwner: tabBar.isChannelOwner,
            archived: tabBar.archived === true,
          }}
        />
      </div>
    </div>
  )
}
