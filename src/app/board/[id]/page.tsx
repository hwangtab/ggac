import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostMetadata } from '@/lib/posts'
import PostDetailClient from './PostDetailClient'
import { Suspense } from 'react'
import { generatePostOgImage } from '@/utils/imageUrl'
import {
  generatePostStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

// 동적 메타데이터 생성
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const resolvedParams = await params
  const postId = resolvedParams.id

  try {
    const metadata = await getPostMetadata(postId)

    if (!metadata) {
      return {
        title: '게시물을 찾을 수 없습니다',
        description: '요청하신 게시물을 찾을 수 없습니다.',
        robots: { index: false, follow: true },
      }
    }

    const { post, author, thumbnail, description, categoryEmoji, keywords, contentTextLength } =
      metadata

    const ogTitle = `${categoryEmoji} [${post.category}] ${post.title} - 경기아트콜렉티브`
    const title = `${categoryEmoji} [${post.category}] ${post.title}`

    // OG 이미지 생성 - 통합 유틸리티 사용
    const ogImageUrl = generatePostOgImage(thumbnail)

    // Thin content는 색인 가치가 낮아 GSC "크롤링됨 - 색인 안 됨"으로 잡힘.
    // 본문이 짧거나 잡담 카테고리면 noindex 처리해 사이트 전반의 색인 품질 확보.
    const isThinContent = contentTextLength < 200
    const isLowValueCategory = post.category === '잡담'
    const shouldNoindex = isThinContent || isLowValueCategory

    return {
      title,
      description,
      keywords,
      authors: [{ name: author?.display_name || '경기아트콜렉티브' }],
      ...(shouldNoindex && {
        robots: { index: false, follow: true },
      }),
      openGraph: {
        title: ogTitle,
        description,
        url: `https://ggac.kr/board/${postId}`,
        siteName: '경기아트콜렉티브 협동조합',
        locale: 'ko_KR',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: `${post.title} - 경기아트콜렉티브`,
          },
        ],
        type: 'article',
        publishedTime: post.created_at,
        authors: [author?.display_name || '경기아트콜렉티브'],
        section: post.category,
      },
      twitter: {
        card: 'summary_large_image',
        title: ogTitle,
        description,
        images: [ogImageUrl],
      },
      alternates: {
        canonical: `/board/${postId}`,
      },
    }
  } catch (error) {
    console.error('[Metadata] Error generating metadata:', error)
    return {
      title: '게시물',
      description: '경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.',
    }
  }
}

// ISR 설정 - 게시글 상세 페이지 60초 캐시
export const revalidate = 60

interface InitialPostData {
  post: any
  comments: any[]
  attachments: any[]
  author: any
}

// 서버 컴포넌트: 초기 게시글 데이터를 ISR로 제공
async function getInitialPostData(postId: string): Promise<InitialPostData | null> {
  // Service role 클라이언트 생성 (서버에서만 사용)
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    console.error('NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다')
    return null
  }

  const supabaseAdmin = key
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
        auth: { autoRefreshToken: false, persistSession: false },
      })

  try {
    // 병렬 조회로 왕복 시간 최소화
    const postQuery = supabaseAdmin
      .from('posts')
      .select(
        `
        id,
        title,
        content,
        content_format,
        category,
        author_id,
        created_at,
        updated_at,
        like_count,
        view_count,
        is_pinned,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
      )
      .eq('id', postId)
      .not('is_deleted', 'is', true)
      .single()

    const commentsQuery = supabaseAdmin
      .from('comments')
      .select(
        `
        id,
        content,
        author_id,
        created_at,
        like_count,
        author:member_profiles!comments_author_id_fkey (
          display_name
        )
      `
      )
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(20)

    const attachmentsQuery = supabaseAdmin
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    const [{ data: post, error: postError }, { data: commentsRaw }, { data: attachmentsRaw }] =
      await Promise.all([postQuery, commentsQuery, attachmentsQuery])

    const comments = Array.isArray(commentsRaw) ? commentsRaw : commentsRaw ? [commentsRaw] : []
    const attachments = Array.isArray(attachmentsRaw)
      ? attachmentsRaw
      : attachmentsRaw
        ? [attachmentsRaw]
        : []

    if (postError || !post) {
      console.error('서버 게시글 조회 오류:', postError)
      return null
    }

    const authorRecord = Array.isArray(post.author) ? post.author[0] : post.author
    const totalSize = (attachments || []).reduce((sum, att) => sum + (att.file_size || 0), 0)

    return {
      post: {
        ...post,
        is_liked: false, // 서버에서는 기본값, 클라이언트에서 업데이트
        comment_count: (comments || []).length,
        attachments_stats: {
          total_attachments: (attachments || []).length,
          total_size: totalSize,
          image_count: (attachments || []).filter(att => att.file_type === 'image').length,
          document_count: (attachments || []).filter(att => att.file_type === 'document').length,
          video_count: (attachments || []).filter(att => att.file_type === 'video').length,
          audio_count: (attachments || []).filter(att => att.file_type === 'audio').length,
        },
      },
      comments,
      attachments,
      author: authorRecord ? { display_name: authorRecord.display_name } : null,
    }
  } catch (error) {
    console.error('초기 게시글 데이터 조회 실패:', error)
    return null
  }
}

// 서버 컴포넌트 (메타데이터 생성용)
export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const postId = resolvedParams.id

  // 데이터 페칭 로직을 페이지 컴포넌트에서 직접 수행
  const [metadata, initialData] = await Promise.all([
    getPostMetadata(postId).catch(() => null),
    getInitialPostData(postId),
  ])

  if (!initialData) {
    notFound()
  }
  const resolvedInitialData = initialData as InitialPostData

  // 구조화된 데이터 생성(메타데이터 실패 시 생략)
  const postSchema = metadata
    ? generatePostStructuredData({
        id: postId,
        title: metadata.post.title,
        content: metadata.post.content,
        category: metadata.post.category,
        created_at: metadata.post.created_at,
        updated_at: metadata.post.updated_at || metadata.post.created_at,
        author: metadata.author,
        thumbnail: metadata.thumbnail,
      })
    : null

  const breadcrumbData = metadata
    ? generateBreadcrumbStructuredData([
        { name: '홈', url: 'https://ggac.kr' },
        { name: '게시판', url: 'https://ggac.kr/board' },
        { name: metadata.post.title, url: `https://ggac.kr/board/${postId}` },
      ])
    : null

  const structuredData =
    postSchema && breadcrumbData ? combineStructuredData([postSchema, breadcrumbData]) : postSchema

  return (
    <div>
      {structuredData ? structuredDataToScript(structuredData) : null}
      {/* Suspense와 PostDetailClient를 직접 사용 */}
      <Suspense
        fallback={
          <div className="container mx-auto px-4 pt-24 md:pt-28">
            <div className="max-w-4xl mx-auto">
              <div className="h-6 w-48 bg-gray-200 rounded mb-4 animate-pulse" />
              <div className="bg-white rounded-lg shadow p-6 animate-pulse">
                <div className="w-24 h-5 bg-gray-200 rounded mb-3" />
                <div className="w-3/4 h-8 bg-gray-200 rounded mb-4" />
                <div className="w-full h-24 bg-gray-200 rounded" />
              </div>
            </div>
          </div>
        }
      >
        <PostDetailClient postId={postId} initialData={resolvedInitialData} />
      </Suspense>
    </div>
  )
}
