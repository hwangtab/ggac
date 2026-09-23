/**
 * 펀딩 목록. **로그인 없이 볼 수 있다** — 후원하려면 먼저 조합원이 되어야 한다면
 * 아무도 후원하지 않는다.
 *
 * 서버에서 그린다. 클라이언트가 API로 채우면 첫 HTML이 비어 있어 검색엔진도
 * 카카오톡 미리보기도 프로젝트를 보지 못한다(예매 목록과 같은 이유).
 */

import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { listPublicCampaigns, getCampaignProgress } from '@/db/queries/funding'
import { createLogger } from '@/utils/logger'
import { getLocaleAlternates, getOgLocale, getSiteUrl } from '@/utils/site'
import {
  combineStructuredData,
  generateBreadcrumbStructuredData,
  generateItemListStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

import FundingListContent from './FundingListContent'
import type { CampaignSummary } from './types'

const log = createLogger('funding/list')

// 모인금액이 실시간으로 변하지만 목록은 "무엇이 열려 있는가"가 본론이다.
// 60초면 충분하고, 상세 화면이 자기 수치를 따로 갱신한다.
export const revalidate = 60

const OG_IMAGE_PATH = '/images/logo/gac_og.webp'

/**
 * DB 행에서 목록이 실제로 쓰는 필드만 골라 새 객체를 만든다.
 * 그대로 넘기면 `owner_user_id`·`platform_fee_rate`·`review_note`가 서버 렌더
 * HTML에 직렬화돼 공개·색인된다(상세 페이지와 같은 처리다).
 */
function toCampaignSummary(
  row: Record<string, unknown>,
  progress: { raised_amount: number; backer_count: number }
): CampaignSummary {
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    cover_image: text(row.cover_image),
    category: String(row.category ?? '기타'),
    goal_amount: Number(row.goal_amount ?? 0),
    end_at: text(row.end_at),
    status: String(row.status ?? ''),
    progress: {
      raised_amount: Number(progress?.raised_amount ?? 0),
      backer_count: Number(progress?.backer_count ?? 0),
    },
  }
}

async function loadCampaigns(): Promise<CampaignSummary[]> {
  try {
    const rows = await listPublicCampaigns()
    return await Promise.all(
      rows.map(async row => toCampaignSummary(row, await getCampaignProgress(String(row.id))))
    )
  } catch (error) {
    // 목록을 못 불러와도 화면은 뜬다. 빈 목록이 오류 화면보다 낫다.
    log.error('펀딩 목록 조회 실패:', error)
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  try {
    const t = await getTranslations({ locale, namespace: 'funding' })
    const site = getSiteUrl()
    const path = '/funding'
    return {
      title: t('meta.listTitle'),
      description: t('meta.listDescription'),
      alternates: getLocaleAlternates(path, locale),
      openGraph: {
        title: t('meta.listTitle'),
        description: t('meta.listDescription'),
        url: `${site}${locale === 'ko' ? '' : `/${locale}`}${path}`,
        images: [{ url: `${site}${OG_IMAGE_PATH}` }],
        locale: getOgLocale(locale),
        type: 'website',
      },
      twitter: { card: 'summary_large_image', title: t('meta.listTitle') },
    }
  } catch {
    // 메타데이터 생성이 크롤러에게 깨진 응답을 주지 않게 한다.
    return { title: '펀딩' }
  }
}

export default async function FundingListPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const campaigns = await loadCampaigns()
  const t = await getTranslations({ locale, namespace: 'funding' })
  const site = getSiteUrl()

  const jsonLd = combineStructuredData([
    generateBreadcrumbStructuredData([{ name: t('list.heading'), url: `${site}/funding` }]),
    generateItemListStructuredData(
      campaigns.map(c => ({
        name: c.title,
        url: `${site}/funding/${c.slug}`,
      }))
    ),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <FundingListContent campaigns={campaigns} locale={locale} />
    </>
  )
}
