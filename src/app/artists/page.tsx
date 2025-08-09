import ArtistsContent from './ArtistsContent'
import { getArtists } from '@/lib/data'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '함께하는 사람들 | 경기아트콜렉티브 협동조합',
  description: '경기도를 기반으로 활동하는 다양한 분야의 예술가들을 만나보세요. 음악, 시각예술, 공연예술 등 각자의 고유한 색깔로 창작하는 우리 조합원들을 소개합니다.',
  keywords: [
    '경기도예술가', '아티스트', '음악가', '시각예술가', '공연예술가', 
    '창작자', '협동조합원', '예술가소개', '작가', '뮤지션', '기획자'
  ],
  authors: [{ name: '경기아트콜렉티브 협동조합' }],
  creator: '경기아트콜렉티브 협동조합',
  publisher: '경기아트콜렉티브 협동조합',
  metadataBase: new URL('https://ggac.kr'),
  alternates: {
    canonical: '/artists',
    languages: {
      'ko-KR': '/artists',
    },
  },
  openGraph: {
    title: '함께하는 사람들 | 경기아트콜렉티브 협동조합',
    description: '경기도를 기반으로 활동하는 다양한 분야의 예술가들을 만나보세요. 서로의 우주가 되어 함께 성장하는 창작자들입니다.',
    url: 'https://ggac.kr/artists',
    siteName: '경기아트콜렉티브 협동조합',
    images: [
      {
        url: '/images/logo/gac_og_branded.webp',
        width: 1200,
        height: 630,
        alt: '경기아트콜렉티브 협동조합 - 함께하는 사람들',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '함께하는 사람들 | 경기아트콜렉티브 협동조합',
    description: '서로의 우주가 되어 함께 성장하는 경기도 예술가들을 만나보세요.',
    images: ['/images/logo/gac_og_branded.webp'],
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

const ArtistsPage = async () => {
  // 개선된 데이터 로딩 - 타입까지 포함된 캐싱 함수 사용
  const artists = await getArtists()

  return <ArtistsContent artists={artists} />
}

export default ArtistsPage
