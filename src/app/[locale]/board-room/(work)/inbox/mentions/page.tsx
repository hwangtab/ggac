import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listMyMentions } from '@work/lib/inbox/queries'
import InboxView from '@work/components/inbox/InboxView'

export const metadata: Metadata = { title: '멘션' }

/** 받은 멘션(읽지 않음·읽음) — 원본 `app/(app)/inbox/mentions/page.tsx` */
export default async function BoardWorkMentionsPage() {
  const ctx = await requireWorkStaff()
  const mentions = await listMyMentions(ctx, ctx.user.id)
  return <InboxView tab="mentions" mentions={mentions} />
}
