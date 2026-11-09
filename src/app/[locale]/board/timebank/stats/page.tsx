import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import PageHero from '@/components/PageHero'
import TimebankGate from '@/components/timebank/TimebankGate'
import { formatTimebankMinutes } from '@/components/timebank/timebankFormat'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { participationStats } from '@/db/queries/timebankLedger'
import { publicStats } from '@/lib/timebank/format'
import { kstMonthKey, shiftMonthKey } from '@/lib/timebank/month'
import { TIMEBANK_DEFAULTS, getTimebankSettings } from '@/lib/timebank/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 고를 수 있는 달 — 지난 달부터 거꾸로 이만큼. 진행 중인 달은 넣지 않는다. */
const MONTHS_BACK = 6

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('stats.heading'), robots: { index: false, follow: false } }
}

interface StatsPageProps {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * 참여 현황(이용규칙 제17조③) — 조합원 전체에 공개하는 집계. `GET /api/timebank/stats`와
 * 같은 `publicStats`를 거친다: 사람 수·건수가 3 미만인 칸은 null("3명 미만")이다.
 *
 * **끝난 달만** 고를 수 있다. 진행 중인 달은 값이 날마다 바뀌어 두 번 본 차이로
 * 개별 거래가 비친다(API가 레이트리밋을 거는 이유). 끝난 달은 값이 고정이라 화면이
 * 직접 쿼리해도 그 차이 공격이 생기지 않는다.
 */
export default async function TimebankStatsPage({ params, searchParams }: StatsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const thisMonth = kstMonthKey(new Date())
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonthKey(thisMonth, -(i + 1)))
  const raw = (await searchParams).month
  const month = typeof raw === 'string' && months.includes(raw) ? raw : months[0]

  const viewer = await resolveTimebankViewer(locale, `/board/timebank/stats?month=${month}`)
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  let settings = { ...TIMEBANK_DEFAULTS }
  try {
    settings = await getTimebankSettings()
  } catch {
    // 집계에 쓰는 칸(soft_max·low_balance_flag)은 표시하지 않으므로 기본값으로 충분하다.
  }
  const stats = publicStats(await participationStats(month, settings))

  const count = (n: number | null) => (n === null ? t('stats.fewCount') : String(n))
  const people = (n: number | null) =>
    n === null ? t('stats.fewPeople') : t('stats.peopleValue', { count: n })
  const cards = [
    { key: 'exchangeCount', value: count(stats.exchange_count) },
    {
      key: 'exchangeMinutes',
      value:
        stats.exchange_minutes === null
          ? t('stats.fewCount')
          : formatTimebankMinutes(t, stats.exchange_minutes),
    },
    { key: 'participants', value: people(stats.participants) },
    { key: 'bidirectional', value: people(stats.bidirectional_participants) },
  ] as const

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <PageHero
        kicker={t('kicker')}
        titleLine1={t('stats.heading')}
        subtitle={t('stats.subtitle')}
      />
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-4">
          <Link href="/board/timebank" className="text-sm text-gray-600 hover:text-primary-600">
            {t('directory.back')}
          </Link>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t('stats.month')}>
          {months.map(m => (
            <Link
              key={m}
              href={{ pathname: '/board/timebank/stats', query: { month: m } }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                m === month
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'
              }`}
            >
              {m}
            </Link>
          ))}
        </nav>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="timebank-stats">
          {cards.map(card => (
            <div key={card.key} className="rounded-lg bg-white p-4 shadow-sm">
              <dt className="text-sm text-gray-500">{t(`stats.${card.key}`)}</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-800">{card.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-sm text-gray-500">{t('stats.privacyNote')}</p>
      </div>
    </div>
  )
}
