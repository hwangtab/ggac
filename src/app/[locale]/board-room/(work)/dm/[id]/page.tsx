import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import { getDmChannel } from '@work/lib/channels/queries'
import { loadChannelViewData } from '@work/lib/channels/load-view'
import { uuidSchema } from '@work/lib/channels/schema'
import { threadIdFromSearch } from '@work/lib/messages/anchor'
import ChannelView from '@work/components/chat/ChannelView'

export const metadata: Metadata = { title: '다이렉트 메시지' }

/**
 * DM·그룹 — 원본 `app/(app)/dm/[id]/page.tsx`. 멤버가 아니면 404(관리자도 남의 DM은 못 본다).
 * ggac 이식: 대화 탭 바는 2단계라 읽지 않는다. `rev`(폴링 시작 커서)를 화면에 넘긴다.
 */
export default async function BoardWorkDmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const parsed = uuidSchema.safeParse((await params).id)
  const threadId = threadIdFromSearch((await searchParams).thread)
  if (!parsed.success) notFound()
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const channel = await getDmChannel(ctx, parsed.data, user.id)
  if (!channel) notFound()
  const data = await loadChannelViewData(ctx, channel.id, user.id)
  if (!data.membership) notFound()

  const { peerId, ...detail } = channel
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="board-work-channel"
      data-channel-id={channel.id}
    >
      <ChannelView
        key={channel.id}
        channel={detail}
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
        peerId={peerId === user.id ? null : peerId}
        threadId={threadId}
        rev={data.rev}
      />
    </div>
  )
}
