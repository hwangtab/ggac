import ArchiveContent from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import { ARCHIVE_CATEGORIES } from '@/constants/categories'
import {
  generateItemListStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { normalizeSingleParam } from '@/utils/searchParams'
import type { ArchiveCategory } from '@/constants/categories'
import type { Metadata } from 'next'
import type { Project } from '@/types'

const PROJECTS_PER_PAGE = 9

type ArchivePageProps = {
  searchParams?: {
    [key: string]: string | string[] | undefined
  }
}

// ISR 최적화: 프로젝트는 6시간 캐시 (상대적으로 자주 업데이트)
export const revalidate = 21600

export const metadata: Metadata = {
  title: '프로젝트 | 경기아트콜렉티브 협동조합',
  description:
    '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육, 문화행사 등 우리의 발자취를 확인해보세요.',
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
  metadataBase: new URL('https://ggac.kr'),
  alternates: {
    canonical: '/archive',
    languages: {
      'ko-KR': '/archive',
    },
  },
  openGraph: {
    title: '프로젝트 | 경기아트콜렉티브 협동조합',
    description:
      '경기아트콜렉티브가 만들어가는 다양한 창작 프로젝트들입니다. 음반제작, 공연기획, 예술교육 등 우리의 발자취를 확인해보세요.',
    url: 'https://ggac.kr/archive',
    siteName: '경기아트콜렉티브 협동조합',
    images: [
      {
        url: '/images/logo/gac_og.webp',
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

const filterProjectsByCategory = (projects: Project[], category: ArchiveCategory) => {
  if (category === 'All') {
    return projects
  }

  return projects.filter(project => project.category === category)
}

const ArchivePage = async ({ searchParams = {} }: ArchivePageProps) => {
  const projects = await getProjectsSorted()
  const artists = await getArtists()

  const rawCategory = normalizeSingleParam(searchParams.category)
  const selectedCategory = ARCHIVE_CATEGORIES.includes(rawCategory as ArchiveCategory)
    ? (rawCategory as ArchiveCategory)
    : 'All'

  const filteredProjects = filterProjectsByCategory(projects, selectedCategory)
  const totalCount = filteredProjects.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PROJECTS_PER_PAGE))

  const requestedPage = Number(normalizeSingleParam(searchParams.page)) || 1
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages)
  const startIndex = (currentPage - 1) * PROJECTS_PER_PAGE
  const paginatedProjects = filteredProjects.slice(startIndex, startIndex + PROJECTS_PER_PAGE)

  const artistIds = new Set<string>()
  paginatedProjects.forEach(project => {
    project.artistIds.forEach(id => artistIds.add(id))
  })

  const artistNameMap: Record<string, string> = {}
  artists.forEach(artist => {
    if (artistIds.has(artist.id)) {
      artistNameMap[artist.id] = artist.name
    }
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
      <ArchiveContent
        projects={paginatedProjects}
        selectedCategory={selectedCategory}
        pagination={{ currentPage, totalPages, totalCount }}
        pageSize={PROJECTS_PER_PAGE}
        artistNameMap={artistNameMap}
      />
    </>
  )
}

export default ArchivePage
