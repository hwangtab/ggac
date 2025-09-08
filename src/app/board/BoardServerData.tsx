// 서버 컴포넌트: 초기 게시글 데이터를 ISR로 제공
import { createClient } from '@supabase/supabase-js'
import { createTextPreview } from '@/utils/textUtils'
import type { Post } from '@/types'

// ISR 설정 - 60초마다 재검증
export const revalidate = 60

interface ServerDataProps {
  category?: string
  limit?: number
}

interface InitialPostsData {
  posts: Post[]
  hasNext: boolean
  nextCursor: string | null
}

// 서버 사이드에서 초기 게시글 데이터 조회
async function getInitialPosts(
  category: string = '전체',
  limit: number = 20
): Promise<InitialPostsData> {
  // Service role 클라이언트 생성 (서버에서만 사용)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    console.error('NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다')
    return { posts: [], hasNext: false, nextCursor: null }
  }

  const supabaseAdmin = key
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
        auth: { autoRefreshToken: false, persistSession: false },
      })

  try {
    let query = supabaseAdmin
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
        is_pinned,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
      )
      .not('is_deleted', 'is', true)

    // 카테고리 필터 적용
    if (category !== '전체') {
      query = query.eq('category', category)
    }

    // 정렬 및 제한
    query = query
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // 다음 페이지 존재 여부 확인을 위해 +1

    const { data: posts, error } = await query

    if (error) {
      console.error('서버 게시글 조회 오류:', error)
      return {
        posts: [],
        hasNext: false,
        nextCursor: null,
      }
    }

    const actualPosts = posts || []
    const hasNext = actualPosts.length > limit

    if (hasNext) {
      actualPosts.pop() // 초과분 제거
    }

    let nextCursor: string | null = null
    if (hasNext && actualPosts.length > 0) {
      const lastPost = actualPosts[actualPosts.length - 1]
      // ISO 타임스탬프에 콜론이 포함되므로 파이프(|)를 구분자로 사용
      nextCursor = `${encodeURIComponent(lastPost.created_at)}|${lastPost.id}`
    }

    // 미리보기 텍스트 생성 및 정리 (HTML 태그 제거 + 이미지 정보 추출)
    const processedPosts = actualPosts.map(post => {
      const preview = createTextPreview(post.content || '', 150)
      // 클라이언트로 보내는 초기 데이터는 필요한 필드만 유지하여 페이로드 최소화
      return {
        id: post.id,
        title: post.title,
        content: '', // 대용량 본문은 초기 페이로드에서 제외
        content_format: post.content_format,
        category: post.category,
        author_id: post.author_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        is_pinned: post.is_pinned,
        like_count: post.like_count,
        author: post.author,
        // 미리보기/첨부 통계는 서버에서 계산해 전달
        content_preview: preview.text,
        preview_has_images: preview.hasImages,
        preview_image_count: preview.imageCount,
        comment_count: 0, // 초기값, 클라이언트에서 업데이트
        is_liked: false, // 초기값, 클라이언트에서 업데이트
        attachments_stats: {
          total_attachments: 0,
          image_count: 0,
          document_count: 0,
          video_count: 0,
          audio_count: 0,
        },
      } as unknown as Post
    })

    return {
      posts: processedPosts,
      hasNext,
      nextCursor,
    }
  } catch (error) {
    console.error('초기 게시글 데이터 조회 실패:', error)
    console.error('카테고리:', category, '제한:', limit)
    return {
      posts: [],
      hasNext: false,
      nextCursor: null,
    }
  }
}

// 서버 컴포넌트
export default async function BoardServerData({ category = '전체', limit = 20 }: ServerDataProps) {
  const initialData = await getInitialPosts(category, limit)

  // 클라이언트 컴포넌트에 데이터 전달을 위해 script 태그로 삽입
  return (
    <script
      id="initial-posts-data"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(initialData),
      }}
    />
  )
}
