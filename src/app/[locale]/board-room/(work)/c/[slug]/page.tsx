import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { getChannelBySlug } from '@work/lib/channels/queries'
import { loadChannelViewData } from '@work/lib/channels/load-view'
import { ChannelPreview } from '../../_components/ChannelPreview'

/**
 * 채널 화면 자리(1단계 서버 쪽만) — 원본 `app/(app)/c/[slug]/page.tsx`의 로더 흐름 그대로:
 * 가드 → `getChannelBySlug`(읽을 수 없으면 null → notFound) → `loadChannelViewData`.
 * 화면(ChannelView)은 UI 이식 단계에서 원본 컴포넌트로 바꾼다. 지금은 권한 E2E가 볼 최소한만 그린다.
 */
export default async function BoardWorkChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const ctx = await requireWorkStaff()
  const { slug } = await params
  const channel = await getChannelBySlug(ctx, decodeURIComponent(slug))
  if (!channel) notFound()
  const view = await loadChannelViewData(ctx, channel.id, ctx.user.id)
  return <ChannelPreview title={`#${channel.name}`} channelId={channel.id} view={view} />
}
