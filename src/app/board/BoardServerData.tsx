// 서버 컴포넌트: 초기 게시글 데이터를 ISR로 제공
import { createClient } from '@supabase/supabase-js'
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
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )

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
      .or('is_deleted.is.false,is_deleted.is.null')

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
      nextCursor = `${lastPost.created_at}:${lastPost.id}`
    }

    // 미리보기 텍스트 생성 및 정리
    const processedPosts = actualPosts.map(post => ({
      ...post,
      content_preview: post.content?.substring(0, 150) + '...' || '',
      preview_has_images: false, // 서버에서는 간단하게 처리
      preview_image_count: 0,
      comment_count: 0, // 초기값, 클라이언트에서 업데이트
      is_liked: false, // 초기값, 클라이언트에서 업데이트
      attachments_stats: {
        total_attachments: 0,
        image_count: 0,
        document_count: 0,
        video_count: 0,
        audio_count: 0,
      },
    })) as unknown as Post[]

    return {
      posts: processedPosts,
      hasNext,
      nextCursor,
    }
  } catch (error) {
    console.error('초기 게시글 데이터 조회 실패:', error)
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
