'use client'

import { useEffect, useId, useMemo, useState, useTransition } from 'react'
import Link from '@work/lib/nav/link'
import { usePathname, useRouter } from '@work/lib/nav/navigation'
import { HashIcon, LockIcon, PlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import { EmptyState, PageBody, PageHeader, SectionHeading } from '@work/components/layout/page'
import { joinChannel } from '@work/lib/channels/actions'
import type { BrowsableChannel } from '@work/lib/channels/types'
import { ChannelsPaneContent } from '@work/components/layout/ListPane'
import { activeChannelId } from '@work/components/layout/active-channel'
import { useShellData } from '@work/components/layout/shell-context'
import ChannelSortMenu from '@work/components/layout/ChannelSortMenu'
import { MOBILE_SORT_CLASS } from '@work/components/layout/pane-styles'
import CreateChannelDialog from './CreateChannelDialog'

/**
 * /c — 채널 찾아보기 · 참여 · 만들기(검색창 옆 "새 채널" → CreateChannelDialog, docs/15).
 * 새 1:1·그룹 채팅은 여기에 없다 — 채팅 섹션(`/chat?new=1`)에서 시작한다(옛 `/c#dm` 은 그리로 보낸다).
 * 모바일에선 맨 위에 "내 채널" 목록이 나온다(섹션 루트 = 목록 전체 화면, 설계 03 §2-4).
 * 게스트는 공개 채널 목록이 비고(RLS) 채널을 만들 수 없다.
 */
export default function ChannelBrowser({
  channels,
  canCreate,
  canJoinPrivate = false,
}: {
  channels: BrowsableChannel[]
  canCreate: boolean
  /** 업무툴 관리자 — 비공개 채널도 목록에 오고(0037) 스스로 참여할 수 있다 */
  canJoinPrivate?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  // 빈 검색 결과의 "'X' 채널 만들기"로 열 때 미리 채울 이름
  const [createName, setCreateName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const filterId = useId()
  const { channels: myChannels, channelSort = 'section', onChannelSortChange } = useShellData()
  const pathname = usePathname() ?? '/c'

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q
      ? channels.filter(
          c => c.name.toLowerCase().includes(q) || (c.topic ?? '').toLowerCase().includes(q)
        )
      : channels
  }, [channels, filter])

  // 옛 링크·북마크(/c#dm)는 새 채팅 화면으로 보낸다
  useEffect(() => {
    function redirectIfDm() {
      if (window.location.hash === '#dm') router.replace('/chat?new=1')
    }
    redirectIfDm()
    window.addEventListener('hashchange', redirectIfDm)
    return () => window.removeEventListener('hashchange', redirectIfDm)
  }, [router])

  function join(c: BrowsableChannel) {
    setError(null)
    start(async () => {
      const res = await joinChannel({ channelId: c.id })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/c/${encodeURIComponent(c.slug)}`)
      router.refresh()
    })
  }

  // 스크롤은 메인 영역 전체 폭의 바깥 상자 하나만(QA #24) — 가운데 정렬한 안쪽 열(max-w-3xl)에
  // overflow 를 두면 "채널 만들기" 폼을 펼쳤을 때 열 가장자리와 화면 가장자리에 스크롤바가 둘 생겼다.
  return (
    <>
      <PageHeader title="채널" hideOnMobile />
      <div
        data-testid="channel-browser-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <PageBody noScroll>
          {myChannels.length > 0 && (
            <section aria-labelledby={`${filterId}-mine`} className="space-y-3 lg:hidden">
              <SectionHeading
                id={`${filterId}-mine`}
                actions={
                  onChannelSortChange && (
                    <ChannelSortMenu
                      sort={channelSort}
                      onChange={onChannelSortChange}
                      className={MOBILE_SORT_CLASS}
                    />
                  )
                }
              >
                내 채널
              </SectionHeading>
              <ChannelsPaneContent
                channels={myChannels}
                activeId={activeChannelId(pathname, myChannels)}
              />
            </section>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <section aria-labelledby={`${filterId}-h`} className="space-y-3">
            <SectionHeading id={`${filterId}-h`}>채널 찾아보기</SectionHeading>
            <label htmlFor={filterId} className="sr-only">
              채널 이름이나 주제로 찾기
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={filterId}
                type="search"
                value={filter}
                placeholder="채널 이름이나 주제로 찾기"
                onChange={e => setFilter(e.target.value)}
              />
              {canCreate && (
                <Button
                  type="button"
                  className="shrink-0"
                  onClick={() => {
                    setCreateName('')
                    setCreateOpen(true)
                  }}
                >
                  <PlusIcon aria-hidden="true" />새 채널
                </Button>
              )}
            </div>
            {shown.length === 0 ? (
              <div className="space-y-3">
                <EmptyState
                  compact
                  title={
                    channels.length === 0
                      ? '아직 채널이 없습니다. 첫 채널을 만들어 보세요.'
                      : '찾는 채널이 없습니다.'
                  }
                />
                {canCreate && (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCreateName(filter.trim())
                        setCreateOpen(true)
                      }}
                    >
                      <PlusIcon aria-hidden="true" />
                      {filter.trim() ? `'${filter.trim()}' 채널 만들기` : '채널 만들기'}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y rounded-w-lg border">
                {shown.map(c => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    {c.kind === 'private' ? (
                      <LockIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <HashIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/c/${encodeURIComponent(c.slug)}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {c.name}
                        {c.kind === 'private' && <span className="sr-only"> (비공개)</span>}
                      </Link>
                      {c.topic && (
                        <p className="truncate text-xs text-muted-foreground">{c.topic}</p>
                      )}
                    </div>
                    {c.isMember ? (
                      <span className="text-xs text-muted-foreground">참여 중</span>
                    ) : (
                      (c.kind === 'public' || (c.kind === 'private' && canJoinPrivate)) &&
                      canCreate && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => join(c)}
                          aria-label={`${c.name} 채널 참여`}
                        >
                          참여
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </PageBody>
      </div>
      {canCreate && (
        <CreateChannelDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={createName}
        />
      )}
    </>
  )
}
