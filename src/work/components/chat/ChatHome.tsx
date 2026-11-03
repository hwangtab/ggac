'use client'

import type { ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { MessageSquarePlusIcon, MessagesSquareIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'
import { ChatsPaneContent } from '@work/components/layout/ListPane'
import { useShellData } from '@work/components/layout/shell-context'
import { ChatSortMenu } from '@work/components/layout/ChannelSortMenu'
import { MOBILE_SORT_CLASS } from '@work/components/layout/pane-styles'

/**
 * /chat 본문. 데스크톱은 목록 패널이 있으므로 빈 상태만, 모바일은 이 화면이 DM 목록 전체 화면이다
 * (섹션 루트 = 목록, 설계 03 §2-4).
 */
export default function ChatHome({
  title = '대화를 고르세요',
  description = '목록에서 대화를 고르거나 새 채팅으로 동료에게 말을 걸어 보세요.',
}: {
  /** ggac 이식: 업무툴 첫 화면(`/board-room/chat`)이 원본 홈 자리를 겸해서 제목·설명을 바꿀 수 있게 했다 */
  title?: ReactNode
  description?: ReactNode
} = {}) {
  const { dms, chatSort = 'recent', onChatSortChange } = useShellData()
  return (
    <>
      <EmptyState
        as="h1"
        icon={MessagesSquareIcon}
        title={title}
        description={description}
        className="hidden md:flex"
      >
        <Link href="/chat?new=1" className={buttonVariants({ size: 'sm' })}>
          <MessageSquarePlusIcon aria-hidden="true" />새 채팅
        </Link>
      </EmptyState>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 md:hidden">
        <h1 className="sr-only">채팅</h1>
        <div className="mb-2 flex items-center gap-1">
          <Link href="/chat?new=1" className={buttonVariants({ className: 'flex-1' })}>
            <MessageSquarePlusIcon aria-hidden="true" />새 채팅
          </Link>
          {onChatSortChange && (
            <ChatSortMenu
              sort={chatSort}
              onChange={onChatSortChange}
              className={MOBILE_SORT_CLASS}
            />
          )}
        </div>
        <ChatsPaneContent dms={dms} />
      </div>
    </>
  )
}
