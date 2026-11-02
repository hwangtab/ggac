import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import TimebankGate from '@/components/timebank/TimebankGate'
import TimebankComments from '@/components/timebank/TimebankComments'
import TimebankOwnerControls from '@/components/timebank/TimebankOwnerControls'
import VolunteerButton from '@/components/timebank/VolunteerButton'
import {
  TIMEBANK_KIND_STYLES,
  TIMEBANK_STATUS_STYLES,
  formatTimebankMinutes,
} from '@/components/timebank/timebankFormat'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import {
  getTimebankListing,
  isVolunteering,
  listTimebankComments,
} from '@/db/queries/timebankBoard'
import { validateUUID } from '@/utils/validation'
import { intlLocale } from '@/utils/intlLocale'
import { SEOUL_TIME_ZONE } from '@/utils/date'

// 조합원 전용 화면은 캐시하지 않는다(장터 상세와 같은 이유).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 제목을 메타데이터에 싣지 않는다. 메타데이터는 화면 판정과 따로 돌아서,
// 여기서 글을 읽으면 비회원의 <title>에 글 제목이 찍힌다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('heading'), robots: { index: false, follow: false } }
}

export default async function TimebankDetailPage({
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

  const viewer = await resolveTimebankViewer(locale, `/board/timebank/${listingId}`)
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  const listing = await getTimebankListing(listingId)
  if (!listing) notFound()
  const isCoopTask = listing.kind === 'coop_task'
  const [comments, myVolunteered] = await Promise.all([
    listTimebankComments(listingId),
    isCoopTask ? isVolunteering(listingId, viewer.userId) : Promise.resolve(false),
  ])

  const canWrite = viewer.access === 'ok'
  const isAuthor = listing.author_id === viewer.userId
  const dateLocale = intlLocale(locale)

  const facts: Array<[string, string]> = [
    [t('detail.author'), listing.author_name],
    [t('form.category'), t(`category.${listing.category}`)],
    [t('detail.estimated'), formatTimebankMinutes(t, listing.estimated_minutes)],
  ]
  if (listing.task_date) facts.push([t('detail.taskDate'), listing.task_date])
  facts.push([
    t('detail.postedAt'),
    new Date(listing.created_at).toLocaleDateString(dateLocale, {
      ...SEOUL_TIME_ZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  ])

  // 조합 업무에 새로 손들 수 있는가(`POST …/volunteer`와 같은 조건). 참여 자격이
  // 없으면 위의 게이트가 이유를 말하므로 여기서는 이유를 따로 달지 않는다.
  const volunteerUnavailable: 'closed' | 'off' | null =
    listing.status !== 'open' ? 'closed' : !viewer.coopTasksEnabled ? 'off' : null
  const canVolunteer = canWrite && volunteerUnavailable === null

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Link href="/board/timebank" className="text-sm text-gray-600 hover:text-primary-600">
          {t('detail.backToList')}
        </Link>

        {viewer.access !== 'ok' && (
          <div className="mt-4">
            <TimebankGate
              state={viewer.access}
              variant="banner"
              termsVersion={viewer.termsVersion}
              agreedVersion={viewer.agreedVersion}
            />
          </div>
        )}

        <article className="mt-4 rounded-lg bg-white p-6 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded px-2 py-0.5 font-medium ${TIMEBANK_KIND_STYLES[listing.kind]}`}
            >
              {t(`kind.${listing.kind}`)}
            </span>
            <span
              className={`rounded px-2 py-0.5 font-medium ${TIMEBANK_STATUS_STYLES[listing.status]}`}
            >
              {t(`status.${listing.status}`)}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{listing.title}</h1>

          {isCoopTask && (
            <div
              data-testid="timebank-coop-notice"
              className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900"
            >
              <p className="font-semibold">{t('detail.coopNotice')}</p>
              <p className="mt-1">{t('detail.coopNoticeDetail')}</p>
            </div>
          )}

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

          {isCoopTask && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <VolunteerButton
                listingId={listing.id}
                initialVolunteered={myVolunteered}
                initialCount={listing.volunteer_count}
                canVolunteer={canVolunteer}
                unavailableReason={canWrite ? volunteerUnavailable : null}
              />
            </div>
          )}

          {!isCoopTask && (isAuthor || viewer.isAdmin) && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <TimebankOwnerControls
                listingId={listing.id}
                status={listing.status}
                isAuthor={isAuthor}
                canWrite={canWrite}
                canDelete={isAuthor || viewer.isAdmin}
              />
            </div>
          )}

          {!isCoopTask && <p className="mt-6 text-xs text-gray-500">{t('notice')}</p>}
        </article>

        <TimebankComments
          listingId={listing.id}
          authorId={listing.author_id}
          viewerId={viewer.userId}
          isAdmin={viewer.isAdmin}
          canWrite={canWrite}
          initialComments={comments}
        />
      </div>
    </div>
  )
}
