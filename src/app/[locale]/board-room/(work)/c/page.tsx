import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import { listBrowsableChannels } from '@work/lib/channels/queries'
import ChannelBrowser from '@work/components/chat/ChannelBrowser'

export const metadata: Metadata = { title: '채널 찾아보기' }

/** 채널 찾아보기·만들기 — 원본 `app/(app)/c/page.tsx`. 새 DM 은 채팅 섹션(`/board-room/chat?new=1`)이 맡는다. */
export default async function BoardWorkChannelsPage() {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const channels = await listBrowsableChannels(ctx, user.id)
  return (
    <ChannelBrowser
      channels={staff.role === 'guest' ? channels.filter(c => c.isMember) : channels}
      canCreate={staff.role !== 'guest'}
      canJoinPrivate={isWorkAdminRole(staff.role)}
    />
  )
}
