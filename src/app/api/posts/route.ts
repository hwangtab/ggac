/**
 * 게시글 목록 조회 API - 단순 페이지 기반
 */

import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { apiGet, ApiSuccess, ApiError, validateApiInput } from '@/utils/apiWrapper'
import { fetchBoardPosts } from '@/lib/server/board'

export const runtime = 'nodejs'
export const revalidate = 60

const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('posts'),
})

interface PostData {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  comment_count: number
  like_count?: number
  is_liked?: boolean
  author: {
    display_name: string
    email: string
  }
  attachments_stats?: any
  content_preview?: string
  preview_has_images?: boolean
  preview_image_count?: number
}

interface PostListResponse {
  posts: PostData[]
  pagination: {
    limit: number
    has_next: boolean
    has_prev: boolean
    next_cursor: string | null
    prev_cursor: string | null
  }
  filters: {
    category: string | null
    search: string | null
    sort_by: string
    sort_order: string
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id || null

  return apiGet(
    async () => {
      const rateLimitResult = rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      const { searchParams } = new URL(request.url)
      const category = searchParams.get('category') || '전체'
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)
      const direction = searchParams.get('direction') || 'next'
      const pageParam = searchParams.get('page')
      const cursorParam = searchParams.get('cursor')

      let page = Number(pageParam || cursorParam || '1')
      if (!Number.isFinite(page) || page < 1) {
        page = 1
      }
      if (direction === 'prev') {
        page = Math.max(1, page - 1)
      }

      const allowedCategories = ['전체', '공지', '잡담', '홍보', '건의']
      validateApiInput(
        category,
        (cat): cat is string => allowedCategories.includes(cat),
        '유효하지 않은 카테고리입니다.'
      )

      const boardResult = await fetchBoardPosts({ category, page, pageSize: limit })
      const postIds = boardResult.posts.map(post => post.id)

      let userLikedSet = new Set<string>()
      if (userId && postIds.length > 0) {
        const { data: likedRows } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('user_id', userId)
          .in('post_id', postIds)
        if (likedRows) {
          userLikedSet = new Set(likedRows.map(row => row.post_id))
        }
      }

      const posts: PostData[] = boardResult.posts.map(post => ({
        id: post.id,
        title: post.title,
        content: '',
        category: post.category,
        author_id: post.author_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        is_pinned: post.is_pinned,
        comment_count: post.comment_count,
        like_count: post.like_count,
        is_liked: userLikedSet.has(post.id),
        author: {
          display_name: post.author?.display_name || '알 수 없음',
          email: '',
        },
        attachments_stats: post.attachments_stats,
        content_preview: post.content_preview,
        preview_has_images: post.preview_has_images,
        preview_image_count: post.preview_image_count,
      }))

      const result: PostListResponse = {
        posts,
        pagination: {
          limit,
          has_next: boardResult.hasNext,
          has_prev: boardResult.hasPrev,
          next_cursor: boardResult.hasNext ? String(boardResult.currentPage + 1) : null,
          prev_cursor: boardResult.hasPrev
            ? String(Math.max(1, boardResult.currentPage - 1))
            : null,
        },
        filters: {
          category: category === '전체' ? null : category,
          search: null,
          sort_by: 'created_at',
          sort_order: 'desc',
        },
      }

      return ApiSuccess.ok(result, '게시글 목록을 불러왔습니다.')
    },
    '/api/posts',
    { userId: userId || undefined }
  )
}
