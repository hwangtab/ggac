import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { getDmChannel } from '@work/lib/channels/queries'
import { uuidSchema } from '@work/lib/channels/schema'
import ConversationTabPage from '@work/components/tabs/ConversationTabPage'

export const metadata: Metadata = { title: '대화 탭' }

/**
 * DM·그룹의 추가 탭 — 원본 `app/(app)/dm/[id]/t/[tabId]/page.tsx`.
 * 내가 멤버가 아니면 404(관리자도 남의 DM은 못 본다), 탭이 이 대화 소속이 아니어도 404.
 */
export default async function BoardWorkDmTabPage({
  params,
}: {
  params: Promise<{ id: string; tabId: string }>
}) {
  const { id, tabId } = await params
  const parsedId = uuidSchema.safeParse(id)
  const parsedTab = uuidSchema.safeParse(tabId)
  if (!parsedId.success || !parsedTab.success) notFound()
  const auth = await requireWorkStaff()
  const channel = await getDmChannel(auth, parsedId.data, auth.user.id)
  if (!channel) notFound()

  const { peerId: _peerId, ...detail } = channel
  return <ConversationTabPage channel={detail} tabId={parsedTab.data} auth={auth} />
}
