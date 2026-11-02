import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import TimebankGate from '@/components/timebank/TimebankGate'
import TimebankListingForm from '@/components/timebank/TimebankListingForm'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { isBoardEnabled } from '@/lib/features/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('form.newTitle'), robots: { index: false, follow: false } }
}

export default async function TimebankNewPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const viewer = await resolveTimebankViewer(locale, '/board/timebank/new')
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  // 판정은 `POST /api/timebank/listings`가 한다 — 여기는 다 쓰고 나서 403을 보지
  // 않게 하는 안내다. 미동의·구판이면 이 자리에서 바로 동의할 수 있다.
  if (viewer.access !== 'ok') {
    return (
      <TimebankGate
        state={viewer.access}
        termsVersion={viewer.termsVersion}
        agreedVersion={viewer.agreedVersion}
        showAgreement
        backHref="/board/timebank"
      />
    )
  }

  if ((await isBoardEnabled()) === false) {
    return <TimebankGate state="boardOff" backHref="/board/timebank" />
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">{t('form.newTitle')}</h1>
        <TimebankListingForm />
      </div>
    </div>
  )
}
