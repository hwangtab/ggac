import ArchiveContent from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import { ARCHIVE_CATEGORIES, localizeArchiveCategory } from '@/constants/categories'
import {
  generateItemListStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { normalizeSingleParam } from '@/utils/searchParams'
import { setRequestLocale } from 'next-intl/server'
import type { ArchiveCategory } from '@/constants/categories'
import type { Metadata } from 'next'
import type { Project } from '@/types'

const PROJECTS_PER_PAGE = 9

type ArchivePageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

// ISR 최적화: 프로젝트는 6시간 캐시 (상대적으로 자주 업데이트)
export const revalidate = 21600

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  const resolvedSearch = (await searchParams) ?? {}
  const page =
    Number(Array.isArray(resolvedSearch.page) ? resolvedSearch.page[0] : resolvedSearch.page) || 1
  const basePath = page > 1 ? `/archive?page=${page}` : '/archive'
  const canonical = isEn ? `/en${basePath}` : basePath

  return {
    title: isEn ? 'Projects Archive' : '프로젝트',
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
      title: isEn
        ? 'Projects Archive | Gyeonggi Art Collective'
        : '프로젝트 | 경기아트콜렉티브 협동조합',
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
          alt: '경기아트콜렉티브 협동조합 - 프로젝트 아카이브',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn
        ? 'Projects Archive | Gyeonggi Art Collective'
        : '프로젝트 | 경기아트콜렉티브 협동조합',
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

const filterProjectsByCategory = (
  projects: Project[],
  category: ArchiveCategory,
  locale: string
) => {
  if (category === 'All') {
    return projects
  }

  const matchValue = locale === 'en' ? localizeArchiveCategory(category, 'en') : category
  return projects.filter(project => project.category === matchValue)
}

const ArchivePage = async ({ params, searchParams }: ArchivePageProps) => {
  const { locale } = await params
  setRequestLocale(locale)
  const resolvedSearch = (await searchParams) ?? {}

  const projects = await getProjectsSorted(locale)
  const artists = await getArtists(locale)

  const rawCategory = normalizeSingleParam(resolvedSearch.category)
  const selectedCategory = ARCHIVE_CATEGORIES.includes(rawCategory as ArchiveCategory)
    ? (rawCategory as ArchiveCategory)
    : 'All'

  const filteredProjects = filterProjectsByCategory(projects, selectedCategory, locale)
  const totalCount = filteredProjects.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PROJECTS_PER_PAGE))

  const requestedPage = Number(normalizeSingleParam(resolvedSearch.page)) || 1
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
