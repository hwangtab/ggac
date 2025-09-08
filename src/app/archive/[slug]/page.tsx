import { notFound } from 'next/navigation'
import ProjectDetailContent from './ProjectDetailContent'
import {
  getProjectSlugs,
  getProjectBySlug,
  getProjectArtists,
  type Project as ProjectType,
} from '@/lib/data'
import { fetchLinkPreview } from '@/utils/linkPreview'
import type { Metadata } from 'next'

interface ProjectPageProps {
  params: Promise<{
    slug: string
  }>
}

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

// generateMetadata 개선 - 캐싱된 함수 사용
export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const resolvedParams = await params
  const project = await getProjectBySlug(resolvedParams.slug)

  if (!project) {
    return {
      title: 'Project Not Found | 경기아트콜렉티브 협동조합',
    }
  }

  // OG 이미지 결정 로직 (상대 경로 반환)
  const getOgImage = () => {
    // 1. coverImage가 있으면 우선 사용
    if (project.coverImage) {
      return project.coverImage.replace('.webp', '.jpg')
    }

    // 2. 갤러리 첫 번째 이미지 사용
    if (project.gallery && project.gallery.length > 0) {
      return project.gallery[0].replace('.webp', '.jpg')
    }

    // 3. 기본 로고 이미지
    return '/images/logo/gac_og.webp'
  }

  // 상대 경로 사용: 레이아웃(metadataBase)와 결합되어 절대 URL이 생성됨
  const ogImageUrl = getOgImage()

  return {
    title: `${project.title} | 경기아트콜렉티브 협동조합`,
    description: project.description.split('\n')[0],
    openGraph: {
      title: project.title,
      description: project.description.split('\n')[0],
      // 상대 경로 사용: 레이아웃의 metadataBase와 결합됨
      url: `/archive/${project.slug}`,
      siteName: '경기아트콜렉티브 협동조합',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: project.title,
        },
      ],
      locale: 'ko_KR',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: project.title,
      description: project.description.split('\n')[0],
      images: [ogImageUrl],
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

  return (
    <ProjectDetailContent
      project={{ ...project, relatedArticles: articlesWithPreview }}
      participatingArtists={participatingArtists}
    />
  )
}

export default ProjectDetailPage
