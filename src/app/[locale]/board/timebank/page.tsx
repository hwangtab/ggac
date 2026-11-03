import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import PageHero from '@/components/PageHero'
import TimebankGate from '@/components/timebank/TimebankGate'
import {
  TIMEBANK_KIND_STYLES,
  TIMEBANK_PAGE_SIZE,
  TIMEBANK_STATUS_STYLES,
  formatTimebankMinutes,
} from '@/components/timebank/timebankFormat'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { isBoardEnabled } from '@/lib/features/settings'
import { parseListingQuery } from '@/lib/timebank/validate'
import { listTimebankListings } from '@/db/queries/timebankBoard'
import { TIMEBANK_CATEGORIES, TIMEBANK_LISTING_KINDS } from '@/constants/timebank'

// 조합원 전용이라 정적화하지 않는다(장터와 같은 이유 — 렌더된 HTML이 공용 캐시에
// 남으면 비회원에게 나간다).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('heading'), robots: { index: false, follow: false } }
}

interface TimebankPageProps {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toURLSearchParams(raw: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value)
  }
  return params
}

export default async function TimebankPage({ params, searchParams }: TimebankPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const rawParams = toURLSearchParams(await searchParams)
  const queryString = rawParams.toString()
  const viewer = await resolveTimebankViewer(
    locale,
    queryString ? `/board/timebank?${queryString}` : '/board/timebank'
  )
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  // 읽기는 꺼짐·미동의여도 연다(API `requireTimebankReader`와 같다). 쓰기 단추만
  // 참여 자격(`access === 'ok'`)에 따라 보인다. 게시판 새 글 스위치가 꺼졌으면 글쓰기
  // 화면(`new/page.tsx`)이 `boardOff` 게이트를 내므로 단추 대신 그 이유를 적는다.
  const canWrite = viewer.access === 'ok'
  const boardOff = canWrite && (await isBoardEnabled()) === false
  const query = parseListingQuery(rawParams)
  // 조합 업무 스위치(전체 + `coop_tasks_enabled`, 둘 다 `=== true`)가 꺼져 있으면 조합
  // 업무 탭을 숨기고 그 글도 목록에서 뺀다. `?kind=coop_task`로 들어와도 전체로 본다.
  const coopOn = viewer.coopTasksEnabled
  if (!coopOn && query.kind === 'coop_task') query.kind = undefined
  const visibleKinds = TIMEBANK_LISTING_KINDS.filter(kind => coopOn || kind !== 'coop_task')
  const { rows, hasNext } = await listTimebankListings({
    kind: query.kind,
    excludeKinds: coopOn ? undefined : ['coop_task'],
    category: query.category,
    status: query.status,
    authorId: query.mine ? viewer.userId : undefined,
    offset: (query.page - 1) * TIMEBANK_PAGE_SIZE,
    limit: TIMEBANK_PAGE_SIZE,
  })

  // 필터 링크는 나머지 조건을 유지한 채 한 칸만 바꾼다. 페이지는 항상 1로 돌린다.
  const current: Record<string, string> = {}
  if (query.kind) current.kind = query.kind
  if (query.category) current.category = query.category
  if (query.status) current.status = query.status
  if (query.mine) current.mine = '1'
  const hrefWith = (patch: Record<string, string | null>, page?: number) => {
    const next: Record<string, string> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    if (page && page > 1) next.page = String(page)
    return { pathname: '/board/timebank' as const, query: next }
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm border transition-colors ${
      active
        ? 'bg-primary-600 text-white border-primary-600'
        : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'
    }`
  const hideClosed = query.status === 'open'

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <PageHero kicker={t('kicker')} titleLine1={t('heading')} subtitle={t('subtitle')} />
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/board" className="text-sm text-gray-600 hover:text-primary-600">
            {t('backToBoard')}
          </Link>
          <div className="flex gap-2">
            <Link href={hrefWith({ mine: query.mine ? null : '1' })} className={chip(query.mine)}>
              {t('mine')}
            </Link>
            {canWrite && !boardOff && (
              <Link
                href="/board/timebank/new"
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
              >
                {t('write')}
              </Link>
            )}
            {boardOff && (
              <span
                data-testid="timebank-write-board-off"
                className="self-center text-sm text-gray-500"
              >
                {t('gate.boardOff.title')}
              </span>
            )}
          </div>
        </div>

        {viewer.access !== 'ok' && (
          <TimebankGate
            state={viewer.access}
            variant="banner"
            termsVersion={viewer.termsVersion}
            agreedVersion={viewer.agreedVersion}
            showAgreement
          />
        )}

        <p className="mb-6 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
          {t('notice')}
        </p>

        <nav className="mb-3 flex flex-wrap gap-2" aria-label={t('form.kind')}>
          <Link href={hrefWith({ kind: null })} className={chip(!query.kind)}>
            {t('tabs.all')}
          </Link>
          {visibleKinds.map(kind => (
            <Link key={kind} href={hrefWith({ kind })} className={chip(query.kind === kind)}>
              {t(`tabs.${kind}`)}
            </Link>
          ))}
        </nav>
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t('form.category')}>
          <Link href={hrefWith({ category: null })} className={chip(!query.category)}>
            {t('filters.all')}
          </Link>
          {TIMEBANK_CATEGORIES.map(category => (
            <Link
              key={category}
              href={hrefWith({ category })}
              className={chip(query.category === category)}
            >
              {t(`category.${category}`)}
            </Link>
          ))}
          <Link
            href={hrefWith({ status: hideClosed ? null : 'open' })}
            className={`${chip(hideClosed)} ml-auto`}
          >
            {hideClosed ? t('filters.showClosed') : t('filters.hideClosed')}
          </Link>
        </nav>

        {rows.length === 0 ? (
          <div className="py-16 text-center text-gray-500">{t('empty')}</div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {rows.map(listing => (
              <li key={listing.id}>
                <Link
                  href={`/board/timebank/${listing.id}`}
                  className={`block h-full rounded-lg bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
                    listing.status === 'closed' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${TIMEBANK_KIND_STYLES[listing.kind]}`}
                    >
                      {t(`kind.${listing.kind}`)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${TIMEBANK_STATUS_STYLES[listing.status]}`}
                    >
                      {t(`status.${listing.status}`)}
                    </span>
                    <span className="text-gray-500">{t(`category.${listing.category}`)}</span>
                  </div>
                  <h2 className="line-clamp-2 font-medium text-gray-800">{listing.title}</h2>
                  <p className="mt-2 text-xs text-gray-500">
                    {[
                      listing.author_name,
                      listing.estimated_minutes
                        ? formatTimebankMinutes(t, listing.estimated_minutes)
                        : null,
                      listing.kind === 'coop_task'
                        ? t('volunteerCount', { count: listing.volunteer_count })
                        : null,
                      t('commentCount', { count: listing.comment_count }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {(query.page > 1 || hasNext) && (
          <div className="mt-8 flex justify-center gap-4 text-sm">
            {query.page > 1 && (
              <Link href={hrefWith({}, query.page - 1)} className="text-primary-600">
                {t('pagination.prev')}
              </Link>
            )}
            {hasNext && (
              <Link href={hrefWith({}, query.page + 1)} className="text-primary-600">
                {t('pagination.next')}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
