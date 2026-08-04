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
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'
import { generateProjectOgImage } from '@/utils/imageUrl'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { toSafeHttpUrl } from '@/utils/safeUrl'
import { createLogger } from '@/utils/logger'
import {
  generateProjectStructuredData,
  generateEventStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

interface ProjectPageProps {
  params: Promise<{
    locale: string
    slug: string
  }>
}

const log = createLogger('archive/project-page')

function describeExternalUrlForLog(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '[invalid-url]'
  }
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

function toSecureMetadataImageUrl(value: string, baseUrl: string): string | undefined {
  const safeUrl = toSafeHttpUrl(value)
  if (safeUrl) {
    return safeUrl.startsWith('https://') ? safeUrl : undefined
  }

  if (value.startsWith('/')) {
    const safeBase = toSafeHttpUrl(baseUrl) ?? 'https://ggac.kr'
    return `${safeBase.replace(/\/$/, '')}${value}`
  }

  return undefined
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
    const isEn = resolvedParams?.locale === 'en'

    if (!resolvedParams?.slug) {
      console.error(`[${timestamp}] generateMetadata: Missing slug parameter`)
      return getDefaultMetadata(resolvedParams?.locale)
    }

    // 프로젝트 데이터 조회 - 에러 처리 강화
    let project
    try {
      project = await getProjectBySlug(resolvedParams.slug, resolvedParams.locale)
    } catch (dataError) {
      console.error(
        `[${timestamp}] generateMetadata: Data loading error for slug "${resolvedParams.slug}":`,
        dataError
      )
      return getDefaultMetadata(resolvedParams.locale)
    }

    if (!project) {
      console.warn(
        `[${timestamp}] generateMetadata: Project not found for slug "${resolvedParams.slug}"`
      )
      return getNotFoundMetadata(resolvedParams.locale)
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
    const fallbackSummary = isEn ? 'Gyeonggi Art Collective project' : '경기아트콜렉티브 프로젝트'
    let projectSummary = fallbackSummary
    try {
      projectSummary = sanitizeMetadataString(getProjectSummary(project, 150))
      if (!projectSummary || projectSummary.trim().length === 0) {
        projectSummary = fallbackSummary
      }
    } catch (summaryError) {
      console.error(`[${timestamp}] generateMetadata: Summary generation error:`, summaryError)
    }

    const base = getSiteUrl()
    const secureOgImageUrl = toSecureMetadataImageUrl(ogImageUrl, base)
    const metadata = {
      title: safeTitle,
      description: projectSummary,
      alternates: getLocaleAlternates(`/archive/${safeSlug}`, resolvedParams.locale),
      openGraph: {
        title: safeTitle,
        description: projectSummary,
        // og:url도 로케일 프리픽스 반영(canonical과 언어 일치). en은 /en 경로.
        url: isEn ? `/en/archive/${safeSlug}` : `/archive/${safeSlug}`,
        siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
        images: [
          {
            url: ogImageUrl,
            ...(secureOgImageUrl ? { secureUrl: secureOgImageUrl } : {}),
            width: 1200,
            height: 630,
            alt: safeTitle,
            type: 'image/webp',
          },
        ],
        locale: getOgLocale(resolvedParams.locale),
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
// (locale 파라미터: generateMetadata에서 resolvedParams 접근 불가한 catch 블록용 기본값 유지)
function getDefaultMetadata(locale = 'ko'): Metadata {
  const isEn = locale === 'en'
  const title = isEn ? 'Projects' : '프로젝트'
  const description = isEn ? 'Gyeonggi Art Collective project' : '경기아트콜렉티브 프로젝트'
  const siteName = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
  const alt = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브'
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: '/archive',
      siteName,
      images: [
        {
          url: 'https://ggac.kr/images/logo/gac_og.webp',
          secureUrl: 'https://ggac.kr/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt,
          type: 'image/webp',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['https://ggac.kr/images/logo/gac_og.webp'],
    },
  }
}

// 프로젝트를 찾을 수 없을 때 메타데이터
function getNotFoundMetadata(locale = 'ko'): Metadata {
  const isEn = locale === 'en'
  const description = isEn
    ? 'The requested project could not be found.'
    : '요청하신 프로젝트를 찾을 수 없습니다.'
  const siteName = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합'
  const alt = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브'
  return {
    title: 'Project Not Found',
    description,
    robots: { index: false, follow: true },
    openGraph: {
      title: 'Project Not Found',
      description,
      url: '/archive',
      siteName,
      images: [
        {
          url: 'https://ggac.kr/images/logo/gac_og.webp',
          secureUrl: 'https://ggac.kr/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt,
          type: 'image/webp',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Project Not Found',
      description,
      images: ['https://ggac.kr/images/logo/gac_og.webp'],
    },
  }
}

const ProjectDetailPage = async ({ params }: ProjectPageProps) => {
  const resolvedParams = await params
  setRequestLocale(resolvedParams.locale)

  const project = await getProjectBySlug(resolvedParams.slug, resolvedParams.locale)

  if (!project) {
    notFound()
  }

  // 참여 아티스트 정보 가져오기
  const participatingArtists = await getProjectArtists(project.artistIds, resolvedParams.locale)

  const allProjects = await getProjectsSorted(resolvedParams.locale)
  const relatedProjects = buildRelatedProjects(project, allProjects)

  // "관련 기사"는 외부 링크만 표시하고, 내부 /archive 링크는 "연관 게시물"로 분리
  const externalRelatedArticles = (project.relatedArticles || [])
    .map(article => {
      const safeUrl = toSafeHttpUrl(article.url)
      return safeUrl ? { ...article, url: safeUrl } : null
    })
    .filter((article): article is NonNullable<typeof article> => Boolean(article))

  const articlesWithPreview = externalRelatedArticles
    ? await Promise.all(
        externalRelatedArticles.map(async article => {
          try {
            const preview = await fetchLinkPreview(article.url)
            return { ...article, preview }
          } catch (error) {
            log.error('Failed to fetch article preview', {
              url: describeExternalUrlForLog(article.url),
              error,
            })
            return { ...article, preview: null }
          }
        })
      )
    : []

  // 구조화된 데이터 생성 - 프로젝트 타입에 따른 스마트 선택
  const EVENT_CATEGORIES = new Set(['공연·전시', '행사', 'Performance & Exhibition', 'Event'])
  const isEvent = EVENT_CATEGORIES.has(project.category)

  const breadcrumbData = generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '프로젝트', url: 'https://ggac.kr/archive' },
    { name: project.title, url: `https://ggac.kr/archive/${project.slug}` },
  ])

  const projectSchema = isEvent
    ? generateEventStructuredData({
        title: project.title,
        // 스키마 description은 답변-우선 리드를 우선 사용(없으면 본문) — AI 인용 추출성 강화.
        description: project.lead || project.description,
        slug: project.slug,
        publishedDate: project.publishedDate,
        eventDate: project.eventDate,
        venue: project.venue,
        cancelled: project.cancelled,
        coverImage: project.coverImage,
        gallery: project.gallery,
        artistIds: project.artistIds,
        performers: participatingArtists.map(a => ({
          name: a.name,
          url: `https://ggac.kr/artists/${a.slug}`,
        })),
        ticketing: project.ticketing,
        category: project.category,
      })
    : generateProjectStructuredData({
        title: project.title,
        description: project.lead || project.description,
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
