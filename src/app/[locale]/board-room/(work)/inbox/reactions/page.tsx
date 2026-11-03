import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listMyActivity } from '@work/lib/inbox/queries'
import InboxView from '@work/components/inbox/InboxView'

export const metadata: Metadata = { title: '반응' }

/** 내 메시지에 남이 단 반응 — 원본 `app/(app)/inbox/reactions/page.tsx` */
export default async function BoardWorkReactionsPage() {
  const ctx = await requireWorkStaff()
  const activity = await listMyActivity(ctx)
  return <InboxView tab="reactions" activity={activity} />
}
