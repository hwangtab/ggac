'use client'

import { useState } from 'react'
import Link from '@work/lib/nav/link'
import { usePathname, useRouter, useSearchParams } from '@work/lib/nav/navigation'
import {
  AtSignIcon,
  BellIcon,
  BookmarkIcon,
  FileTextIcon,
  MessageSquareReplyIcon,
  MessagesSquareIcon,
  NotebookTextIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SmilePlusIcon,
  UsersIcon,
} from 'lucide-work'
import { splitPinnedRecent } from '@work/lib/channels/sort'
import { cn } from '@work/lib/utils'
import ChannelList from './ChannelList'
import ChannelSections from './ChannelSections'
import ChannelAddMenu from './ChannelAddMenu'
import CreateChannelDialog from '@work/components/chat/CreateChannelDialog'
import ChannelSortMenu, { ChatSortMenu } from './ChannelSortMenu'
import { useShellData } from './shell-context'
import TasksPaneContent, { NewTaskPaneAction } from './TasksPaneContent'
import { COUNT_BADGE_CLASS, PANE_ACTION_CLASS, ROW_ACTIVE_CLASS, ROW_CLASS } from './pane-styles'
import SubTitle from './SubTitle'
import FilesPaneContent from './FilesPaneContent'
import { EmptyState } from './page'
import { activeChannelId } from './active-channel'
import { hasWorkListPane, workSection } from './work-layout'
import type { ChannelListItem } from './channel-items'

export const LIST_PANE_ID = 'list-pane'

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

/** 이름으로 대화 거르기(대소문자·NFC 무시) */
function matchesName(item: Pick<ChannelListItem, 'name' | 'slug'>, q: string): boolean {
  const needle = q.normalize('NFC').toLowerCase()
  return [item.name, item.slug ?? '']
    .map(v => v.normalize('NFC').toLowerCase())
    .some(v => v.includes(needle))
}

/**
 * 목록 칸 머리의 찾기 입력(03 §2-3: 원본 상단바 검색의 자리). `onFilter`를 주면 그 자리에서 목록을 거르고(대화),
 * 없으면 Enter 로 전체 검색(`/search?q=`)을 연다. ⌘K 빠른 이동은 단축키로 남아 있다.
 */
function PaneFind({
  label,
  placeholder,
  value,
  onFilter,
}: {
  label: string
  placeholder: string
  value?: string
  onFilter?: (q: string) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  return (
    <form
      role="search"
      aria-label={label}
      className="shrink-0 border-b border-sidebar-border px-3 py-2"
      onSubmit={e => {
        e.preventDefault()
        if (onFilter) return
        const q = draft.trim()
        router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
      }}
    >
      <label className="flex h-8 items-center gap-2 rounded-w-md border bg-background px-2 text-sm pointer-coarse:h-11">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={onFilter ? (value ?? '') : draft}
          onChange={e => (onFilter ? onFilter(e.target.value) : setDraft(e.target.value))}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded-w-md border px-1 font-sans text-[10px] text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </label>
    </form>
  )
}

/** 대화(03 §8 결정 1): 채널과 메시지(DM·그룹)를 한 목록에서 두 묶음으로 */
function ConversationsPaneContent({
  channels,
  dms,
  activeId,
  isGuest,
  onCreateChannel,
}: {
  channels: ChannelListItem[]
  dms: ChannelListItem[]
  activeId: string | null
  isGuest: boolean
  onCreateChannel: () => void
}) {
  const [q, setQ] = useState('')
  const {
    channelSort = 'section',
    onChannelSortChange,
    chatSort = 'recent',
    onChatSortChange,
  } = useShellData()
  const query = q.trim()
  const shownChannels = query ? channels.filter(c => matchesName(c, query)) : channels
  const shownDms = query ? dms.filter(d => matchesName(d, query)) : dms
  return (
    <>
      <PaneFind label="대화 찾기" placeholder="채널·사람 찾기" value={q} onFilter={setQ} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <section aria-labelledby="pane-channels">
          <div className="flex items-center gap-1 pr-1">
            <div id="pane-channels" className="min-w-0 flex-1">
              <SubTitle>채널</SubTitle>
            </div>
            {!isGuest && <ChannelAddMenu onCreate={onCreateChannel} className="mt-2" />}
            {onChannelSortChange && (
              <ChannelSortMenu sort={channelSort} onChange={onChannelSortChange} className="mt-2" />
            )}
          </div>
          {query && shownChannels.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">찾는 채널이 없습니다</p>
          ) : (
            <ChannelsPaneContent channels={shownChannels} activeId={activeId} />
          )}
        </section>
        <section aria-labelledby="pane-messages">
          <div className="flex items-center gap-1 pr-1">
            <div id="pane-messages" className="min-w-0 flex-1">
              <SubTitle>메시지</SubTitle>
            </div>
            <Link href="/chat?new=1" className={cn(PANE_ACTION_CLASS, 'mt-2')} aria-label="새 채팅">
              <PlusIcon aria-hidden="true" className="size-3.5" />
            </Link>
            {onChatSortChange && (
              <ChatSortMenu sort={chatSort} onChange={onChatSortChange} className="mt-2" />
            )}
          </div>
          {query && shownDms.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">찾는 대화가 없습니다</p>
          ) : (
            <ChatsPaneContent dms={shownDms} activeId={activeId} />
          )}
        </section>
      </div>
    </>
  )
}

/** 검색(03 §3): 결과 종류로 바로 가기 — 결과 화면의 각 묶음 제목(`search-*`)으로 옮긴다 */
const SEARCH_KINDS = [
  { id: 'search-messages', label: '메시지', icon: MessagesSquareIcon },
  { id: 'search-notes', label: '메모', icon: NotebookTextIcon },
  { id: 'search-files', label: '파일', icon: PaperclipIcon },
  { id: 'search-documents', label: '문서 내용', icon: FileTextIcon },
  { id: 'search-people', label: '사람', icon: UsersIcon },
] as const

function SearchPaneContent() {
  const searchParams = useSearchParams()
  const searching = Boolean(searchParams?.get('q') || searchParams?.get('author'))
  return (
    <nav aria-label="검색 결과 종류">
      <SubTitle>결과 종류</SubTitle>
      {searching ? (
        <ul className="space-y-px">
          {SEARCH_KINDS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <a href={`#${id}`} className={ROW_CLASS}>
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-1 text-xs text-muted-foreground">
          검색하면 메시지·메모·파일·문서 내용·사람으로 나눠 보여 줍니다.
        </p>
      )}
    </nav>
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
  /** 좁은 화면(lg 미만)에서도 보인다 — 대화 첫 화면은 목록이 곧 화면이다(메일함과 같은 목록 → 상세) */
  onMobile?: boolean
  className?: string
}

/**
 * 목록 칸(w-72) — 이사회실 메뉴 '업무' 묶음에서 고른 갈래의 목록(docs/board-work/03-통합-재설계.md §3).
 * 갈래는 pathname 으로 정한다: 대화 = 채널·메시지 / 활동 = 알림 종류 / 할 일 = 보기·채널 / 자료실 = 폴더·형식 /
 * 검색 = 결과 종류. 업무 설정은 1단이라 그리지 않는다. 머리에 찾기 입력이 있다.
 * 데이터는 props 로만 받는다(조회 없음). `ChannelList` 는 순수 컴포넌트 그대로 쓴다.
 */
export default function ListPane({
  channels,
  dms,
  isGuest = false,
  mentionCount = 0,
  activityCount = 0,
  onMobile = false,
  className,
}: ListPaneProps) {
  const pathname = usePathname() ?? '/'
  const [createOpen, setCreateOpen] = useState(false)
  const section = workSection(pathname)
  if (!section || !hasWorkListPane(section)) return null
  const activeId = activeChannelId(pathname, [...channels, ...dms])

  let title: string
  let actionSlot: React.ReactNode = undefined
  let body: React.ReactNode
  let find: React.ReactNode = (
    <PaneFind label="업무 전체 검색" placeholder="메시지·파일·사람 검색" />
  )
  if (section === 'chat') {
    title = '대화'
    find = null
    body = (
      <ConversationsPaneContent
        channels={channels}
        dms={dms}
        activeId={activeId}
        isGuest={isGuest}
        onCreateChannel={() => setCreateOpen(true)}
      />
    )
  } else if (section === 'tasks') {
    title = '할 일'
    actionSlot = <NewTaskPaneAction />
    body = <TasksPaneContent channels={channels} />
  } else if (section === 'files') {
    title = '자료실'
    body = <FilesPaneContent channels={channels} isGuest={isGuest} />
  } else if (section === 'search') {
    title = '검색'
    find = null
    body = <SearchPaneContent />
  } else {
    title = '활동'
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
      aria-label={`${title} 목록`}
      className={cn(
        'w-full shrink-0 flex-col overflow-hidden rounded-w-lg border border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:w-72',
        onMobile ? 'flex' : 'hidden',
        className
      )}
    >
      <PaneHeader title={title} actionSlot={actionSlot} />
      {section === 'chat' ? (
        body
      ) : (
        <>
          {find}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{body}</div>
        </>
      )}
      {section === 'chat' && !isGuest && (
        <CreateChannelDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultCategoryId={channels.find(c => c.id === activeId)?.categoryId ?? null}
        />
      )}
    </aside>
  )
}
