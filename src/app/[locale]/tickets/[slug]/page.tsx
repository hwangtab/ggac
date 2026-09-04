/**
 * 공연 상세 + 예매.
 *
 * **서버 컴포넌트다.** 공연 정보(제목·소개·회차·안내)는 첫 HTML에 담겨야
 * 공유 미리보기와 검색 색인이 산다. 상호작용이 필요한 부분(회차·매수 선택,
 * 예매 폼, 결제창)만 `TicketPurchaseForm`으로 내려간다.
 */

import { cache } from 'react'
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
import type { PerformanceDetail, Show, TicketType } from '../types'

const log = createLogger('tickets/detail')

// 재고는 실시간으로 변한다. 60초 ISR로 본문·회차를 캐시하되, 잔여 좌석은
// `TicketPurchaseForm`이 화면에 들어온 시점에 API로 한 번 덮어쓴다. 초과
// 판매를 막는 진짜 경계는 선점 트랜잭션이므로 이 캐시가 표를 더 팔지는 않는다.
export const revalidate = 60

// 운영 도메인을 문자열로 박지 않는다 — 정본은 `getSiteUrl()`이고, 프리뷰
// 배포에서는 그 배포의 호스트를 써야 미리보기가 실제로 뜬다. `getSiteUrl()`은
// 끝 슬래시를 떼고 돌려주므로 `${base}/...`로 이으면 된다.
const OG_IMAGE_PATH = '/images/logo/gac_og.webp'

function defaultOgImage(): string {
  return `${getSiteUrl()}${OG_IMAGE_PATH}`
}

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

type RawRow = Record<string, unknown>

/** 빈 문자열은 없는 값으로 본다(화면이 `null` 검사로 분기한다). */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * DB 행에서 **화면이 실제로 쓰는 필드만** 골라 새 객체를 만든다.
 *
 * `getPerformanceDetail`은 `toSnakeCase`로 키만 바꾼 행 전체를 돌려준다 —
 * 그대로 넘기면 `created_by`(공연을 만든 관리자 UUID)와 회차 `capacity`(정원),
 * 내부 타임스탬프가 서버 렌더 HTML의 직렬화 페이로드에 박혀 공개·색인된다.
 * 타입 단언(`as unknown as`)은 런타임 필터가 아니므로 여기서 직접 고른다.
 */
function toShow(row: RawRow): Show {
  return {
    id: String(row.id ?? ''),
    starts_at: String(row.starts_at ?? ''),
    remaining_seats: Number(row.remaining_seats ?? 0),
    is_past: Boolean(row.is_past),
  }
}

function toTicketType(row: RawRow): TicketType {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    price: Number(row.price ?? 0),
    max_per_order: Number(row.max_per_order ?? 1),
    members_only: Boolean(row.members_only),
  }
}

function toPerformanceDetail(row: RawRow): PerformanceDetail {
  const shows = Array.isArray(row.shows) ? (row.shows as RawRow[]) : []
  const types = Array.isArray(row.ticket_types) ? (row.ticket_types as RawRow[]) : []
  return {
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    summary: asText(row.summary),
    description: asText(row.description),
    venue: asText(row.venue),
    poster_image: asText(row.poster_image),
    notice_text: asText(row.notice_text),
    status: String(row.status ?? 'draft'),
    shows: shows.map(toShow),
    ticket_types: types.map(toTicketType),
  }
}

/**
 * 공개된(=draft가 아닌) 공연만 돌려준다.
 *
 * React `cache()`로 감싼다. `generateMetadata`와 본문이 같은 요청에서 각각
 * 이 함수를 부르는데, 감싸지 않으면 공연 상세 조회가 요청마다 두 벌 돈다 —
 * 회차별 재고 집계까지 두 번이라, 애써 없앤 N+1이 다른 모양으로 돌아온다.
 */
const loadPerformance = cache(async (slug: string): Promise<PerformanceDetail | null> => {
  try {
    const row = await getPerformanceDetail(slug)
    if (!row || row.status === 'draft') return null
    return toPerformanceDetail(row)
  } catch (error) {
    log.error('공연 상세 조회 실패', { slug, error })
    return null
  }
})

/** OG 이미지로 쓸 수 있는 절대 https URL인가. */
function toAbsoluteImage(value: string | null | undefined): string {
  if (!value) return defaultOgImage()
  const safe = toSafeHttpUrl(value)
  if (safe?.startsWith('https://')) return safe
  if (value.startsWith('/')) return `${getSiteUrl()}${value}`
  return defaultOgImage()
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
  // 취소된 공연(`performances.status = 'canceled'`)은 리치 결과에도 취소로
  // 나가야 한다 — 안 그러면 구글이 계속 `EventScheduled · InStock`으로 노출해
  // 열리지 않는 공연에 사람을 보낸다. 좌석도 남지 않은 것으로 본다.
  const isCanceled = performance.status === 'canceled'
  const hasSeats =
    !isCanceled && performance.shows.some(show => !show.is_past && show.remaining_seats > 0)

  // 헬퍼는 프로젝트용이라 `url`을 `/projects/{slug}`로 굳힌다. 예매 페이지는
  // 주소가 다르므로 생성 뒤 덮어쓴다(헬퍼는 다른 화면도 쓰므로 건드리지 않는다).
  const eventSchema = {
    ...(generateEventStructuredData({
      title: performance.title,
      description: performance.summary || performance.description || performance.title,
      slug: performance.slug,
      publishedDate: eventDate ?? new Date().toISOString(),
      eventDate,
      cancelled: isCanceled,
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
