import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import { getChannelBySlug, getMyMembership } from '@work/lib/channels/queries'
import { SLUG_PATTERN } from '@work/lib/channels/schema'
import { parseChannelFilesSearch } from '@work/lib/files/channel-files'
import { loadChannelFiles } from '@work/lib/files/channel-files-load'
import { loadChannelLinks } from '@work/lib/tabs/links-load'
import ChannelLinksTab from '@work/components/files/ChannelLinksTab'
import ChannelFilesTab from '@work/components/files/ChannelFilesTab'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

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
  return { title: slug ? `#${slug} 파일` : '채널 파일' }
}

/**
 * 채널 "파일" 탭 — 원본 `app/(app)/c/[slug]/files/page.tsx`. 게시물 탭(/c/[slug])과 같은 가드·조회를 따른다 —
 * 읽을 수 없거나 없으면 404, 공개 채널은 멤버가 아니어도 열람(원본 can_read_channel). 폴더는 ?path= 로 공유한다.
 * `?view=links` 는 같은 탭 안의 하위 보기 "링크"(메시지에 붙은 주소 모음, work_message_links).
 *
 * ggac 이식: 대화 탭 바 데이터(`loadTabBarData`)는 2단계 탭(2b)이 채운다 — 지금은 기본 탭만. 문서 본문 검색 결과
 * (원본 documentHits)는 4단계다. `data-testid="board-work-files"`는 권한 E2E 표식이다.
 */
export default async function BoardWorkChannelFilesPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const slug = decodeSlug((await params).slug)
  if (!slug) notFound()
  const rawSearch = await searchParams
  const search = parseChannelFilesSearch(rawSearch)
  const view = Array.isArray(rawSearch.view) ? rawSearch.view[0] : rawSearch.view
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const channel = await getChannelBySlug(ctx, slug)
  if (!channel) notFound()

  if (view === 'links') {
    const links = await loadChannelLinks(ctx, channel)
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="board-work-files">
        <ChannelLinksTab channel={channel} links={links} />
      </div>
    )
  }

  const [data, membership] = await Promise.all([
    loadChannelFiles(ctx, channel.id, search),
    getMyMembership(ctx, channel.id, user.id),
  ])
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board-work-files">
      <ChannelFilesTab
        channel={channel}
        search={search}
        data={data}
        createDocActor={{
          isGuest: staff.role === 'guest',
          isMember: membership !== null,
          archived: channel.archived_at !== null,
          postPolicy: channel.postPolicy,
          isChannelOwner: membership?.role === 'owner',
          isAdmin: isWorkAdminRole(staff.role),
        }}
      />
    </div>
  )
}
