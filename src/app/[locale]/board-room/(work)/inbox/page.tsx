import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listMyActivity, listMyMentions } from '@work/lib/inbox/queries'
import InboxView from '@work/components/inbox/InboxView'

export const metadata: Metadata = { title: '활동' }

/** 활동 전체 — 원본 `app/(app)/inbox/page.tsx`: 멘션 + 내 스레드의 새 답글 + 내 메시지에 달린 반응 */
export default async function BoardWorkInboxPage() {
  const ctx = await requireWorkStaff()
  const [mentions, activity] = await Promise.all([
    listMyMentions(ctx, ctx.user.id),
    listMyActivity(ctx),
  ])
  return <InboxView tab="all" mentions={mentions} activity={activity} />
}
