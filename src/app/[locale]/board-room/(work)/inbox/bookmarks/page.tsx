import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listMyBookmarks } from '@work/lib/inbox/queries'
import InboxView from '@work/components/inbox/InboxView'

export const metadata: Metadata = { title: '북마크' }

/** 내 북마크(북마크한 순) — 원본 `app/(app)/inbox/bookmarks/page.tsx` */
export default async function BoardWorkBookmarksPage() {
  const ctx = await requireWorkStaff()
  const bookmarks = await listMyBookmarks(ctx, ctx.user.id)
  return <InboxView tab="bookmarks" bookmarks={bookmarks} />
}
