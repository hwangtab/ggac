import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostMetadata } from '@/lib/posts'
import PostDetailClient from './PostDetailClient'
import PostDetailClientBridge from './PostDetailClientBridge'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { generatePostOgImage } from '@/utils/imageUrl'
import { generatePostStructuredData, structuredDataToScript } from '@/utils/structuredData'

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
        title: '게시물을 찾을 수 없습니다 - 경기아트콜렉티브',
        description: '요청하신 게시물을 찾을 수 없습니다.',
      }
    }

    const { post, author, thumbnail, description, categoryEmoji, keywords } = metadata

    const title = `${categoryEmoji} [${post.category}] ${post.title} - 경기아트콜렉티브`

    // OG 이미지 생성 - 통합 유틸리티 사용
    const ogImageUrl = generatePostOgImage(thumbnail)

    return {
      title,
      description,
      keywords: keywords?.join(', '),
      authors: [{ name: author?.display_name || '경기아트콜렉티브' }],
      openGraph: {
        title,
        description,
        url: `https://ggac.kr/board/${postId}`,
        siteName: '경기아트콜렉티브',
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
        title,
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
      title: '게시물 - 경기아트콜렉티브',
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
        parent_id,
        author:member_profiles!comments_author_id_fkey (
          display_name
        )
      `
      )
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    const attachmentsQuery = supabaseAdmin
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    const [{ data: post, error: postError }, { data: comments = [] }, { data: attachments = [] }] =
      await Promise.all([postQuery, commentsQuery, attachmentsQuery])

    if (postError || !post) {
      console.error('서버 게시글 조회 오류:', postError)
      return null
    }

    return {
      post: {
        ...post,
        is_liked: false, // 서버에서는 기본값, 클라이언트에서 업데이트
        comment_count: comments.length,
        attachments_stats: {
          total_attachments: attachments.length,
          image_count: attachments.filter(att => att.file_type === 'image').length,
          document_count: attachments.filter(att => att.file_type === 'document').length,
          video_count: attachments.filter(att => att.file_type === 'video').length,
          audio_count: attachments.filter(att => att.file_type === 'audio').length,
        },
      },
      comments,
      attachments,
      author: post.author,
    }
  } catch (error) {
    console.error('초기 게시글 데이터 조회 실패:', error)
    return null
  }
}

// 서버 컴포넌트: 초기 데이터를 클라이언트에 전달
async function PostDetailServerData({ postId }: { postId: string }) {
  // Try edge-cached API first
  try {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') || 'https'
    const host = (h.get('x-forwarded-host') || h.get('host') || '') as string
    const url = `${proto}://${host}/api/board/post/${postId}`
    const res = await fetch(url, {
      next: {
        revalidate: 60,
        tags: ['board-post', postId, `comments-post-${postId}`, `attachments-post-${postId}`],
      },
    })
    if (res.ok) {
      const json = await res.json()
      return (
        <script
          id="initial-post-data"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
        />
      )
    }
  } catch (e) {
    console.warn('[PostDetail] API fetch failed, fallback to direct query:', e)
  }

  const initialData = await getInitialPostData(postId)

  if (!initialData) {
    return null
  }

  // 클라이언트 컴포넌트에 데이터 전달을 위해 script 태그로 삽입
  return (
    <script
      id="initial-post-data"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(initialData),
      }}
    />
  )
}

// 서버 컴포넌트 (메타데이터 생성용)
export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const postId = resolvedParams.id

  // 게시물 존재 여부 확인
  const metadata = await getPostMetadata(postId)

  if (!metadata) {
    notFound()
  }

  // 구조화된 데이터 생성
  const structuredData = generatePostStructuredData({
    id: postId,
    title: metadata.post.title,
    content: metadata.post.content,
    category: metadata.post.category,
    created_at: metadata.post.created_at,
    updated_at: metadata.post.updated_at,
    author: metadata.author,
    thumbnail: metadata.thumbnail,
  })

  return (
    <div>
      {structuredDataToScript(structuredData)}
      {/* 서버에서 초기 데이터 제공 (ISR 캐시됨) - 스트리밍을 위해 Suspense로 감싸기 */}
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
        <PostDetailServerData postId={postId} />
      </Suspense>

      {/* 클라이언트 컴포넌트로 하이브리드 렌더링 (브리지에서 DOM 스크립트 읽기) */}
      <PostDetailClientBridge postId={postId} />
    </div>
  )
}

// 기존 서버 컴포넌트 래퍼 제거: 클라이언트 브리지에서 처리
