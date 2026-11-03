'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { chatKindLabel } from '@work/lib/channels/group'
import Link from '@work/lib/nav/link'
import { useRouter } from '@work/lib/nav/navigation'
import {
  AtSignIcon,
  BookmarkIcon,
  BellIcon,
  CheckCheckIcon,
  HashIcon,
  LockIcon,
  MessageSquareReplyIcon,
  SmilePlusIcon,
  UserIcon,
} from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { EmptyState, PageBody, PageHeader, SectionHeading } from '@work/components/layout/page'
import {
  markActivitySeen,
  markAllMentionsRead,
  markMentionRead,
  removeBookmark,
} from '@work/lib/inbox/actions'
import type {
  ActivityItem,
  BookmarkItem,
  InboxChannel,
  InboxItem,
  MentionItem,
} from '@work/lib/inbox/queries'
import { formatDateTime } from '@work/lib/format/datetime'
import { COUNT_BADGE_CLASS } from '@work/components/layout/pane-styles'
import { SubNav, SubNavLink } from '@work/components/layout/sub-nav'
import { cn } from '@work/lib/utils'

export type InboxTab = 'all' | 'mentions' | 'replies' | 'reactions' | 'bookmarks'

/** 활동 탭 — 서버 페이지가 탭마다 주소를 갖는다(레일·목록 패널 링크·뒤로 가기와 맞춘다) */
export const INBOX_TABS: { id: InboxTab; label: string; href: string }[] = [
  { id: 'all', label: '전체', href: '/inbox' },
  { id: 'mentions', label: '멘션', href: '/inbox/mentions' },
  { id: 'replies', label: '답글', href: '/inbox/replies' },
  { id: 'reactions', label: '반응', href: '/inbox/reactions' },
  { id: 'bookmarks', label: '북마크', href: '/inbox/bookmarks' },
]
const TABS = INBOX_TABS

const NETWORK_ERROR = '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

function ChannelLabel({ channel }: { channel: InboxChannel | null }) {
  if (!channel) return <span>알 수 없는 채널</span>
  if (channel.kind === 'dm') {
    return (
      <span className="inline-flex items-center gap-1">
        <UserIcon aria-hidden="true" className="size-3.5" />
        {chatKindLabel(channel.name)}
      </span>
    )
  }
  const Icon = channel.kind === 'private' ? LockIcon : HashIcon
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5" />
      {channel.name}
    </span>
  )
}

function ItemMeta({ item, now }: { item: InboxItem; now?: Date }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <ChannelLabel channel={item.channel} />
      <span className="font-medium text-foreground">{item.authorName}</span>
      <time dateTime={item.createdAt}>{formatDateTime(item.createdAt, now)}</time>
      {item.parentId && <span>스레드 답글</span>}
    </span>
  )
}

function MentionRow({
  item: m,
  now,
  onOpen,
}: {
  item: MentionItem
  now?: Date
  onOpen: (item: MentionItem) => void
}) {
  return (
    <Link
      href={m.href}
      onClick={() => onOpen(m)}
      className={cn(
        'block px-4 py-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        m.readAt ? 'border-l-2 border-transparent' : 'border-l-2 border-primary bg-primary/5'
      )}
    >
      <span className="flex items-start gap-2">
        {!m.readAt && (
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-mention" />
        )}
        <span className="min-w-0 flex-1">
          <ItemMeta item={m} now={now} />
          <span className="mt-1 block text-sm break-words">{m.preview}</span>
        </span>
        <span className="sr-only">{m.readAt ? '읽음' : '읽지 않음'}</span>
      </span>
    </Link>
  )
}

function ActivityRow({ item, now }: { item: ActivityItem; now?: Date }) {
  const reaction = item.kind === 'reaction'
  const Icon = reaction ? SmilePlusIcon : MessageSquareReplyIcon
  return (
    <Link
      href={item.href}
      className={cn(
        'block px-4 py-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        item.isNew ? 'border-l-2 border-primary bg-primary/5' : 'border-l-2 border-transparent'
      )}
    >
      <span className="flex items-start gap-2">
        {item.isNew && (
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
        )}
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {item.actorName}
              {reaction ? `님이 ${item.emoji ?? ''} 반응을 남겼습니다` : '님이 답글을 남겼습니다'}
            </span>
            <ChannelLabel channel={item.channel} />
            <time dateTime={item.createdAt}>{formatDateTime(item.createdAt, now)}</time>
          </span>
          <span className="mt-1 block text-sm break-words">{item.preview}</span>
        </span>
        <span className="sr-only">{item.isNew ? '새 활동' : '확인함'}</span>
      </span>
    </Link>
  )
}

/**
 * 활동(QA #10, 0019): 전체 · 멘션 · 답글 · 반응 · 북마크. 탭마다 주소가 있다(INBOX_TABS).
 * 답글·반응은 열면 '활동 확인 시각'을 갱신한다(markActivitySeen) — 화면은 열 때의 새 항목 id 를 붙잡아 이 화면에 있는 동안 강조를 유지한다(newIds).
 * 멘션을 누르면 읽음 처리(낙관적) 후 그 메시지로(스레드 답글이면 스레드를 연다) 이동한다.
 */
const NO_MENTIONS: MentionItem[] = []
const NO_ACTIVITY: ActivityItem[] = []

export default function InboxView({
  tab,
  mentions = NO_MENTIONS,
  activity: serverActivity = NO_ACTIVITY,
  bookmarks = [],
  now,
}: {
  tab: InboxTab
  mentions?: MentionItem[]
  activity?: ActivityItem[]
  bookmarks?: BookmarkItem[]
  now?: Date
}) {
  const router = useRouter()
  // 멘션은 서버 값이 바뀌면(새 멘션·refresh) 그대로 따라가고, 이 화면에서 누른 읽음만 위에 덮는다
  const [localRead, setLocalRead] = useState<Record<string, string>>({})
  const items = useMemo(
    () =>
      mentions.map(m =>
        !m.readAt && localRead[m.messageId] ? { ...m, readAt: localRead[m.messageId] } : m
      ),
    [mentions, localRead]
  )
  // 열었을 때(그리고 이 화면에 있는 동안 새로 온) 새 활동 id — markActivitySeen → refresh 로 서버의 isNew 가
  // 모두 꺼져도 강조·"새 활동 N건"이 유지된다. 다른 화면에 갔다 오면(언마운트) 초기화된다.
  const [newIds, setNewIds] = useState<Set<string>>(
    () => new Set(serverActivity.filter(a => a.isNew).map(a => a.id))
  )
  const activity = useMemo(
    () => serverActivity.map(a => (a.isNew || newIds.has(a.id) ? { ...a, isNew: true } : a)),
    [serverActivity, newIds]
  )
  useEffect(() => {
    const fresh = serverActivity.filter(a => a.isNew && !newIds.has(a.id)).map(a => a.id)
    if (fresh.length === 0) return
    setNewIds(cur => new Set([...cur, ...fresh]))
  }, [serverActivity, newIds])
  const [marks, setMarks] = useState(bookmarks)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const unread = items.filter(m => !m.readAt).length
  const activityTab = tab === 'all' || tab === 'replies' || tab === 'reactions'
  // 서버 기준 새 활동이 있을 때만 확인 시각을 갱신한다(유지 중인 newIds 로 반복 호출하지 않는다)
  const hasNewActivity = serverActivity.some(a => a.isNew)

  // 전체 = 멘션 + 답글 + 반응(최신순). 멘션이면서 답글인 메시지는 DB 가 답글 쪽에서 빼므로 한 번만 나온다.
  type FeedEntry = {
    key: string
    createdAt: string
    isNew: boolean
    mention?: MentionItem
    activity?: ActivityItem
  }
  const feed: FeedEntry[] = [
    ...(tab === 'all'
      ? items.map(m => ({
          key: `mention:${m.messageId}`,
          createdAt: m.createdAt,
          isNew: !m.readAt,
          mention: m,
        }))
      : []),
    ...activity
      .filter(
        a => tab === 'all' || (tab === 'replies' ? a.kind === 'reply' : a.kind === 'reaction')
      )
      .map(a => ({ key: a.id, createdAt: a.createdAt, isNew: a.isNew, activity: a })),
  ].sort((x, y) => y.createdAt.localeCompare(x.createdAt))

  // 답글·반응 탭을 열면 활동 확인 시각을 갱신하고 배지를 새로 그린다(새 활동이 있을 때만)
  useEffect(() => {
    if (!activityTab || !hasNewActivity) return
    void markActivitySeen()
      .then(res => {
        if (res.ok) router.refresh()
      })
      .catch(e => console.error('[inbox] markActivitySeen', e))
  }, [activityTab, hasNewActivity, router])

  function openMention(item: MentionItem) {
    if (item.readAt) return
    const at = new Date().toISOString()
    setLocalRead(cur => ({ ...cur, [item.messageId]: at }))
    // 이동을 막지 않는다 — 실패하면 채널 화면의 읽음 처리가 어차피 멘션을 지운다
    void markMentionRead({ messageId: item.messageId })
      .then(res => {
        if (res.ok) router.refresh()
      })
      .catch(e => console.error('[inbox] markMentionRead', e))
  }

  function readAll() {
    setError(null)
    const before = localRead
    const at = new Date().toISOString()
    setLocalRead(cur => {
      const next = { ...cur }
      for (const m of items) if (!m.readAt) next[m.messageId] = at
      return next
    })
    start(async () => {
      try {
        const res = await markAllMentionsRead()
        if (!res.ok) {
          setLocalRead(before)
          setError(res.error)
          return
        }
        router.refresh()
      } catch {
        setLocalRead(before)
        setError(NETWORK_ERROR)
      }
    })
  }

  function unbookmark(item: BookmarkItem) {
    setError(null)
    setMarks(cur => cur.filter(b => b.messageId !== item.messageId))
    start(async () => {
      try {
        const res = await removeBookmark({ messageId: item.messageId })
        if (!res.ok) {
          setMarks(cur =>
            [item, ...cur].sort((a, b) => b.bookmarkedAt.localeCompare(a.bookmarkedAt))
          )
          setError(res.error)
        }
      } catch {
        setMarks(cur => [item, ...cur].sort((a, b) => b.bookmarkedAt.localeCompare(a.bookmarkedAt)))
        setError(NETWORK_ERROR)
      }
    })
  }

  const listClass = 'divide-y overflow-hidden rounded-w-lg border'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="활동" />

      {/* 탭 줄도 본문(PageBody)과 같은 컨테이너 폭·패딩 안에 둬서 시작선이 하나다.
          첫 항목의 px-3 만큼 -ml-3 으로 당겨 글자가 본문 글자와 같은 선에서 시작한다. 테두리는 바깥 div 가 전폭으로 긋는다 */}
      <div className="shrink-0 border-b">
        <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
          <SubNav label="활동 보기" className="-ml-3 border-b-0">
            {TABS.map(t => (
              <SubNavLink key={t.id} href={t.href} active={tab === t.id}>
                {t.label}
                {t.id === 'mentions' && tab === 'mentions' && unread > 0 && (
                  <span
                    className={cn(
                      COUNT_BADGE_CLASS,
                      'ml-1.5 bg-mention-solid text-mention-solid-foreground'
                    )}
                  >
                    {unread}
                  </span>
                )}
              </SubNavLink>
            ))}
          </SubNav>
        </div>
      </div>

      <PageBody>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {tab === 'bookmarks' ? (
          <section aria-labelledby="inbox-bookmarks-h" className="space-y-3">
            <SectionHeading id="inbox-bookmarks-h" count={`${marks.length}건`}>
              북마크
            </SectionHeading>
            {marks.length === 0 ? (
              <EmptyState
                icon={BookmarkIcon}
                as="p"
                title="북마크한 메시지가 없습니다."
                description="메시지의 책갈피 단추로 모아 둘 수 있습니다."
              />
            ) : (
              <ul className={listClass}>
                {marks.map(b => (
                  <li key={b.messageId} className="flex items-start gap-2 px-4 py-3">
                    <Link
                      href={b.href}
                      className="min-w-0 flex-1 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ItemMeta item={b} now={now} />
                      <span className="mt-1 block text-sm break-words">{b.preview}</span>
                    </Link>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => unbookmark(b)}
                      aria-label={`${b.authorName}의 메시지 북마크 해제`}
                    >
                      <BookmarkIcon aria-hidden="true" className="fill-current" />
                      해제
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : tab === 'mentions' ? (
          <section aria-labelledby="inbox-mentions-h" className="space-y-3">
            <SectionHeading
              id="inbox-mentions-h"
              count={`읽지 않음 ${unread}건 · 전체 ${items.length}건`}
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={readAll}
                  disabled={pending || unread === 0}
                >
                  <CheckCheckIcon aria-hidden="true" />
                  모두 읽음
                </Button>
              }
            >
              받은 멘션
            </SectionHeading>
            {items.length === 0 ? (
              <EmptyState icon={AtSignIcon} as="p" title="아직 나를 부른 메시지가 없습니다." />
            ) : (
              <ul className={listClass}>
                {items.map(m => (
                  <li key={m.messageId}>
                    <MentionRow item={m} now={now} onOpen={openMention} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section aria-labelledby="inbox-feed-h" className="space-y-3">
            <SectionHeading
              id="inbox-feed-h"
              count={`새 활동 ${feed.filter(f => f.isNew).length}건 · 전체 ${feed.length}건`}
              actions={
                tab === 'all' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={readAll}
                    disabled={pending || unread === 0}
                  >
                    <CheckCheckIcon aria-hidden="true" />
                    멘션 모두 읽음
                  </Button>
                ) : undefined
              }
            >
              {tab === 'all' ? '전체 활동' : tab === 'replies' ? '스레드 답글' : '받은 반응'}
            </SectionHeading>
            {feed.length === 0 ? (
              <EmptyState
                icon={BellIcon}
                as="p"
                title={
                  tab === 'replies'
                    ? '내 스레드에 달린 새 답글이 없습니다.'
                    : tab === 'reactions'
                      ? '내 메시지에 달린 반응이 없습니다.'
                      : '아직 새 활동이 없습니다.'
                }
              />
            ) : (
              <ul className={listClass}>
                {feed.map(f => (
                  <li key={f.key}>
                    {f.mention ? (
                      <MentionRow item={f.mention} now={now} onOpen={openMention} />
                    ) : (
                      <ActivityRow item={f.activity!} now={now} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </PageBody>
    </div>
  )
}
