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

const OG_IMAGE = 'https://ggac.kr/images/logo/gac_og.webp'

async function loadPerformances(): Promise<PerformanceSummary[]> {
  try {
    return (await listOpenPerformances()) as unknown as PerformanceSummary[]
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

  return {
    title,
    description,
    alternates: getLocaleAlternates('/tickets', locale),
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url: isEn ? `${base}/en/tickets` : `${base}/tickets`,
      siteName,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: siteName }],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${siteName}`,
      description,
      images: [OG_IMAGE],
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
