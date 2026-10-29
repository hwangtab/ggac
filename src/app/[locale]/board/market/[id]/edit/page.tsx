import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import MarketGate from '@/components/market/MarketGate'
import MarketForm from '@/components/market/MarketForm'
import { resolveMarketViewer } from '@/lib/server/marketPage'
import { getMarketListing } from '@/db/queries/market'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'market' })
  return { title: t('form.editTitle'), robots: { index: false, follow: false } }
}

export default async function MarketEditPage({
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

  const viewer = await resolveMarketViewer(locale, `/board/market/${listingId}/edit`)
  if (viewer.kind !== 'member') {
    return <MarketGate title={t('gate.title')} body={t('gate.body')} backLabel={t('backToBoard')} />
  }

  const listing = await getMarketListing(listingId)
  // 남의 매물은 "없는 매물"과 같게 보인다. 수정 권한은 판매자 본인뿐이다
  // (`PATCH /api/market/[id]`와 같은 판정).
  if (!listing || listing.seller_id !== viewer.userId) notFound()

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">{t('form.editTitle')}</h1>
        <MarketForm
          initial={{
            id: listing.id,
            title: listing.title,
            description: listing.description,
            deal_type: listing.deal_type,
            item_category: listing.item_category,
            price: listing.price,
            condition: listing.condition,
            trade_method: listing.trade_method,
            region: listing.region,
            images: listing.images,
          }}
        />
      </div>
    </div>
  )
}
