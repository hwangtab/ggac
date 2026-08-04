import { Suspense } from 'react'
import ArtistsContent, { ArtistsView } from './ArtistsContent'
import { getArtists } from '@/lib/data'
import {
  generateItemListStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'

// ISR 최적화: 아티스트 정보는 12시간 캐시 (중간 빈도 업데이트)
export const revalidate = 43200

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  return {
    title: isEn ? 'Our Artists — Indie Musicians & Bands' : '소속 아티스트 — 인디 뮤지션·밴드',
    description: isEn
      ? 'Meet the indie musicians and bands of Gyeonggi Art Collective — doom metal, punk, folk, hip-hop, and experimental music.'
      : '경기아트콜렉티브 소속 인디 뮤지션·밴드를 만나보세요. 둠메탈·펑크·포크·힙합·실험음악까지, 상업 무대 바깥에서 자기 색깔로 창작하는 아티스트들입니다.',
    keywords: [
      '인디뮤지션',
      '인디밴드',
      '언더그라운드밴드',
      '둠메탈밴드',
      '펑크밴드',
      '경기도뮤지션',
      '수원밴드',
      '아티스트소개',
      '음악가',
      '싱어송라이터',
      '기획자',
    ],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    creator: '경기아트콜렉티브 협동조합',
    publisher: '경기아트콜렉티브 협동조합',
    alternates: getLocaleAlternates('/artists', locale),
    openGraph: {
      title: isEn
        ? 'Indie Musicians & Bands | Gyeonggi Art Collective'
        : '소속 아티스트 — 인디 뮤지션·밴드 | 경기아트콜렉티브',
      description: isEn
        ? 'Meet the indie musicians and bands of Gyeonggi Art Collective — doom metal, punk, folk, and experimental music.'
        : '둠메탈·펑크·포크·실험음악까지, 경기아트콜렉티브 소속 인디 뮤지션·밴드를 만나보세요.',
      url: isEn ? `${base}/en/artists` : `${base}/artists`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 - 함께하는 사람들',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn
        ? 'Indie Musicians & Bands | Gyeonggi Art Collective'
        : '소속 아티스트 — 인디 뮤지션·밴드 | 경기아트콜렉티브',
      description: isEn
        ? 'Meet the indie musicians and bands of Gyeonggi Art Collective.'
        : '둠메탈·펑크·포크·실험음악, 경기아트콜렉티브 소속 인디 뮤지션·밴드.',
      images: ['/images/logo/gac_og.webp'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

type ArtistsPageProps = {
  params: Promise<{ locale: string }>
}

// 카테고리 필터(?category=)는 ArtistsContent(클라이언트)가 useSearchParams로 처리한다.
// 서버에서 searchParams를 읽으면 페이지가 동적 렌더링으로 전환되어 위 revalidate가
// 사문화되므로(전수감사 P3) 서버는 전체 데이터만 정적으로 렌더한다.
const ArtistsPage = async ({ params }: ArtistsPageProps) => {
  const { locale } = await params
  setRequestLocale(locale)
  const artists = await getArtists(locale)

  const categoriesSet = new Set<string>()
  artists.forEach(artist => {
    if (Array.isArray(artist.category)) {
      artist.category.forEach(cat => categoriesSet.add(cat))
    } else if (artist.category) {
      categoriesSet.add(artist.category)
    }
  })

  const sortedCategories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b, 'ko'))
  const categories = ['All', ...sortedCategories]

  const jsonLd = combineStructuredData([
    generateItemListStructuredData(
      artists.map(artist => ({
        name: artist.name,
        url: `https://ggac.kr/artists/${artist.slug}`,
      }))
    ),
    generateBreadcrumbStructuredData([
      { name: '홈', url: 'https://ggac.kr' },
      { name: '함께하는 사람들', url: 'https://ggac.kr/artists' },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      {/* fallback을 기본 상태(All) 뷰로 렌더해 프리렌더 HTML에 목록 콘텐츠를 포함시킨다
          (useSearchParams CSR bailout이 이 경계까지 비우는 것 보완) */}
      <Suspense
        fallback={<ArtistsView artists={artists} categories={categories} selectedCategory="All" />}
      >
        <ArtistsContent artists={artists} categories={categories} />
      </Suspense>
    </>
  )
}

export default ArtistsPage
