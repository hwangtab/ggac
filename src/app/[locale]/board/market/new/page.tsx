import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import MarketGate from '@/components/market/MarketGate'
import MarketForm from '@/components/market/MarketForm'
import { resolveMarketViewer } from '@/lib/server/marketPage'
import { isBoardEnabled } from '@/lib/features/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'market' })
  return { title: t('form.newTitle'), robots: { index: false, follow: false } }
}

export default async function MarketNewPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('market')

  const viewer = await resolveMarketViewer(locale, '/board/market/new')
  if (viewer.kind !== 'member') {
    return <MarketGate title={t('gate.title')} body={t('gate.body')} backLabel={t('backToBoard')} />
  }

  // 판정은 `POST /api/market`이 한다 — 여기는 다 쓰고 나서 503을 보지 않게 하는 안내다.
  if ((await isBoardEnabled()) === false) {
    return (
      <MarketGate
        title={t('boardOff.title')}
        body={t('boardOff.body')}
        backLabel={t('detail.backToList')}
        backHref="/board/market"
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">{t('form.newTitle')}</h1>
        <MarketForm />
      </div>
    </div>
  )
}
