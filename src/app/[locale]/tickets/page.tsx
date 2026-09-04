/**
 * 예매 가능한 공연 목록. **로그인 없이 볼 수 있다** — 표를 사려면 먼저
 * 조합원이 되어야 한다면 아무도 사지 않는다.
 *
 * 서버에서 그린다. 예전에는 클라이언트가 `/api/tickets`를 불러 채웠는데, 그
 * 경우 첫 HTML이 비어 있어 검색엔진도 카카오톡 미리보기도 공연을 보지 못했다.
 */

import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { listOpenPerformances } from '@/db/queries/ticketing'
import { createLogger } from '@/utils/logger'
import { getLocaleAlternates, getOgLocale, getSiteUrl } from '@/utils/site'
import {
  combineStructuredData,
  generateBreadcrumbStructuredData,
  generateItemListStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

import TicketsListContent from './TicketsListContent'
import type { PerformanceSummary } from './types'

const log = createLogger('tickets/list')

// 재고가 실시간으로 변하므로 프로젝트(1시간)보다 훨씬 짧게 잡는다. 목록에는
// 잔여 좌석이 없고 "어떤 공연이 열려 있는가"만 보이므로 60초면 충분하다.
// 회차별 잔여 좌석은 상세 화면이 별도로 갱신한다.
export const revalidate = 60

// 운영 도메인을 문자열로 박지 않는다 — 정본은 `getSiteUrl()`이다(프리뷰
// 배포에서는 그 배포 호스트를 써야 미리보기가 뜬다). 끝 슬래시는 이미 떼여 있다.
const OG_IMAGE_PATH = '/images/logo/gac_og.webp'

/**
 * DB 행에서 목록이 실제로 쓰는 필드만 골라 새 객체를 만든다.
 *
 * `listOpenPerformances`는 `toSnakeCase`로 키만 바꾼 행 전체를 돌려주므로
 * 그대로 넘기면 `created_by`(관리자 UUID)·내부 id·타임스탬프가 서버 렌더
 * HTML에 직렬화돼 공개·색인된다. 상세 페이지와 같은 이유·같은 처리다.
 */
function toPerformanceSummary(row: Record<string, unknown>): PerformanceSummary {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null
  return {
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    summary: text(row.summary),
    venue: text(row.venue),
    poster_image: text(row.poster_image),
    next_show_at: text(row.next_show_at),
    show_count: Number(row.show_count ?? 0),
  }
}

async function loadPerformances(): Promise<PerformanceSummary[]> {
  try {
    const rows = await listOpenPerformances()
    return rows.map(toPerformanceSummary)
  } catch (error) {
    // DB가 없거나(빌드 시점) 조회가 실패해도 페이지는 떠야 한다.
    log.error('공연 목록 조회 실패', { error })
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tickets' })
  const base = getSiteUrl()
  const isEn = locale === 'en'
  const title = t('meta.listTitle')
  const description = t('meta.listDescription')
  const siteName = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
  const ogImage = `${base}${OG_IMAGE_PATH}`

  return {
    title,
    description,
    alternates: getLocaleAlternates('/tickets', locale),
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url: isEn ? `${base}/en/tickets` : `${base}/tickets`,
      siteName,
      images: [{ url: ogImage, width: 1200, height: 630, alt: siteName }],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${siteName}`,
      description,
      images: [ogImage],
    },
  }
}

export default async function TicketsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const performances = await loadPerformances()
  const base = getSiteUrl()
  const prefix = locale === 'en' ? `${base}/en` : base

  const jsonLd = combineStructuredData([
    generateItemListStructuredData(
      performances.map(performance => ({
        name: performance.title,
        url: `${prefix}/tickets/${performance.slug}`,
      }))
    ),
    generateBreadcrumbStructuredData([
      { name: '홈', url: base },
      { name: '공연 예매', url: `${base}/tickets` },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <TicketsListContent performances={performances} locale={locale} />
    </>
  )
}
