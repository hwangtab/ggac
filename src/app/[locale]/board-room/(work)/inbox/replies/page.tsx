import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listMyActivity } from '@work/lib/inbox/queries'
import InboxView from '@work/components/inbox/InboxView'

export const metadata: Metadata = { title: '답글' }

/** 내가 시작했거나 답글을 단 스레드에 남이 단 답글 — 원본 `app/(app)/inbox/replies/page.tsx` */
export default async function BoardWorkRepliesPage() {
  const ctx = await requireWorkStaff()
  const activity = await listMyActivity(ctx)
  return <InboxView tab="replies" activity={activity} />
}
