import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostMetadata } from '@/lib/posts'
import PostDetailClient from './PostDetailClient'
import { Suspense } from 'react'

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

    const { post, author, thumbnail, description, categoryEmoji } = metadata

    const title = `${categoryEmoji} [${post.category}] ${post.title} - 경기아트콜렉티브`

    // 직접 이미지 URL 사용 (API 라우트 우회)
    const ogImageUrl = thumbnail
      ? thumbnail.startsWith('http')
        ? thumbnail
        : `https://ggac.kr${thumbnail}`
      : 'https://ggac.kr/images/logo/gac_og.webp'

    return {
      title,
      description,
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
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )

  try {
    // 게시글 기본 정보 조회
    const { data: post, error: postError } = await supabaseAdmin
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
      .or('is_deleted.is.false,is_deleted.is.null')
      .single()

    if (postError || !post) {
      console.error('서버 게시글 조회 오류:', postError)
      return null
    }

    // 댓글 조회
    const { data: comments = [] } = await supabaseAdmin
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

    // 첨부파일 조회
    const { data: attachments = [] } = await supabaseAdmin
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

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

  return (
    <div>
      {/* 서버에서 초기 데이터 제공 (ISR 캐시됨) */}
      <PostDetailServerData postId={postId} />

      {/* 클라이언트 컴포넌트로 하이브리드 렌더링 */}
      <Suspense
        fallback={
          <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
            <div className="text-gray-600">게시글을 로드하는 중...</div>
          </div>
        }
      >
        <PostDetailClientWrapper postId={postId} />
      </Suspense>
    </div>
  )
}

// 클라이언트 데이터 읽기 및 PostDetailClient에 전달하는 래퍼
function PostDetailClientWrapper({ postId }: { postId: string }) {
  // 서버에서 제공한 초기 데이터 읽기
  const initialDataScript =
    typeof document !== 'undefined'
      ? document.getElementById('initial-post-data')?.textContent
      : null

  const initialData = initialDataScript ? JSON.parse(initialDataScript) : undefined

  return <PostDetailClient postId={postId} initialData={initialData} />
}
