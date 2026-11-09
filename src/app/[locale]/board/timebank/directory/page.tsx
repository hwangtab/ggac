import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import PageHero from '@/components/PageHero'
import TimebankGate from '@/components/timebank/TimebankGate'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { listDirectory } from '@/db/queries/timebankProfiles'
import { TIMEBANK_CATEGORIES, type TimebankCategory } from '@/constants/timebank'

// 참여자끼리만 보는 명단이라 정적화하지 않는다(게시판 목록과 같은 이유).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('directory.heading'), robots: { index: false, follow: false } }
}

interface DirectoryPageProps {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * 재능 디렉터리(이용규칙 제17조②) — 본인이 공개를 고른 참여자의 재능 프로필.
 *
 * 경계는 `GET /api/timebank/directory`의 `requireTimebankPeer`와 같다: 승인·활성
 * 조합원 중 **현재 판에 동의한 사람**만 본다(제17조① "참여자끼리"). 꺼져 있어도
 * 동의자는 본다. 쿼리(`listDirectory`)가 공개·현재 판 동의·자격을 다시 거른다.
 */
export default async function TimebankDirectoryPage({ params, searchParams }: DirectoryPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const rawCategory = (await searchParams).category
  const category = TIMEBANK_CATEGORIES.includes(rawCategory as TimebankCategory)
    ? (rawCategory as TimebankCategory)
    : undefined

  const viewer = await resolveTimebankViewer(
    locale,
    category ? `/board/timebank/directory?category=${category}` : '/board/timebank/directory'
  )
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  // `classifyTimebankAccess`의 peer 모드와 같은 판정: 현재 판에 동의했는가.
  const isPeer = viewer.agreedVersion !== null && viewer.agreedVersion === viewer.termsVersion
  const rows = isPeer ? await listDirectory(viewer.termsVersion) : []
  const shown = category ? rows.filter(r => r.categories.includes(category)) : rows

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm border transition-colors ${
      active
        ? 'bg-primary-600 text-white border-primary-600'
        : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'
    }`
  const hrefFor = (next?: TimebankCategory) => ({
    pathname: '/board/timebank/directory' as const,
    query: next ? { category: next } : {},
  })

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <PageHero
        kicker={t('kicker')}
        titleLine1={t('directory.heading')}
        subtitle={t('directory.subtitle')}
      />
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/board/timebank" className="text-sm text-gray-600 hover:text-primary-600">
            {t('directory.back')}
          </Link>
          <Link href="/mypage/timebank" className="text-sm text-primary-600 hover:underline">
            {t('directory.editMine')}
          </Link>
        </div>

        {!isPeer ? (
          <TimebankGate
            state={viewer.access === 'ok' ? 'not_agreed' : viewer.access}
            variant="banner"
            termsVersion={viewer.termsVersion}
            agreedVersion={viewer.agreedVersion}
            showAgreement
          />
        ) : (
          <>
            <nav className="mb-6 flex flex-wrap gap-2" aria-label={t('form.category')}>
              <Link href={hrefFor()} className={chip(!category)}>
                {t('filters.all')}
              </Link>
              {TIMEBANK_CATEGORIES.map(c => (
                <Link key={c} href={hrefFor(c)} className={chip(category === c)}>
                  {t(`category.${c}`)}
                </Link>
              ))}
            </nav>

            {shown.length === 0 ? (
              <div
                className="py-16 text-center text-gray-500"
                data-testid="timebank-directory-empty"
              >
                {t('directory.empty')}
              </div>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2" data-testid="timebank-directory">
                {shown.map(person => (
                  <li
                    key={person.id}
                    data-testid="timebank-directory-row"
                    className="rounded-lg bg-white p-4 shadow-sm"
                  >
                    <h2 className="font-medium text-gray-800">{person.display_name}</h2>
                    {person.categories.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {person.categories.map(c => (
                          <span
                            key={c}
                            className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700"
                          >
                            {t(`category.${c}`)}
                          </span>
                        ))}
                      </div>
                    )}
                    {person.offers && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-gray-500">{t('directory.offers')}</p>
                        <p className="mt-0.5 whitespace-pre-line text-sm text-gray-700">
                          {person.offers}
                        </p>
                      </div>
                    )}
                    {person.needs && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-gray-500">{t('directory.needs')}</p>
                        <p className="mt-0.5 whitespace-pre-line text-sm text-gray-700">
                          {person.needs}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
