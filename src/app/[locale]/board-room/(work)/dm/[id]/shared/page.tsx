import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { getDmChannel } from '@work/lib/channels/queries'
import { uuidSchema } from '@work/lib/channels/schema'
import { loadSharedData } from '@work/lib/tabs/shared'
import SharedTab from '@work/components/chat/SharedTab'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: '공유됨' }

/**
 * DM·그룹의 "공유됨" 탭(파일 + 사진 + 링크) — 원본 `app/(app)/dm/[id]/shared/page.tsx`.
 * 내가 멤버가 아니면 404(관리자도 남의 DM은 못 본다 — 원본 can_read_channel 0037).
 * ggac 이식: 대화 탭 바 데이터는 2단계 탭(2b)이 채운다. `data-testid="board-work-files"`는 권한 E2E 표식이다.
 */
export default async function BoardWorkDmSharedPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const parsed = uuidSchema.safeParse((await params).id)
  if (!parsed.success) notFound()
  const ctx = await requireWorkStaff()
  const channel = await getDmChannel(ctx, parsed.data, ctx.user.id)
  if (!channel) notFound()

  const { peerId: _peerId, ...detail } = channel
  const data = await loadSharedData(ctx, channel.id)
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board-work-files">
      <SharedTab channel={detail} data={data} />
    </div>
  )
}
