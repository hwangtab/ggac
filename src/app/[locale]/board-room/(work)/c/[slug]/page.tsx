import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import { getChannelBySlug } from '@work/lib/channels/queries'
import { loadChannelViewData } from '@work/lib/channels/load-view'
import { SLUG_PATTERN } from '@work/lib/channels/schema'
import { threadIdFromSearch } from '@work/lib/messages/anchor'
import ChannelView from '@work/components/chat/ChannelView'

type Params = Promise<{ slug: string }>

function decodeSlug(raw: string): string | null {
  try {
    const slug = decodeURIComponent(raw).normalize('NFC')
    return SLUG_PATTERN.test(slug) ? slug : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = decodeSlug((await params).slug)
  return { title: slug ? `#${slug}` : '채널' }
}

/**
 * 공개·비공개 채널 — 원본 `app/(app)/c/[slug]/page.tsx`. 읽을 수 없거나(비공개 비멤버) 없으면 404 —
 * 존재 여부를 드러내지 않는다. 공개 채널은 멤버가 아니어도 읽기 전용으로 미리 볼 수 있다(원본 can_read_channel).
 *
 * ggac 이식: 대화 탭 바(`loadTabBarData`)는 2단계라 읽지 않는다. `rev`(폴링 시작 커서)를 화면에 넘긴다.
 * `data-testid="board-work-channel"`은 권한 E2E가 "본문이 그려졌다/안 그려졌다"를 보는 표식이다.
 */
export default async function BoardWorkChannelPage({
  params,
  searchParams,
}: {
  params: Params
  /** ?thread=<부모 id> — 멘션·답글 알림에서 스레드 답글로 들어올 때 그 스레드를 연다 */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const slug = decodeSlug((await params).slug)
  const threadId = threadIdFromSearch((await searchParams).thread)
  if (!slug) notFound()
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const channel = await getChannelBySlug(ctx, slug)
  if (!channel) notFound()
  const data = await loadChannelViewData(ctx, channel.id, user.id)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="board-work-channel"
      data-channel-id={channel.id}
    >
      <ChannelView
        key={`${channel.id}:${data.membership ? 'member' : 'preview'}`}
        channel={channel}
        membership={data.membership}
        me={{
          id: user.id,
          displayName: staff.display_name,
          isAdmin: isWorkAdminRole(staff.role),
          isGuest: staff.role === 'guest',
        }}
        staff={data.staff}
        members={data.members}
        initialPage={data.page}
        pinnedIds={data.pinnedIds}
        bookmarkedIds={data.bookmarkedIds}
        threadId={threadId}
        rev={data.rev}
      />
    </div>
  )
}
