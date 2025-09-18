import { notFound } from 'next/navigation'
import ProjectDetailContent from './ProjectDetailContent'
import {
  getProjectSlugs,
  getProjectBySlug,
  getProjectArtists,
  type Project as ProjectType,
} from '@/lib/data'
import { fetchLinkPreview } from '@/utils/linkPreview'
import { getProjectSummary } from '@/utils/projectUtils'
import type { Metadata } from 'next'
import { generateProjectOgImage } from '@/utils/imageUrl'
import { generateProjectStructuredData, structuredDataToScript } from '@/utils/structuredData'

interface ProjectPageProps {
  params: Promise<{
    slug: string
  }>
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

// generateMetadata 개선 - 에러 처리 추가
export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  try {
    const resolvedParams = await params
    const project = await getProjectBySlug(resolvedParams.slug)

    if (!project) {
      return {
        title: 'Project Not Found | 경기아트콜렉티브 협동조합',
      }
    }

    // 안전한 문자열 처리
    const safeTitle = sanitizeMetadataString(project.title)
    const safeSlug = sanitizeMetadataString(project.slug)

    // OG 이미지 생성 - 통합 유틸리티 사용
    const ogImageUrl = generateProjectOgImage(project)

    // 프로젝트 요약 생성 - 에러 처리 추가
    let projectSummary = ''
    try {
      projectSummary = sanitizeMetadataString(getProjectSummary(project, 150))
    } catch (error) {
      console.error('Error generating project summary:', error)
      projectSummary = '경기아트콜렉티브 프로젝트'
    }

    return {
      title: `${safeTitle} | 경기아트콜렉티브 협동조합`,
      description: projectSummary,
      openGraph: {
        title: safeTitle,
        description: projectSummary,
        // 상대 경로 사용: 레이아웃의 metadataBase와 결합됨
        url: `/archive/${safeSlug}`,
        siteName: '경기아트콜렉티브 협동조합',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: safeTitle,
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
  } catch (error) {
    console.error('Error in generateMetadata:', error)

    // 에러 발생시 기본 메타데이터 반환
    return {
      title: '프로젝트 | 경기아트콜렉티브 협동조합',
      description: '경기아트콜렉티브 프로젝트',
      openGraph: {
        title: '경기아트콜렉티브 프로젝트',
        description: '경기아트콜렉티브 프로젝트',
        url: '/archive',
        siteName: '경기아트콜렉티브 협동조합',
        images: [
          {
            url: '/images/logo/gac_og.webp',
            width: 1200,
            height: 630,
            alt: '경기아트콜렉티브',
          },
        ],
        locale: 'ko_KR',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: '경기아트콜렉티브 프로젝트',
        description: '경기아트콜렉티브 프로젝트',
        images: ['/images/logo/gac_og.webp'],
      },
    }
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

  const articlesWithPreview = project.relatedArticles
    ? await Promise.all(
        project.relatedArticles.map(async article => {
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

  // 구조화된 데이터 생성
  const structuredData = generateProjectStructuredData({
    title: project.title,
    description: project.description,
    slug: project.slug,
    coverImage: project.coverImage,
    gallery: project.gallery,
    artistIds: project.artistIds,
  })

  return (
    <>
      {structuredDataToScript(structuredData)}
      <ProjectDetailContent
        project={{ ...project, relatedArticles: articlesWithPreview }}
        participatingArtists={participatingArtists}
      />
    </>
  )
}

export default ProjectDetailPage
