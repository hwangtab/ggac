'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { PlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import AddTabDialog from '@work/components/tabs/AddTabDialog'
import TabMenu from '@work/components/tabs/TabMenu'
import { subscribeChannelTopic } from '@work/lib/messages/realtime'
import { canAddTab, canManageTab } from '@work/lib/tabs/permissions'
import { parseTabConfig } from '@work/lib/tabs/schema'
import type { TabBarData } from '@work/lib/tabs/types'
import ConversationTabs from './ConversationTabs'
import {
  buildConversationTabs,
  conversationBasePath,
  type ConversationRef,
} from './conversation-tabs'

/**
 * 대화 탭 바(서버 데이터를 받아 그리는 클라이언트 조각) — 기본 탭 + 추가 탭 + ⋯ 메뉴 + "＋" 단추 + 실시간 갱신.
 * `data` 가 없으면(탭 정보를 읽지 않은 화면·테스트) 기본 탭만 그린다.
 * 다른 사람이 탭을 바꾸면 채널 토픽 신호(table=conversation_tabs)를 받아 router.refresh() 로 다시 그린다.
 */
export default function ConversationTabBar({
  conversation,
  activeKey,
  data,
}: {
  conversation: ConversationRef
  activeKey: string
  data?: TabBarData
}) {
  if (!data) {
    return <ConversationTabs tabs={buildConversationTabs(conversation)} activeKey={activeKey} />
  }
  return <InteractiveTabBar conversation={conversation} activeKey={activeKey} data={data} />
}

function InteractiveTabBar({
  conversation,
  activeKey,
  data,
}: {
  conversation: ConversationRef
  activeKey: string
  data: TabBarData
}) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const tabs = useMemo(
    () => buildConversationTabs(conversation, data.tabs),
    [conversation, data.tabs]
  )
  const base = conversationBasePath(conversation)
  const order = useMemo(() => data.tabs.map(t => t.id), [data.tabs])
  const isDm = conversation.kind === 'dm'
  const actor = {
    meId: data.me.id,
    isAdmin: data.me.isAdmin,
    isGuest: data.me.isGuest,
    isMember: data.isMember,
    isChannelOwner: data.isChannelOwner,
  }
  // 보관된 채널은 관리자 포함 모두에게 읽기 전용 UI(관리자는 보관 해제 후 편집 — DB 는 관리자를 허용하지만 화면은 통일)
  const frozen = data.archived === true
  const mayAdd = canAddTab(actor) && !frozen

  // 멤버만 채널 토픽을 구독할 수 있다(공개 채널 미리보기는 구독 안 함)
  useEffect(() => {
    if (!data.isMember) return
    const handle = subscribeChannelTopic(
      conversation.id,
      event => {
        if (event.type === 'tabs') router.refresh()
      },
      // ggac 이식(폴링): 서버가 탭을 읽기 직전의 rev를 시작 커서로 — 첫 폴 전에 바뀐 탭·메모도 놓치지 않는다
      { rev: data.rev ?? null }
    )
    return () => handle.unsubscribe()
    // data.rev는 처음 구독할 때만 쓴다(이미 붙은 토픽은 커서를 이어 간다) — 새로 고칠 때마다 다시 붙지 않게 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, data.isMember, router])

  return (
    <>
      <ConversationTabs
        tabs={tabs}
        activeKey={activeKey}
        renderMenu={tab =>
          tab.custom ? (
            <TabMenu
              tabId={tab.custom.id}
              title={tab.label}
              href={tab.href}
              baseHref={base}
              active={tab.key === activeKey}
              canManage={!frozen && canManageTab(actor, tab.custom, { isDm })}
              kind={tab.custom.kind}
              channelId={conversation.id}
              fileAttachmentId={
                tab.custom.kind === 'file'
                  ? parseTabConfig('file', data.tabs.find(t => t.id === tab.custom?.id)?.config)
                      ?.attachmentId
                  : undefined
              }
              canUploadVersion={mayAdd}
              canMoveLeft={order.indexOf(tab.custom.id) > 0}
              canMoveRight={order.indexOf(tab.custom.id) < order.length - 1}
            />
          ) : null
        }
        trailing={
          mayAdd ? (
            // 추가 탭이 하나도 없으면 아이콘만으로는 기능을 알아보기 어려워 글자를 붙인다
            <Button
              type="button"
              variant="ghost"
              size={data.tabs.length === 0 ? 'sm' : 'icon-sm'}
              aria-label="탭 추가"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDialogKey(k => k + 1)
                setAddOpen(true)
              }}
            >
              <PlusIcon aria-hidden="true" />
              {data.tabs.length === 0 ? '탭 추가' : null}
            </Button>
          ) : null
        }
      />
      {/* 게시물 탭은 입력창 자리에 "보관된 채널입니다" 안내가 이미 있어 띠를 겹쳐 두지 않는다 — 다른 탭(파일·할 일·메모 등)에서만 */}
      {frozen && activeKey !== 'posts' && (
        <p role="status" className="border-b bg-muted/50 px-4 py-1 text-xs text-muted-foreground">
          보관된 채널이라 탭을 바꿀 수 없습니다.
        </p>
      )}
      {mayAdd && (
        <AddTabDialog
          key={dialogKey}
          open={addOpen}
          onOpenChange={setAddOpen}
          channelId={conversation.id}
          hasGuests={data.hasGuests}
          hasTasksTab={data.tabs.some(t => t.kind === 'tasks')}
          isGuest={data.me.isGuest}
        />
      )}
    </>
  )
}
