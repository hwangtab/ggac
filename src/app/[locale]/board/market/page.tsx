import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import PageHero from '@/components/PageHero'
import MarketGate from '@/components/market/MarketGate'
import { formatMarketPrice } from '@/components/market/marketFormat'
import { resolveMarketViewer } from '@/lib/server/marketPage'
import { parseMarketListQuery } from '@/lib/market/validate'
import { listMarketListings } from '@/db/queries/market'
import {
  MARKET_DEAL_TYPES,
  MARKET_ITEM_CATEGORIES,
  MARKET_PAGE_SIZE,
  MARKET_STATUS_STYLES,
} from '@/constants/market'

// 조합원 전용이라 정적화하지 않는다. 게시판 목록(`/board`)은 ISR이지만 여기서
// 같은 일을 하면 렌더된 HTML이 공용 캐시에 남아 비회원에게 나간다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'market' })
  return { title: t('heading'), robots: { index: false, follow: false } }
}

interface MarketPageProps {
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

export default async function MarketPage({ params, searchParams }: MarketPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('market')

  const rawParams = toURLSearchParams(await searchParams)
  const queryString = rawParams.toString()
  const viewer = await resolveMarketViewer(
    locale,
    queryString ? `/board/market?${queryString}` : '/board/market'
  )
  if (viewer.kind !== 'member') {
    return <MarketGate title={t('gate.title')} body={t('gate.body')} backLabel={t('backToBoard')} />
  }

  const query = parseMarketListQuery(rawParams)
  const mine = rawParams.get('mine') === '1'
  const { rows, hasNext } = await listMarketListings({
    hideDone: query.hideDone,
    dealType: query.dealType,
    itemCategory: query.itemCategory,
    sellerId: mine ? viewer.userId : undefined,
    offset: (query.page - 1) * MARKET_PAGE_SIZE,
    limit: MARKET_PAGE_SIZE,
  })

  // 필터 링크는 나머지 조건을 유지한 채 한 칸만 바꾼다. 페이지는 항상 1로 돌린다.
  const current: Record<string, string> = {}
  if (query.dealType) current.deal = query.dealType
  if (query.itemCategory) current.item = query.itemCategory
  if (query.hideDone) current.hideDone = '1'
  if (mine) current.mine = '1'
  const hrefWith = (patch: Record<string, string | null>, page?: number) => {
    const next: Record<string, string> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    if (page && page > 1) next.page = String(page)
    return { pathname: '/board/market' as const, query: next }
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm border transition-colors ${
      active
        ? 'bg-primary-600 text-white border-primary-600'
        : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'
    }`

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <PageHero kicker={t('kicker')} titleLine1={t('heading')} subtitle={t('subtitle')} />
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Link href="/board" className="text-sm text-gray-600 hover:text-primary-600">
            {t('backToBoard')}
          </Link>
          <div className="flex gap-2">
            <Link href={hrefWith({ mine: mine ? null : '1' })} className={chip(mine)}>
              {t('mine')}
            </Link>
            <Link
              href="/board/market/new"
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700"
            >
              {t('write')}
            </Link>
          </div>
        </div>

        <p className="mb-6 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
          {t('notice')}
        </p>

        <nav className="mb-3 flex flex-wrap gap-2" aria-label={t('form.dealType')}>
          <Link href={hrefWith({ deal: null })} className={chip(!query.dealType)}>
            {t('filters.all')}
          </Link>
          {MARKET_DEAL_TYPES.map(deal => (
            <Link key={deal} href={hrefWith({ deal })} className={chip(query.dealType === deal)}>
              {t(`deal.${deal}`)}
            </Link>
          ))}
        </nav>
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t('form.itemCategory')}>
          <Link href={hrefWith({ item: null })} className={chip(!query.itemCategory)}>
            {t('filters.all')}
          </Link>
          {MARKET_ITEM_CATEGORIES.map(item => (
            <Link
              key={item}
              href={hrefWith({ item })}
              className={chip(query.itemCategory === item)}
            >
              {t(`item.${item}`)}
            </Link>
          ))}
          <Link
            href={hrefWith({ hideDone: query.hideDone ? null : '1' })}
            className={`${chip(query.hideDone)} ml-auto`}
          >
            {query.hideDone ? t('filters.showDone') : t('filters.hideDone')}
          </Link>
        </nav>

        {rows.length === 0 ? (
          <div className="py-16 text-center text-gray-500">{t('empty')}</div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {rows.map(listing => (
              <li key={listing.id}>
                <Link
                  href={`/board/market/${listing.id}`}
                  className={`block overflow-hidden rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow ${
                    listing.status === 'done' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="aspect-square bg-gray-100">
                    {listing.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={listing.thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs">
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium ${MARKET_STATUS_STYLES[listing.status]}`}
                      >
                        {t(`status.${listing.status}`)}
                      </span>
                      <span className="text-gray-500">{t(`deal.${listing.deal_type}`)}</span>
                    </div>
                    <h2 className="line-clamp-2 font-medium text-gray-800">{listing.title}</h2>
                    <p className="mt-1 font-semibold text-gray-900">
                      {formatMarketPrice(t, locale, listing)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {[listing.region, t('commentCount', { count: listing.comment_count })]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
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
