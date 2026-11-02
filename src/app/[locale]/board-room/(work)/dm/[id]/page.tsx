import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { getDmChannel } from '@work/lib/channels/queries'
import { loadChannelViewData } from '@work/lib/channels/load-view'
import { ChannelPreview } from '../../_components/ChannelPreview'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DM·그룹 화면 자리(1단계 서버 쪽만) — 원본 `app/(app)/dm/[id]/page.tsx`의 로더 흐름:
 * 가드 → `getDmChannel`(멤버가 아니면 null → notFound; 관리자도 남의 DM은 못 본다) → `loadChannelViewData`.
 */
export default async function BoardWorkDmPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkStaff()
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()
  const channel = await getDmChannel(ctx, id, ctx.user.id)
  if (!channel) notFound()
  const view = await loadChannelViewData(ctx, channel.id, ctx.user.id)
  return <ChannelPreview title={channel.name} channelId={channel.id} view={view} />
}
