import { Suspense } from 'react'
import ArchiveContent, { ArchiveView } from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import {
  generateItemListStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { todaySeoul } from '@/utils/date'
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
    title: isEn ? 'Concerts & Live Archive' : '공연·라이브 아카이브 (메탈·펑크·실험음악)',
    description: isEn
      ? 'Concerts, live shows, and events by Gyeonggi Art Collective — the METAL SYNDICATE NETWORK series, indie and underground gigs across Gyeonggi and Seoul.'
      : '경기아트콜렉티브가 직접 기획한 공연·라이브 아카이브입니다. 철조망(METAL SYNDICATE NETWORK)·건강열전·수원 사운드 마켓 등 서울·경기 언더그라운드 인디 공연을 확인해보세요.',
    keywords: [
      '인디공연',
      '언더그라운드공연',
      '메탈공연',
      '펑크공연',
      '라이브공연',
      '수원공연',
      '경기도공연',
      '철조망',
      '공연기획',
      '실험음악',
    ],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    creator: '경기아트콜렉티브 협동조합',
    publisher: '경기아트콜렉티브 협동조합',
    alternates: getLocaleAlternates('/archive', locale),
    openGraph: {
      title: isEn
        ? 'Concerts & Live Archive | Gyeonggi Art Collective'
        : '공연·라이브 아카이브 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Concerts and live shows by Gyeonggi Art Collective — the METAL SYNDICATE NETWORK series and underground indie gigs.'
        : '철조망·건강열전·수원 사운드 마켓 등 경기아트콜렉티브가 직접 기획한 서울·경기 언더그라운드 인디 공연 아카이브.',
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
      title: isEn
        ? 'Concerts & Live Archive | Gyeonggi Art Collective'
        : '공연·라이브 아카이브 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Concerts and underground indie gigs by Gyeonggi Art Collective.'
        : '철조망·건강열전 등 경기아트콜렉티브가 직접 기획한 언더그라운드 인디 공연.',
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

  const [allProjects, artists] = await Promise.all([getProjectsSorted(locale), getArtists(locale)])

  // 예정/지난 분리는 서버에서 수행한다(클라이언트가 날짜를 재계산해 하이드레이션
  // 불일치를 내지 않도록). ISR(revalidate)로 '오늘'이 주기적으로 갱신된다.
  // 미래 공연일(eventDate)이 있고 취소되지 않은 공연을 '예정'으로, eventDate
  // 오름차순 정렬해 상단에 노출한다. 나머지는 기존 발행일 역순 아카이브.
  const todayStr = todaySeoul()
  const isUpcoming = (p: (typeof allProjects)[number]) =>
    !!p.eventDate && !p.cancelled && p.eventDate >= todayStr
  const upcomingProjects = allProjects
    .filter(isUpcoming)
    .sort((a, b) => (a.eventDate! < b.eventDate! ? -1 : 1))
  const projects = allProjects.filter(p => !isUpcoming(p))

  // 클라이언트가 어떤 페이지를 보든 참여자 이름을 표시할 수 있도록 전체 맵 전달
  // (아티스트 십수 명 규모 — 페이로드 수백 바이트)
  const artistNameMap: Record<string, string> = {}
  artists.forEach(artist => {
    artistNameMap[artist.id] = artist.name
  })

  const jsonLd = combineStructuredData([
    generateItemListStructuredData(
      allProjects.map(project => ({
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
      {/* fallback을 기본 상태(All·1페이지) 뷰로 렌더해 프리렌더 HTML에 목록을 포함시킨다 */}
      <Suspense
        fallback={
          <ArchiveView
            projects={projects}
            upcomingProjects={upcomingProjects}
            pageSize={PROJECTS_PER_PAGE}
            artistNameMap={artistNameMap}
            selectedCategory="All"
            requestedPage={1}
          />
        }
      >
        <ArchiveContent
          projects={projects}
          upcomingProjects={upcomingProjects}
          pageSize={PROJECTS_PER_PAGE}
          artistNameMap={artistNameMap}
        />
      </Suspense>
    </>
  )
}

export default ArchivePage
