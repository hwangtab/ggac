import { notFound } from 'next/navigation'
import ProjectDetailContent from './ProjectDetailContent'
import ErrorBoundary from '@/components/ErrorBoundary'
import {
  getProjectSlugs,
  getProjectBySlug,
  getProjectArtists,
  getProjectsSorted,
  type Project as ProjectType,
} from '@/lib/data'
import { fetchLinkPreview } from '@/utils/linkPreview'
import { getProjectSummary } from '@/utils/projectUtils'
import type { Metadata } from 'next'
import { generateProjectOgImage } from '@/utils/imageUrl'
import {
  generateProjectStructuredData,
  generateEventStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

interface ProjectPageProps {
  params: Promise<{
    slug: string
  }>
}

type RelatedProjectItem = Pick<
  ProjectType,
  'slug' | 'title' | 'coverImage' | 'publishedDate' | 'category'
>

const RELATED_SERIES_RULES: Array<{ key: string; patterns: RegExp[] }> = [
  {
    key: 'metal-syndicate-network',
    patterns: [/metal-syndicate-network/i, /철조망/i, /METAL\s+SYNDICATE\s+NETWORK/i],
  },
  {
    key: 'satanic-ritual-perversions',
    patterns: [/satanic-ritual-perversions/i, /SR&P/i, /SATANIC\s+RITUAL\s*&\s*PERVERSIONS/i],
  },
]

function extractSeriesKeys(project: ProjectType): string[] {
  const searchableText = `${project.slug} ${project.title}`
  return RELATED_SERIES_RULES.filter(rule =>
    rule.patterns.some(pattern => pattern.test(searchableText))
  ).map(rule => rule.key)
}

function extractInternalArchiveSlugs(project: ProjectType): string[] {
  if (!project.relatedArticles) return []

  return project.relatedArticles
    .map(article => {
      if (!article.url.startsWith('/archive/')) return null
      const slug = article.url.replace('/archive/', '').split(/[?#]/)[0]?.trim()
      return slug || null
    })
    .filter((slug): slug is string => Boolean(slug))
}

function buildRelatedProjects(
  currentProject: ProjectType,
  allProjects: ProjectType[]
): RelatedProjectItem[] {
  const currentSeriesKeys = new Set(extractSeriesKeys(currentProject))
  const internalSlugs = new Set(extractInternalArchiveSlugs(currentProject))
  const relatedMap = new Map<string, RelatedProjectItem>()

  if (currentSeriesKeys.size === 0 && internalSlugs.size === 0) return []

  allProjects
    .filter(project => project.slug !== currentProject.slug)
    .forEach(project => {
      if (internalSlugs.has(project.slug)) {
        relatedMap.set(project.slug, {
          slug: project.slug,
          title: project.title,
          coverImage: project.coverImage,
          publishedDate: project.publishedDate,
          category: project.category,
        })
        return
      }

      const matchedSeries = extractSeriesKeys(project).some(seriesKey =>
        currentSeriesKeys.has(seriesKey)
      )

      if (matchedSeries) {
        relatedMap.set(project.slug, {
          slug: project.slug,
          title: project.title,
          coverImage: project.coverImage,
          publishedDate: project.publishedDate,
          category: project.category,
        })
      }
    })

  return Array.from(relatedMap.values())
    .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
    .slice(0, 6)
}

// ISR: 참여 아티스트명 등 외부 데이터 변경을 주기적으로 반영
export const revalidate = 3600 // 1시간마다 재생성

// generateStaticParams 개선 - 환경 변수 안전성 체크 추가
export async function generateStaticParams() {
  try {
    const slugs = await getProjectSlugs()
    return slugs.map(slug => ({ slug }))
  } catch (error) {
    console.warn('Failed to generate static params for archive:', error)
    // 빌드 시점에서 환경 변수가 없을 때 빈 배열 반환
    return []
  }
}

// 안전한 문자열 처리를 위한 헬퍼 함수
function sanitizeMetadataString(str: string): string {
  if (!str) return ''

  // 문제가 될 수 있는 특수 문자들을 안전하게 처리
  return str
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // 제어 문자 제거
    .replace(/\s+/g, ' ') // 여러 공백을 하나로
    .trim()
}

// generateMetadata 개선 - 강화된 에러 처리 및 Facebook 크롤러 대응
export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const isProductionEnv = process.env.NODE_ENV === 'production'
  const timestamp = new Date().toISOString()

  try {
    // 파라미터 검증
    const resolvedParams = await params
    if (!resolvedParams?.slug) {
      console.error(`[${timestamp}] generateMetadata: Missing slug parameter`)
      return getDefaultMetadata()
    }

    // 프로젝트 데이터 조회 - 에러 처리 강화
    let project
    try {
      project = await getProjectBySlug(resolvedParams.slug)
    } catch (dataError) {
      console.error(
        `[${timestamp}] generateMetadata: Data loading error for slug "${resolvedParams.slug}":`,
        dataError
      )
      return getDefaultMetadata()
    }

    if (!project) {
      console.warn(
        `[${timestamp}] generateMetadata: Project not found for slug "${resolvedParams.slug}"`
      )
      return getNotFoundMetadata()
    }

    // 안전한 문자열 처리 - null/undefined 체크 강화
    const safeTitle = sanitizeMetadataString(project.title || 'Untitled Project')
    const safeSlug = sanitizeMetadataString(project.slug || resolvedParams.slug)

    // OG 이미지 생성 - 에러 처리 추가
    let ogImageUrl = 'https://ggac.kr/images/logo/gac_og.webp' // 기본값
    try {
      ogImageUrl = generateProjectOgImage(project)
    } catch (imageError) {
      console.error(`[${timestamp}] generateMetadata: Image generation error:`, imageError)
    }

    // 프로젝트 요약 생성 - 에러 처리 강화
    let projectSummary = '경기아트콜렉티브 프로젝트'
    try {
      projectSummary = sanitizeMetadataString(getProjectSummary(project, 150))
      if (!projectSummary || projectSummary.trim().length === 0) {
        projectSummary = '경기아트콜렉티브 프로젝트'
      }
    } catch (summaryError) {
      console.error(`[${timestamp}] generateMetadata: Summary generation error:`, summaryError)
    }

    const metadata = {
      title: safeTitle,
      description: projectSummary,
      alternates: {
        canonical: `/archive/${safeSlug}`,
      },
      openGraph: {
        title: safeTitle,
        description: projectSummary,
        url: `/archive/${safeSlug}`,
        siteName: '경기아트콜렉티브 협동조합',
        images: [
          {
            url: ogImageUrl,
            secureUrl: ogImageUrl.startsWith('https://')
              ? ogImageUrl
              : `https://ggac.kr${ogImageUrl}`,
            width: 1200,
            height: 630,
            alt: safeTitle,
            type: 'image/webp',
          },
        ],
        locale: 'ko_KR',
        type: 'article',
      },
      twitter: {
        card: 'summary_large_image',
        title: safeTitle,
        description: projectSummary,
        images: [ogImageUrl],
      },
    }

    if (!isProductionEnv) {
      console.log(`[${timestamp}] generateMetadata: Successfully generated for "${safeTitle}"`)
    }

    return metadata
  } catch (error) {
    console.error(`[${timestamp}] generateMetadata: Critical error:`, error)

    // Facebook 크롤러가 500 에러를 받지 않도록 항상 유효한 메타데이터 반환
    return getDefaultMetadata()
  }
}

// 기본 메타데이터 반환 함수
function getDefaultMetadata(): Metadata {
  return {
    title: '프로젝트',
    description: '경기아트콜렉티브 프로젝트',
    openGraph: {
      title: '경기아트콜렉티브 프로젝트',
      description: '경기아트콜렉티브 프로젝트',
      url: '/archive',
      siteName: '경기아트콜렉티브 협동조합',
      images: [
        {
          url: 'https://ggac.kr/images/logo/gac_og.webp',
          secureUrl: 'https://ggac.kr/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브',
          type: 'image/webp',
        },
      ],
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: '경기아트콜렉티브 프로젝트',
      description: '경기아트콜렉티브 프로젝트',
      images: ['https://ggac.kr/images/logo/gac_og.webp'],
    },
  }
}

// 프로젝트를 찾을 수 없을 때 메타데이터
function getNotFoundMetadata(): Metadata {
  return {
    title: 'Project Not Found',
    description: '요청하신 프로젝트를 찾을 수 없습니다.',
    robots: { index: false, follow: true },
    openGraph: {
      title: 'Project Not Found',
      description: '요청하신 프로젝트를 찾을 수 없습니다.',
      url: '/archive',
      siteName: '경기아트콜렉티브 협동조합',
      images: [
        {
          url: 'https://ggac.kr/images/logo/gac_og.webp',
          secureUrl: 'https://ggac.kr/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브',
          type: 'image/webp',
        },
      ],
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Project Not Found',
      description: '요청하신 프로젝트를 찾을 수 없습니다.',
      images: ['https://ggac.kr/images/logo/gac_og.webp'],
    },
  }
}

const ProjectDetailPage = async ({ params }: ProjectPageProps) => {
  // 개선된 데이터 로딩 - 단일 함수로 프로젝트 조회
  const resolvedParams = await params
  const project = await getProjectBySlug(resolvedParams.slug)

  if (!project) {
    notFound()
  }

  // 참여 아티스트 정보 가져오기
  const participatingArtists = await getProjectArtists(project.artistIds)

  const allProjects = await getProjectsSorted()
  const relatedProjects = buildRelatedProjects(project, allProjects)

  // "관련 기사"는 외부 링크만 표시하고, 내부 /archive 링크는 "연관 게시물"로 분리
  const externalRelatedArticles = (project.relatedArticles || []).filter(
    article => !article.url.startsWith('/archive/')
  )

  const articlesWithPreview = externalRelatedArticles
    ? await Promise.all(
        externalRelatedArticles.map(async article => {
          try {
            const preview = await fetchLinkPreview(article.url)
            return { ...article, preview }
          } catch (error) {
            console.error(`Failed to fetch preview for ${article.url}:`, error)
            return { ...article, preview: null }
          }
        })
      )
    : []

  // 구조화된 데이터 생성 - 프로젝트 타입에 따른 스마트 선택
  const isEvent = project.category === '공연·전시' || project.category === '행사'

  const breadcrumbData = generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '프로젝트', url: 'https://ggac.kr/archive' },
    { name: project.title, url: `https://ggac.kr/archive/${project.slug}` },
  ])

  const projectSchema = isEvent
    ? generateEventStructuredData({
        title: project.title,
        description: project.description,
        slug: project.slug,
        publishedDate: project.publishedDate,
        coverImage: project.coverImage,
        gallery: project.gallery,
        artistIds: project.artistIds,
        ticketing: project.ticketing,
        category: project.category,
      })
    : generateProjectStructuredData({
        title: project.title,
        description: project.description,
        slug: project.slug,
        coverImage: project.coverImage,
        gallery: project.gallery,
        artistIds: project.artistIds,
      })

  const structuredData = combineStructuredData([projectSchema, breadcrumbData])

  return (
    <>
      {structuredDataToScript(structuredData)}
      <ErrorBoundary componentName="ProjectDetailPage">
        <ProjectDetailContent
          project={{ ...project, relatedArticles: articlesWithPreview }}
          participatingArtists={participatingArtists}
          relatedProjects={relatedProjects}
        />
      </ErrorBoundary>
    </>
  )
}

export default ProjectDetailPage
