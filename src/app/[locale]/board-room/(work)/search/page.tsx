import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { consumeWorkSearch } from '@/lib/server/boardWorkRateLimit'
import { filterVisiblePeople, guestVisibleUserIds } from '@work/lib/staff/visibility'
import { parseSearchParams } from '@work/lib/search/params'
import { loadSearchFilters, searchAll, EMPTY_RESULT } from '@work/lib/search/search'
import { EmptyState, NoticeBanner, PageBody, PageHeader } from '@work/components/layout/page'
import SearchForm from '@work/components/search/SearchForm'
import SearchResults from '@work/components/search/SearchResults'

export const metadata: Metadata = {
  title: '검색',
}

// 쿠키 기반 세션 — 빌드 시 정적 생성·DB 호출을 하지 않는다.
export const dynamic = 'force-dynamic'

/**
 * 전체 검색 — 원본 kosmart-work `app/(app)/search/page.tsx`(설계 §8-3). 메시지 본문·파일 이름·문서 내용·메모·사람.
 * 원본은 RLS 가 읽을 수 없는 채널을 걸렀다 — 여기서는 `searchAll`이 가드 결과로 읽기 범위를 계산해 모든 쿼리의
 * WHERE 에 넣는다(초대받지 않은 비공개 채널·남의 DM 은 결과·스니펫 어디에도 나오지 않는다 — authz E2E 가 짝으로 본다).
 *
 * ggac 이식: 검색어(또는 작성자)가 있을 때마다 사용자 단위 레이트 리밋(분당 30)을 센다. 넘으면 결과 대신 안내를 낸다.
 * `data-testid="board-work-search"`는 권한 E2E 표식이다.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await requireWorkStaff()
  const { staff } = supabase
  const params = parseSearchParams(await searchParams)
  const searching = Boolean(params.q || params.author)
  const limited = searching ? await consumeWorkSearch(supabase.user.id) : { ok: true }

  const [allFilters, found, visible] = await Promise.all([
    loadSearchFilters(supabase),
    searching && limited.ok ? searchAll(supabase, params) : Promise.resolve(EMPTY_RESULT),
    guestVisibleUserIds(supabase, staff),
  ])
  // 게스트는 자기 채널 공동 멤버 밖의 사람을 찾을 수 없다(QA #6). 메시지·파일은 읽기 범위가 이미 거른다.
  const filters = {
    ...allFilters,
    people: filterVisiblePeople(allFilters.people, visible, p => p.user_id),
  }
  const result = { ...found, people: filterVisiblePeople(found.people, visible, p => p.userId) }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board-work-search">
      <PageHeader title="검색" hideOnMobile />
      <PageBody>
        <SearchForm params={params} channels={filters.channels} people={filters.people} />
        {searching && !limited.ok ? (
          <NoticeBanner role="status">
            {limited.message ?? '검색 요청이 너무 많습니다.'}
          </NoticeBanner>
        ) : searching ? (
          <SearchResults result={result} />
        ) : (
          <EmptyState
            compact
            className="py-12"
            title="검색어를 입력하면 메시지 본문, 파일 이름, 문서 내용, 사람을 한꺼번에 찾습니다."
          />
        )}
      </PageBody>
    </div>
  )
}
