import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import MarketGate from '@/components/market/MarketGate'
import MarketComments from '@/components/market/MarketComments'
import MarketOwnerControls from '@/components/market/MarketOwnerControls'
import { formatMarketPrice } from '@/components/market/marketFormat'
import { resolveMarketViewer } from '@/lib/server/marketPage'
import { getMarketListing, listMarketComments } from '@/db/queries/market'
import { MARKET_STATUS_STYLES } from '@/constants/market'
import { validateUUID } from '@/utils/validation'
import { intlLocale } from '@/utils/intlLocale'
import { SEOUL_TIME_ZONE } from '@/utils/date'

// 게시글 상세(`/board/[id]`)와 달리 ISR을 쓰지 않는다 — 조합원 전용 화면을
// 캐시하면 그 HTML이 비회원에게도 나간다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 제목을 메타데이터에 싣지 않는다. 메타데이터는 화면 판정과 따로 돌아서,
// 여기서 매물을 읽으면 비회원의 <title>에 매물 이름이 찍힌다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'market' })
  return { title: t('heading'), robots: { index: false, follow: false } }
}

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)
  const t = await getTranslations('market')

  const validation = validateUUID(id, '매물 ID')
  if (!validation.isValid) notFound()
  const listingId = validation.sanitized

  const viewer = await resolveMarketViewer(locale, `/board/market/${listingId}`)
  if (viewer.kind !== 'member') {
    return <MarketGate title={t('gate.title')} body={t('gate.body')} backLabel={t('backToBoard')} />
  }

  const listing = await getMarketListing(listingId)
  if (!listing) notFound()
  const comments = await listMarketComments(listingId)

  const isSeller = listing.seller_id === viewer.userId
  const dateLocale = intlLocale(locale)

  const facts: Array<[string, string]> = [
    [listing.deal_type === 'buy' ? t('detail.buyer') : t('detail.seller'), listing.seller_name],
    [t('form.itemCategory'), t(`item.${listing.item_category}`)],
  ]
  if (listing.condition) facts.push([t('detail.condition'), t(`condition.${listing.condition}`)])
  if (listing.trade_method) {
    facts.push([t('detail.trade'), t(`trade.${listing.trade_method}`)])
  }
  if (listing.region) facts.push([t('detail.region'), listing.region])
  facts.push([
    t('detail.postedAt'),
    new Date(listing.created_at).toLocaleDateString(dateLocale, {
      ...SEOUL_TIME_ZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  ])

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Link href="/board/market" className="text-sm text-gray-600 hover:text-primary-600">
          {t('detail.backToList')}
        </Link>

        <article className="mt-4 rounded-lg bg-white p-6 shadow-sm">
          {listing.images.length > 0 && (
            <div className="-mx-6 -mt-6 mb-6 flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-t-lg bg-gray-100">
              {listing.images.map(url => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="max-h-[28rem] w-full flex-none snap-center object-contain"
                />
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center gap-2 text-sm">
            <span
              className={`rounded px-2 py-0.5 font-medium ${MARKET_STATUS_STYLES[listing.status]}`}
            >
              {t(`status.${listing.status}`)}
            </span>
            <span className="text-gray-500">{t(`deal.${listing.deal_type}`)}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{listing.title}</h1>
          <p className="mt-2 text-xl font-semibold text-gray-900">
            {formatMarketPrice(t, locale, listing)}
          </p>

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-gray-50 p-4 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 whitespace-pre-wrap break-words text-gray-700">
            {listing.description}
          </p>

          {(isSeller || viewer.isAdmin) && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <MarketOwnerControls
                listingId={listing.id}
                status={listing.status}
                isSeller={isSeller}
                canDelete={isSeller || viewer.isAdmin}
              />
            </div>
          )}

          <p className="mt-6 text-xs text-gray-500">{t('notice')}</p>
        </article>

        <MarketComments
          listingId={listing.id}
          sellerId={listing.seller_id}
          viewerId={viewer.userId}
          isAdmin={viewer.isAdmin}
          initialComments={comments}
        />
      </div>
    </div>
  )
}
