import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import TimebankGate from '@/components/timebank/TimebankGate'
import TimebankListingForm from '@/components/timebank/TimebankListingForm'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { getTimebankListing } from '@/db/queries/timebankBoard'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('form.editTitle'), robots: { index: false, follow: false } }
}

export default async function TimebankEditPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const validation = validateUUID(id, '글 ID')
  if (!validation.isValid) notFound()
  const listingId = validation.sanitized

  const viewer = await resolveTimebankViewer(locale, `/board/timebank/${listingId}/edit`)
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

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

  const listing = await getTimebankListing(listingId)
  // 남의 글과 조합 업무 글은 "없는 글"과 같게 보인다 — `PATCH /api/timebank/listings/[id]`와
  // 같은 판정(글쓴이 본인만, 조합 업무는 관리자 화면 몫).
  if (!listing || listing.kind === 'coop_task' || listing.author_id !== viewer.userId) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">{t('form.editTitle')}</h1>
        <TimebankListingForm
          initial={{
            id: listing.id,
            kind: listing.kind,
            category: listing.category,
            title: listing.title,
            description: listing.description,
            estimated_minutes: listing.estimated_minutes,
          }}
        />
      </div>
    </div>
  )
}
