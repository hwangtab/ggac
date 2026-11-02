import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { getChannelBySlug } from '@work/lib/channels/queries'
import { SLUG_PATTERN, uuidSchema } from '@work/lib/channels/schema'
import ConversationTabPage from '@work/components/tabs/ConversationTabPage'

type Params = Promise<{ slug: string; tabId: string }>

function decodeSlug(raw: string): string | null {
  try {
    const slug = decodeURIComponent(raw).normalize('NFC')
    return SLUG_PATTERN.test(slug) ? slug : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = decodeSlug((await params).slug)
  return { title: slug ? `#${slug} 탭` : '채널 탭' }
}

/**
 * 채널의 추가 탭(웹사이트·메모·할 일) — 원본 `app/(app)/c/[slug]/t/[tabId]/page.tsx`.
 * 게시물 탭(/c/[slug])과 같은 가드·조회를 따른다 — 읽을 수 없거나 없으면 404, 탭이 이 채널 소속이 아니어도 404.
 */
export default async function BoardWorkChannelTabPage({ params }: { params: Params }) {
  const { slug: rawSlug, tabId: rawTabId } = await params
  const slug = decodeSlug(rawSlug)
  const tabId = uuidSchema.safeParse(rawTabId)
  if (!slug || !tabId.success) notFound()
  const auth = await requireWorkStaff()
  const channel = await getChannelBySlug(auth, slug)
  if (!channel) notFound()

  return <ConversationTabPage channel={channel} tabId={tabId.data} auth={auth} />
}
