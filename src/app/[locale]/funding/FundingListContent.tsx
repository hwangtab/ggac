/**
 * 목록 마크업. 서버 컴포넌트다 — 상호작용이 없다.
 *
 * 카드가 수치를 어떻게 보이는지가 이 파일의 핵심이다. **후원이 하나도 없으면
 * 0원·0%·0건 대신 목표 금액만 적는다.** 첫 후원자가 될 사람에게 "아무도 하지
 * 않았다"를 먼저 보여 주면 후원할 이유가 줄어든다.
 */

import { getTranslations } from 'next-intl/server'

import OptimizedImage from '@/components/OptimizedImage'
import { Link } from '@/i18n/navigation'

import { computeDaysLeft, computePercent, formatAmount, hasBackers } from './format'
import type { CampaignSummary } from './types'

const OPEN_STATUSES = ['active'] as const

export default async function FundingListContent({
  campaigns,
  locale,
}: {
  campaigns: CampaignSummary[]
  locale: string
}) {
  const t = await getTranslations({ locale, namespace: 'funding' })
  const open = campaigns.filter(c => (OPEN_STATUSES as readonly string[]).includes(c.status))
  const closed = campaigns.filter(c => !(OPEN_STATUSES as readonly string[]).includes(c.status))

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">{t('list.heading')}</h1>
          <p className="mt-3 text-gray-600">{t('list.subtitle')}</p>
        </header>

        {open.length === 0 && closed.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-gray-900">{t('list.emptyTitle')}</p>
            <p className="mt-2 text-gray-600">{t('list.emptyBody')}</p>
            <Link href="/board" className="tw-btn-primary mt-6 inline-flex">
              {t('list.emptyCta')}
            </Link>
          </div>
        ) : null}

        {open.length > 0 ? (
          <section className="mb-12">
            <h2 className="mb-5 text-xl font-semibold text-gray-900">{t('list.openSection')}</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              {open.map(c => (
                <CampaignCard key={c.slug} campaign={c} locale={locale} t={t} />
              ))}
            </div>
          </section>
        ) : null}

        {closed.length > 0 ? (
          <section>
            <h2 className="mb-5 text-xl font-semibold text-gray-900">{t('list.closedSection')}</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              {closed.map(c => (
                <CampaignCard key={c.slug} campaign={c} locale={locale} t={t} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function CampaignCard({
  campaign,
  locale,
  t,
}: {
  campaign: CampaignSummary
  locale: string
  t: (key: string, values?: Record<string, unknown>) => string
}) {
  const percent = computePercent(campaign.progress.raised_amount, campaign.goal_amount)
  const days = campaign.status === 'active' ? computeDaysLeft(campaign.end_at) : null
  const showFigures = hasBackers(campaign.progress)

  return (
    <Link
      href={`/funding/${campaign.slug}`}
      // tailwind.config.js가 정의한 공용 인터랙티브 카드 유틸리티는 구현이
      // 잘못되어 있다(`@apply`로 group/peer 유틸리티를 적용하는 것을 Tailwind가
      // 금지한다 — 실제로 쓰이는 순간 빌드가 깨진다). 그래서 그 이름을 쓰지 않고
      // 직접 클래스를 쌓는다 — 예매 목록 카드의 hover 처리에 `group`만 더한다.
      className="group block cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-primary-400 hover:shadow-md"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-gray-100">
        {campaign.cover_image ? (
          <OptimizedImage
            src={campaign.cover_image}
            alt={campaign.title}
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            fallbackText={campaign.title}
          />
        ) : null}
      </div>
      <div className="p-5">
        <p className="text-xs font-medium text-primary-600">{campaign.category}</p>
        <h3 className="mt-1 line-clamp-2 text-lg font-semibold text-gray-900">{campaign.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm text-gray-600">{campaign.summary}</p>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary-600 transition-[width] duration-500"
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          {showFigures ? (
            <p className="mt-2 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">
                {t('progress.amount', {
                  amount: formatAmount(campaign.progress.raised_amount, locale),
                })}
              </span>
              {' · '}
              {t('list.percent', { percent })}
              {' · '}
              {t('progress.backers', { count: campaign.progress.backer_count })}
              {days === null
                ? ''
                : days === 0
                  ? ` · ${t('progress.lastDay')}`
                  : ` · ${t('progress.daysLeftValue', { days })}`}
            </p>
          ) : (
            // 아직 아무도 후원하지 않았다. 0원·0%·0건 대신 목표만 적는다.
            <p className="mt-2 text-sm text-gray-600">
              {t('list.goalOnly', { goal: formatAmount(campaign.goal_amount, locale) })}
              {days === null
                ? ''
                : days === 0
                  ? ` · ${t('progress.lastDay')}`
                  : ` · ${t('progress.daysLeftValue', { days })}`}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
