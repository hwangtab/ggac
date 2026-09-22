/**
 * 펀딩 상세 + 후원.
 *
 * **서버 컴포넌트다.** 프로젝트 소개·리워드·모인금액은 첫 HTML에 담겨야 공유
 * 미리보기와 검색 색인이 산다. 상호작용이 필요한 부분(리워드 선택·후원 폼·
 * 결제창)만 `PledgeForm`으로 내려간다. 예매 상세와 같은 구조다.
 */

import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import OptimizedImage from '@/components/OptimizedImage'
import PostContentRenderer from '@/components/PostContentRenderer'
import { getCampaignBySlug, listRewards, getCampaignProgress } from '@/db/queries/funding'
import { getRemainingQuantity, listPublicBackers } from '@/db/queries/fundingPledges'
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'
import { isPaymentEnabled } from '@/lib/payments/toss/config'
import { createLogger } from '@/utils/logger'
import { toSafeHttpUrl } from '@/utils/safeUrl'
import { getLocaleAlternates, getOgLocale, getSiteUrl } from '@/utils/site'
import {
  combineStructuredData,
  generateBreadcrumbStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

import { computeDaysLeft, computePercent, formatAmount, hasBackers } from '../format'
import type { CampaignDetail, PublicBacker, Reward } from '../types'
import PledgeForm from './PledgeForm'

const log = createLogger('funding/detail')

// 모인금액은 실시간으로 변한다. 60초 ISR로 본문·리워드를 캐시하되, 남은 수량은
// `PledgeForm`이 화면에 들어온 시점에 API로 한 번 덮어쓴다. 초과 판매를 막는
// 진짜 경계는 선점 트랜잭션이므로 이 캐시가 리워드를 더 팔지는 않는다.
export const revalidate = 60

const OG_IMAGE_PATH = '/images/logo/gac_og.webp'

/** `generateMetadata`와 본문이 한 번만 조회하도록 감싼다. */
const loadCampaign = cache(async (slug: string): Promise<CampaignDetail | null> => {
  const row = await getCampaignBySlug(slug)
  if (!row) return null
  if (!(PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(String(row.status))) return null

  const id = String(row.id)
  const [rewardRows, progress] = await Promise.all([listRewards(id), getCampaignProgress(id)])
  const rewards: Reward[] = await Promise.all(
    rewardRows.map(async r => ({
      id: String(r.id),
      title: String(r.title ?? ''),
      description: typeof r.description === 'string' ? r.description : null,
      amount: Number(r.amount ?? 0),
      total_quantity: r.total_quantity === null ? null : Number(r.total_quantity),
      remaining_quantity: await getRemainingQuantity(String(r.id)),
      requires_shipping: Boolean(r.requires_shipping),
      estimated_delivery: typeof r.estimated_delivery === 'string' ? r.estimated_delivery : null,
      image_url: typeof r.image_url === 'string' ? r.image_url : null,
    }))
  )

  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

  // 필드를 직접 골라 새 객체를 만든다 — owner_user_id·platform_fee_rate·
  // review_note가 서버 렌더 HTML로 새지 않게.
  return {
    id,
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    story: String(row.story ?? ''),
    cover_image: text(row.cover_image),
    og_image: text(row.og_image),
    category: String(row.category ?? '기타'),
    goal_amount: Number(row.goal_amount ?? 0),
    start_at: text(row.start_at),
    end_at: text(row.end_at),
    status: String(row.status ?? ''),
    rewards,
    progress: {
      raised_amount: Number(progress?.raised_amount ?? 0),
      backer_count: Number(progress?.backer_count ?? 0),
    },
  }
})

function toAbsoluteImage(value: string | null, site: string): string {
  const safe = value ? toSafeHttpUrl(value) : null
  return safe || `${site}${OG_IMAGE_PATH}`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  try {
    const campaign = await loadCampaign(slug)
    const t = await getTranslations({ locale, namespace: 'funding' })
    if (!campaign) {
      // 공개 상태가 아니거나 없는 캠페인. 색인시키지 않는다.
      return { title: t('meta.listTitle'), robots: { index: false, follow: true } }
    }
    const site = getSiteUrl()
    const path = `/funding/${campaign.slug}`
    const description = t('meta.detailDescription', {
      title: campaign.title,
      raised: formatAmount(campaign.progress.raised_amount, locale),
      goal: formatAmount(campaign.goal_amount, locale),
    })
    return {
      title: campaign.title,
      description,
      alternates: getLocaleAlternates(path, locale),
      openGraph: {
        title: campaign.title,
        description,
        url: `${site}${locale === 'ko' ? '' : `/${locale}`}${path}`,
        images: [{ url: toAbsoluteImage(campaign.og_image ?? campaign.cover_image, site) }],
        locale: getOgLocale(locale),
        type: 'article',
      },
      twitter: { card: 'summary_large_image', title: campaign.title, description },
    }
  } catch (error) {
    log.error('메타데이터 생성 실패:', error)
    return { title: '펀딩' }
  }
}

export default async function FundingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const campaign = await loadCampaign(slug)
  if (!campaign) notFound()

  const t = await getTranslations({ locale, namespace: 'funding' })
  const site = getSiteUrl()
  const backers: PublicBacker[] = (await listPublicBackers(campaign.id)).map(b => ({
    name: String(b.name ?? ''),
    message: typeof b.message === 'string' ? b.message : null,
    paid_at: String(b.paid_at ?? ''),
  }))

  const percent = computePercent(campaign.progress.raised_amount, campaign.goal_amount)
  const days = campaign.status === 'active' ? computeDaysLeft(campaign.end_at) : null
  const showFigures = hasBackers(campaign.progress)

  const jsonLd = combineStructuredData([
    generateBreadcrumbStructuredData([
      { name: t('list.heading'), url: `${site}/funding` },
      { name: campaign.title, url: `${site}/funding/${campaign.slug}` },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8">
            <p className="text-sm font-medium text-primary-600">{campaign.category}</p>
            <h1 className="mt-2 text-3xl font-bold text-gray-900">{campaign.title}</h1>
            <p className="mt-3 text-lg text-gray-600">{campaign.summary}</p>
          </header>

          {campaign.cover_image ? (
            <div className="relative mb-10 aspect-[16/9] w-full overflow-hidden rounded-xl bg-gray-100">
              <OptimizedImage
                src={campaign.cover_image}
                alt={campaign.title}
                fill
                priority
                sizes="(min-width: 1024px) 1024px, 100vw"
                className="object-cover"
                fallbackText={campaign.title}
              />
            </div>
          ) : null}

          <div className="grid gap-10 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <section className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 text-xl font-semibold text-gray-900">
                  {t('detail.storyHeading')}
                </h2>
                {/* story는 마크다운이다. 저장소가 게시글 본문에 이미 쓰는
                    렌더러를 그대로 쓴다 — sanitize-html 기반이라 SSR에서
                    jsdom 계열 sanitizer 사고를 되풀이하지 않는다. */}
                <PostContentRenderer content={campaign.story} contentFormat="markdown" />
              </section>

              <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 text-xl font-semibold text-gray-900">
                  {t('detail.backersHeading')}
                </h2>
                {backers.length === 0 ? (
                  <p className="text-gray-600">{t('detail.backersEmpty')}</p>
                ) : (
                  <ul className="space-y-4">
                    {backers.map((b, i) => (
                      <li
                        key={`${b.paid_at}-${i}`}
                        className="border-b border-gray-100 pb-4 last:border-0"
                      >
                        <p className="font-medium text-gray-900">{b.name}</p>
                        {b.message ? <p className="mt-1 text-gray-600">{b.message}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                {showFigures ? (
                  <>
                    <p className="text-sm text-gray-600">{t('progress.raised')}</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {t('progress.amount', {
                        amount: formatAmount(campaign.progress.raised_amount, locale),
                      })}
                    </p>
                  </>
                ) : (
                  <p className="text-lg font-semibold text-gray-900">
                    {t('progress.goal', { goal: formatAmount(campaign.goal_amount, locale) })}
                  </p>
                )}

                <div
                  role="progressbar"
                  aria-label={t('progress.label')}
                  aria-valuenow={Math.min(percent, 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-4 h-3 w-full overflow-hidden rounded-full bg-gray-200"
                >
                  <div
                    className="h-full rounded-full bg-primary-600 transition-[width] duration-500"
                    style={{ width: `${Math.min(percent, 100)}%` }}
                  />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-xs text-gray-500">{t('progress.percent')}</dt>
                    <dd className="font-semibold text-gray-900">
                      {t('progress.percentValue', { percent })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">
                      {t('progress.backers', { count: campaign.progress.backer_count })}
                    </dt>
                    <dd className="font-semibold text-gray-900">
                      {campaign.progress.backer_count}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('progress.daysLeft')}</dt>
                    <dd className="font-semibold text-gray-900">
                      {campaign.status !== 'active'
                        ? t('progress.closed')
                        : days === null
                          ? '—'
                          : days === 0
                            ? t('progress.lastDay')
                            : t('progress.daysLeftValue', { days })}
                    </dd>
                  </div>
                </dl>

                {campaign.status === 'active' ? (
                  <PledgeForm
                    campaign={campaign}
                    paymentEnabled={isPaymentEnabled()}
                    locale={locale}
                  />
                ) : (
                  <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                    {t('detail.closedNotice')}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}
