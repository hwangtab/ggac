/**
 * 공연 상세 + 예매.
 *
 * **서버 컴포넌트다.** 공연 정보(제목·소개·회차·안내)는 첫 HTML에 담겨야
 * 공유 미리보기와 검색 색인이 산다. 상호작용이 필요한 부분(회차·매수 선택,
 * 예매 폼, 결제창)만 `TicketPurchaseForm`으로 내려간다.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { FiMapPin } from 'react-icons/fi'

import OptimizedImage from '@/components/OptimizedImage'
import { getPerformanceDetail } from '@/db/queries/ticketing'
import { isPaymentEnabled } from '@/lib/payments/toss/config'
import { createLogger } from '@/utils/logger'
import { toSafeHttpUrl } from '@/utils/safeUrl'
import { getLocaleAlternates, getOgLocale, getSiteUrl } from '@/utils/site'
import {
  combineStructuredData,
  generateBreadcrumbStructuredData,
  generateEventStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

import TicketPurchaseForm from './TicketPurchaseForm'
import type { PerformanceDetail } from '../types'

const log = createLogger('tickets/detail')

// 재고는 실시간으로 변한다. 60초 ISR로 본문·회차를 캐시하되, 잔여 좌석은
// `TicketPurchaseForm`이 화면에 들어온 시점에 API로 한 번 덮어쓴다. 초과
// 판매를 막는 진짜 경계는 선점 트랜잭션이므로 이 캐시가 표를 더 팔지는 않는다.
export const revalidate = 60

const OG_IMAGE = 'https://ggac.kr/images/logo/gac_og.webp'

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

/** 공개된(=draft가 아닌) 공연만 돌려준다. */
async function loadPerformance(slug: string): Promise<PerformanceDetail | null> {
  try {
    const detail = (await getPerformanceDetail(slug)) as unknown as PerformanceDetail | null
    if (!detail || detail.status === 'draft') return null
    return detail
  } catch (error) {
    log.error('공연 상세 조회 실패', { slug, error })
    return null
  }
}

/** OG 이미지로 쓸 수 있는 절대 https URL인가. */
function toAbsoluteImage(value: string | null | undefined): string {
  if (!value) return OG_IMAGE
  const safe = toSafeHttpUrl(value)
  if (safe?.startsWith('https://')) return safe
  if (value.startsWith('/')) return `${getSiteUrl().replace(/\/$/, '')}${value}`
  return OG_IMAGE
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // 크롤러에는 어떤 경우에도 유효한 메타데이터를 준다 — 단계마다 따로 막는다.
  let locale = 'ko'
  try {
    const resolved = await params
    locale = resolved?.locale ?? 'ko'
    const t = await getTranslations({ locale, namespace: 'tickets' })
    const isEn = locale === 'en'
    const siteName = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
    const base = getSiteUrl()

    if (!resolved?.slug) {
      return { title: t('meta.listTitle'), description: t('meta.listDescription') }
    }

    const performance = await loadPerformance(resolved.slug)
    if (!performance) {
      return {
        title: t('meta.notFoundTitle'),
        description: t('meta.notFoundDescription'),
        robots: { index: false, follow: true },
      }
    }

    const description =
      performance.summary?.trim() ||
      t('meta.detailDescription', { title: performance.title, venue: performance.venue ?? '' })
    const image = toAbsoluteImage(performance.poster_image)
    const path = `/tickets/${performance.slug}`

    return {
      title: performance.title,
      description,
      alternates: getLocaleAlternates(path, locale),
      openGraph: {
        title: `${performance.title} | ${siteName}`,
        description,
        url: isEn ? `${base}/en${path}` : `${base}${path}`,
        siteName,
        images: [{ url: image, width: 1200, height: 630, alt: performance.title }],
        locale: getOgLocale(locale),
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${performance.title} | ${siteName}`,
        description,
        images: [image],
      },
    }
  } catch (error) {
    log.error('공연 메타데이터 생성 실패', { error })
    return {
      title: locale === 'en' ? 'Tickets' : '공연 예매',
      description:
        locale === 'en'
          ? 'Book tickets for performances by Gyeonggi Art Collective.'
          : '경기아트콜렉티브가 기획한 공연을 예매하실 수 있습니다.',
    }
  }
}

export default async function PerformanceDetailPage({ params }: PageProps) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const performance = await loadPerformance(slug)
  if (!performance) notFound()

  const t = await getTranslations({ locale, namespace: 'tickets' })
  const base = getSiteUrl()
  const eventUrl = `${base}${locale === 'en' ? '/en' : ''}/tickets/${performance.slug}`

  // 아직 남은 회차 중 가장 이른 것을 공연일로 삼는다. 없으면 마지막 회차.
  const upcoming = performance.shows.find(show => !show.is_past)
  const eventDate = (upcoming ?? performance.shows[performance.shows.length - 1])?.starts_at
  const hasSeats = performance.shows.some(show => !show.is_past && show.remaining_seats > 0)

  // 헬퍼는 프로젝트용이라 `url`을 `/projects/{slug}`로 굳힌다. 예매 페이지는
  // 주소가 다르므로 생성 뒤 덮어쓴다(헬퍼는 다른 화면도 쓰므로 건드리지 않는다).
  const eventSchema = {
    ...(generateEventStructuredData({
      title: performance.title,
      description: performance.summary || performance.description || performance.title,
      slug: performance.slug,
      publishedDate: eventDate ?? new Date().toISOString(),
      eventDate,
      venue: performance.venue ? { name: performance.venue } : undefined,
      coverImage: performance.poster_image,
      category: '공연·전시',
      ticketing: performance.ticket_types.map(type => ({
        platform: 'GGAC',
        url: eventUrl,
        available: hasSeats,
        price: String(type.price),
      })),
    }) as Record<string, unknown>),
    url: eventUrl,
  }

  const jsonLd = combineStructuredData([
    eventSchema,
    generateBreadcrumbStructuredData([
      { name: '홈', url: base },
      { name: '공연 예매', url: `${base}/tickets` },
      { name: performance.title, url: `${base}/tickets/${performance.slug}` },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">{performance.title}</h1>
            {performance.summary && <p className="mt-2 text-gray-600">{performance.summary}</p>}
            {performance.venue && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
                <FiMapPin className="h-4 w-4" aria-hidden />
                {performance.venue}
              </p>
            )}
          </header>

          {performance.poster_image && (
            <div className="relative mb-8 aspect-[3/4] w-full max-w-sm overflow-hidden rounded-lg border border-gray-200 bg-white">
              <OptimizedImage
                src={performance.poster_image}
                alt={t('list.posterAlt', { title: performance.title })}
                fill
                priority
                sizes="(max-width: 640px) 100vw, 384px"
                className="h-full w-full object-cover"
              />
            </div>
          )}

          {performance.description && (
            <section className="mb-8 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
              {performance.description}
            </section>
          )}

          <TicketPurchaseForm
            performance={performance}
            paymentEnabled={isPaymentEnabled()}
            locale={locale}
          />

          {performance.notice_text && (
            <section className="mt-8 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
              <h2 className="mb-2 font-semibold text-gray-900">{t('detail.noticeHeading')}</h2>
              {performance.notice_text}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
