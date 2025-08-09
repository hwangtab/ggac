import ArchiveContent from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import type { Metadata } from 'next'

// ISR 최적화: 프로젝트는 6시간 캐시 (상대적으로 자주 업데이트)
export const revalidate = 21600

export const metadata: Metadata = {
  title: '프로젝트 | 경기아트콜렉티브 협동조합',
  description: '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육, 문화행사 등 우리의 발자취를 확인해보세요.',
  keywords: [
    '프로젝트', '음반제작', '공연기획', '예술교육', '문화행사', 
    '협업작품', '창작프로젝트', '예술작품', '콘텐츠', '기획사업'
  ],
  authors: [{ name: '경기아트콜렉티브 협동조합' }],
  creator: '경기아트콜렉티브 협동조합',
  publisher: '경기아트콜렉티브 협동조합',
  metadataBase: new URL('https://ggac.kr'),
  alternates: {
    canonical: '/archive',
    languages: {
      'ko-KR': '/archive',
    },
  },
  openGraph: {
    title: '프로젝트 | 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육 등 우리의 발자취를 확인해보세요.',
    url: 'https://ggac.kr/archive',
    siteName: '경기아트콜렉티브 협동조합',
    images: [
      {
        url: '/images/logo/gac_og_branded.webp',
        width: 1200,
        height: 630,
        alt: '경기아트콜렉티브 협동조합 - 프로젝트 아카이브',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '프로젝트 | 경기아트콜렉티브 협동조합',
    description: '우리가 만들어가는 다양한 창작 프로젝트들을 만나보세요.',
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

const ArchivePage = async () => {
  // 개선된 데이터 로딩 - 중복 제거 및 캐싱 활용
  const projects = await getProjectsSorted() // 이미 정렬된 프로젝트들
  const artists = await getArtists()

  return <ArchiveContent projects={projects} artists={artists} />
}

export default ArchivePage
