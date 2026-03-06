import Hero from '@/components/Hero'
import FeaturedProjects from '@/components/FeaturedProjects'
import FeaturedArtists from '@/components/FeaturedArtists'
import { getFeaturedProjects, getArtists } from '@/lib/data'
import type { Metadata } from 'next'
import {
  generateWebsiteStructuredData,
  generateOrganizationStructuredData,
  structuredDataToScript,
  combineStructuredData,
} from '@/utils/structuredData'

export const metadata: Metadata = {
  title: '경기아트콜렉티브 협동조합 - 경계 없는 상상, 함께 만드는 울림',
  description:
    '예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다. 다양한 장르의 아티스트들이 함께 만들어가는 창작 공동체로, 음악, 미술, 영상, 공연 등 모든 예술 분야에서 활동하며 서로의 영감을 나누고 새로운 가능성을 탐구합니다.',
  keywords: [
    '경기아트콜렉티브',
    '협동조합',
    '예술',
    '아티스트',
    '음악',
    '미술',
    '공연',
    '창작',
    '협업',
    '경기도',
    '수원',
  ],
  alternates: {
    canonical: '/',
    languages: { 'ko-KR': '/' },
  },
  openGraph: {
    title: '경기아트콜렉티브 협동조합',
    description:
      '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
    url: '/',
    siteName: '경기아트콜렉티브 협동조합',
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: '/images/logo/gac_og.webp',
        width: 1200,
        height: 630,
        alt: '경기아트콜렉티브 협동조합',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '경기아트콜렉티브 협동조합',
    description:
      '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default async function Home() {
  // 개선된 데이터 로딩 - 캐싱된 함수 사용
  const featuredProjects = await getFeaturedProjects(3) // 최신 3개 프로젝트
  const artists = await getArtists()

  // 구조화된 데이터 생성
  const websiteData = generateWebsiteStructuredData()
  const organizationData = generateOrganizationStructuredData()
  const combinedStructuredData = combineStructuredData([websiteData, organizationData])

  return (
    <div data-home-page="true">
      {structuredDataToScript(combinedStructuredData)}
      <Hero />
      <FeaturedProjects projects={featuredProjects} />
      <FeaturedArtists artists={artists} />
    </div>
  )
}
