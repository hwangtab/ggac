import { Suspense } from 'react'
import ArchiveContent from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import {
  generateItemListStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'

const PROJECTS_PER_PAGE = 9

type ArchivePageProps = {
  params: Promise<{ locale: string }>
}

// ISR 최적화: 프로젝트는 6시간 캐시 (상대적으로 자주 업데이트)
export const revalidate = 21600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  // 페이지네이션은 클라이언트(?page=)로 이관됨 — canonical은 목록 루트로 고정
  const canonical = isEn ? '/en/archive' : '/archive'

  return {
    title: isEn ? 'Projects' : '프로젝트',
    description: isEn
      ? 'Browse all projects, concerts, exhibitions, and events by Gyeonggi Art Collective.'
      : '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육, 문화행사 등 우리의 발자취를 확인해보세요.',
    keywords: [
      '프로젝트',
      '음반제작',
      '공연기획',
      '예술교육',
      '문화행사',
      '협업작품',
      '창작프로젝트',
      '예술작품',
      '콘텐츠',
      '기획사업',
    ],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    creator: '경기아트콜렉티브 협동조합',
    publisher: '경기아트콜렉티브 협동조합',
    alternates: getLocaleAlternates('/archive', locale),
    openGraph: {
      title: isEn ? 'Projects | Gyeonggi Art Collective' : '프로젝트 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Browse all projects, concerts, exhibitions, and events by Gyeonggi Art Collective.'
        : '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육 등 우리의 발자취를 확인해보세요.',
      url: `${base}${canonical}`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 - 프로젝트',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn ? 'Projects | Gyeonggi Art Collective' : '프로젝트 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Browse all projects, concerts, exhibitions, and events by Gyeonggi Art Collective.'
        : '우리가 만들어가는 다양한 창작 프로젝트들을 만나보세요.',
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

// 카테고리·페이지 필터(?category=, ?page=)는 ArchiveContent(클라이언트)가
// useSearchParams로 처리한다. 서버에서 searchParams를 읽으면 페이지가 동적
// 렌더링으로 전환되어 위 revalidate가 사문화되므로(전수감사 P3) 서버는
// 전체 프로젝트·아티스트 이름 맵만 정적으로 렌더한다.
const ArchivePage = async ({ params }: ArchivePageProps) => {
  const { locale } = await params
  setRequestLocale(locale)

  const [projects, artists] = await Promise.all([getProjectsSorted(locale), getArtists(locale)])

  // 클라이언트가 어떤 페이지를 보든 참여자 이름을 표시할 수 있도록 전체 맵 전달
  // (아티스트 십수 명 규모 — 페이로드 수백 바이트)
  const artistNameMap: Record<string, string> = {}
  artists.forEach(artist => {
    artistNameMap[artist.id] = artist.name
  })

  const jsonLd = combineStructuredData([
    generateItemListStructuredData(
      projects.map(project => ({
        name: project.title,
        url: `https://ggac.kr/archive/${project.slug}`,
      }))
    ),
    generateBreadcrumbStructuredData([
      { name: '홈', url: 'https://ggac.kr' },
      { name: '프로젝트', url: 'https://ggac.kr/archive' },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <Suspense fallback={null}>
        <ArchiveContent
          projects={projects}
          pageSize={PROJECTS_PER_PAGE}
          artistNameMap={artistNameMap}
        />
      </Suspense>
    </>
  )
}

export default ArchivePage
