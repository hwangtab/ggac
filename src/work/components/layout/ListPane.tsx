'use client'

import { useState } from 'react'
import Link from '@work/lib/nav/link'
import { usePathname } from '@work/lib/nav/navigation'
import {
  AtSignIcon,
  BellIcon,
  BookmarkIcon,
  MessageSquareReplyIcon,
  PlusIcon,
  SmilePlusIcon,
} from 'lucide-work'
import { splitPinnedRecent } from '@work/lib/channels/sort'
import { cn } from '@work/lib/utils'
import ChannelList from './ChannelList'
import ChannelSections from './ChannelSections'
import ChannelAddMenu from './ChannelAddMenu'
import CreateChannelDialog from '@work/components/chat/CreateChannelDialog'
import ChannelSortMenu, { ChatSortMenu } from './ChannelSortMenu'
import { useShellData } from './shell-context'
import { COUNT_BADGE_CLASS, PANE_ACTION_CLASS, ROW_ACTIVE_CLASS, ROW_CLASS } from './pane-styles'
import SubTitle from './SubTitle'
import FilesPaneContent from './FilesPaneContent'
import { EmptyState } from './page'
import { activeChannelId } from './active-channel'
import { activeSection, sectionByKey, type SectionKey } from './nav-sections'
import type { ChannelListItem } from './channel-items'

export const LIST_PANE_ID = 'list-pane'

/** 목록 패널이 항상 있는 섹션 (관리는 셸 밖 레이아웃이 따로 그린다, 위키는 트리를 받았을 때만) */
// ggac 이식: 자료실은 2a에서 켰다. 할 일(2단계)·결재·위키(가져오지 않음)의 목록 패널은 없다
const PANE_SECTIONS: readonly SectionKey[] = ['activity', 'chat', 'channels', 'files']

/** wikiAvailable: 위키 트리를 받았는가(게스트는 위키를 못 쓰므로 받지 않는다) */
export function hasListPane(section: SectionKey | null, wikiAvailable = false): boolean {
  if (section === 'wiki') return wikiAvailable
  return section !== null && PANE_SECTIONS.includes(section)
}

function PaneHeader({
  title,
  action,
  actionSlot,
}: {
  title: string
  /** 머리글 오른쪽의 작은 링크(+ 새 채팅 · + 채널 추가) */
  action?: { href: string; label: string }
  /** 링크가 현재 URL 에 따라 달라지는 섹션(할 일)의 머리글 오른쪽 */
  actionSlot?: React.ReactNode
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-sidebar-border pr-2 pl-4">
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
      {action && (
        <Link href={action.href} className={PANE_ACTION_CLASS}>
          <PlusIcon aria-hidden="true" className="size-3.5" />
          {action.label}
        </Link>
      )}
      {actionSlot}
    </div>
  )
}

/** 채팅(DM) 목록 — 고정한 DM이 맨 위(각 묶음 안의 순서는 셸이 정렬해 준 그대로). 데스크톱 목록 패널과 모바일 `/chat` 화면이 함께 쓴다. */
export function ChatsPaneContent({
  dms,
  activeId,
}: {
  dms: ChannelListItem[]
  activeId?: string | null
}) {
  const { onTogglePin } = useShellData()
  const starred = dms.filter(d => d.starred)
  const rest = dms.filter(d => !d.starred)
  return (
    <>
      {starred.length > 0 && (
        <section aria-label="고정된 채팅">
          <SubTitle>고정됨</SubTitle>
          <ChannelList
            items={starred}
            activeId={activeId}
            label="고정된 채팅"
            onTogglePin={onTogglePin}
          />
        </section>
      )}
      <section aria-label="채팅 목록">
        {starred.length > 0 && <SubTitle>다이렉트 메시지</SubTitle>}
        <ChannelList
          items={rest}
          activeId={activeId}
          label="다이렉트 메시지"
          onTogglePin={onTogglePin}
          emptyText={dms.length === 0 ? '대화가 없습니다' : undefined}
        />
      </section>
    </>
  )
}

/** 채널 목록 — 고정한 채널이 맨 위. 정렬 방식(섹션별 / 최근 활동순)은 셸 설정을 따른다 */
export function ChannelsPaneContent({
  channels,
  activeId,
  onNavigate,
}: {
  channels: ChannelListItem[]
  activeId?: string | null
  onNavigate?: () => void
}) {
  const { channelSort = 'section', onTogglePin, categories, categoryOps } = useShellData()
  const recent = channelSort === 'recent'
  const split = recent
    ? splitPinnedRecent(channels)
    : {
        pinned: channels.filter(c => c.starred),
        rest: channels.filter(c => !c.starred),
      }
  const { pinned: starred, rest } = split
  return (
    <>
      {starred.length > 0 && (
        <section aria-label="고정된 채널">
          <SubTitle>고정됨</SubTitle>
          <ChannelList
            items={starred}
            activeId={activeId}
            label="고정된 채널"
            onNavigate={onNavigate}
            onTogglePin={onTogglePin}
          />
        </section>
      )}
      <section aria-label="채널 목록">
        {rest.length > 0 ? (
          recent ? (
            <>
              {starred.length > 0 && <SubTitle>채널</SubTitle>}
              <ChannelList
                items={rest}
                activeId={activeId}
                label="채널 (최근 활동순)"
                onNavigate={onNavigate}
                onTogglePin={onTogglePin}
              />
            </>
          ) : (
            <ChannelSections
              items={rest}
              allItems={channels}
              categories={categories}
              categoryOps={categoryOps}
              activeId={activeId}
              onNavigate={onNavigate}
              onTogglePin={onTogglePin}
            />
          )
        ) : (
          starred.length === 0 && <EmptyState compact title="참여한 채널이 없습니다" />
        )}
      </section>
    </>
  )
}

function ActivityPaneContent({
  pathname,
  mentionCount,
  activityCount,
}: {
  pathname: string
  mentionCount: number
  activityCount: number
}) {
  // 전체 배지 = 읽지 않은 멘션 + 새 답글·반응(레일 '활동' 배지와 같은 수)
  const total = mentionCount + activityCount
  const items = [
    { href: '/inbox', label: '전체', icon: BellIcon, active: pathname === '/inbox', badge: total },
    {
      href: '/inbox/mentions',
      label: '멘션',
      icon: AtSignIcon,
      active: pathname.startsWith('/inbox/mentions'),
      badge: mentionCount,
    },
    {
      href: '/inbox/replies',
      label: '답글',
      icon: MessageSquareReplyIcon,
      active: pathname.startsWith('/inbox/replies'),
      badge: 0,
    },
    {
      href: '/inbox/reactions',
      label: '반응',
      icon: SmilePlusIcon,
      active: pathname.startsWith('/inbox/reactions'),
      badge: 0,
    },
    {
      href: '/inbox/bookmarks',
      label: '북마크',
      icon: BookmarkIcon,
      active: pathname.startsWith('/inbox/bookmarks'),
      badge: 0,
    },
  ]
  return (
    <ul aria-label="활동" className="space-y-px">
      {items.map(({ href, label, icon: Icon, active, badge }) => (
        <li key={href}>
          <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(ROW_CLASS, active && ROW_ACTIVE_CLASS)}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
            {badge > 0 && (
              <span
                className={cn(
                  COUNT_BADGE_CLASS,
                  'ml-auto bg-mention-solid text-mention-solid-foreground'
                )}
              >
                <span aria-hidden="true">{badge > 99 ? '99+' : badge}</span>
                <span className="sr-only">
                  {href === '/inbox' && activityCount > 0
                    ? `새 활동 ${badge}건`
                    : `읽지 않은 멘션 ${badge}건`}
                </span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export type ListPaneProps = {
  /** 공개·비공개 채널(내가 멤버인 것) */
  channels: ChannelListItem[]
  /** DM 채널 */
  dms: ChannelListItem[]
  /** 게스트(초대받은 채널만): "채널 추가"를 숨긴다 */
  isGuest?: boolean
  /** 읽지 않은 멘션 수(활동 패널 배지) */
  mentionCount?: number
  /** 새 스레드 답글·반응 수(활동 패널 '전체' 배지에 멘션과 합산) */
  activityCount?: number
  /** 사용자가 접어 둔 상태(kw-list-collapsed) 또는 좁은 화면에서 우측 패널과 겹쳐 일시 접힘 */
  collapsed?: boolean
  className?: string
}

/**
 * 목록 패널(260px) — 레일에서 고른 섹션의 목록(설계 03 §2-1). 섹션은 pathname 으로 정한다.
 * 목록이 없는 섹션(위키 트리 없음·검색·설정 등)이거나 접힌 상태면 아무것도 그리지 않는다.
 * 데이터는 props 로만 받는다(조회 없음). `ChannelList` 는 순수 컴포넌트 그대로 쓴다.
 */
export default function ListPane({
  channels,
  dms,
  isGuest = false,
  mentionCount = 0,
  activityCount = 0,
  collapsed = false,
  className,
}: ListPaneProps) {
  const pathname = usePathname() ?? '/'
  const [createOpen, setCreateOpen] = useState(false)
  const {
    channelSort = 'section',
    onChannelSortChange,
    chatSort = 'recent',
    onChatSortChange,
  } = useShellData()
  const section = activeSection(pathname)
  if (collapsed || !section || !hasListPane(section)) return null
  const activeId = activeChannelId(pathname, [...channels, ...dms])

  let header: { title: string; action?: { href: string; label: string } }
  let actionSlot: React.ReactNode = undefined
  let body: React.ReactNode
  if (section === 'chat') {
    header = { title: '채팅', action: { href: '/chat?new=1', label: '새 채팅' } }
    if (onChatSortChange) {
      actionSlot = <ChatSortMenu sort={chatSort} onChange={onChatSortChange} />
    }
    body = <ChatsPaneContent dms={dms} activeId={activeId} />
  } else if (section === 'channels') {
    header = { title: '채널' }
    actionSlot = (
      <>
        {!isGuest && <ChannelAddMenu onCreate={() => setCreateOpen(true)} />}
        {onChannelSortChange && (
          <ChannelSortMenu sort={channelSort} onChange={onChannelSortChange} />
        )}
      </>
    )
    body = <ChannelsPaneContent channels={channels} activeId={activeId} />
  } else if (section === 'files') {
    header = { title: '자료실' }
    body = <FilesPaneContent channels={channels} isGuest={isGuest} />
  } else {
    header = { title: sectionByKey(section).label }
    body = (
      <ActivityPaneContent
        pathname={pathname}
        mentionCount={mentionCount}
        activityCount={activityCount}
      />
    )
  }

  return (
    <aside
      id={LIST_PANE_ID}
      aria-label={`${header.title} 목록`}
      className={cn(
        'hidden w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex',
        className
      )}
    >
      <PaneHeader title={header.title} action={header.action} actionSlot={actionSlot} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{body}</div>
      {section === 'channels' && !isGuest && (
        <CreateChannelDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultCategoryId={channels.find(c => c.id === activeId)?.categoryId ?? null}
        />
      )}
    </aside>
  )
}
