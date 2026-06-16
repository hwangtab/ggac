/**
 * 게시글 목록 조회 API - 단순 페이지 기반
 */

import { NextRequest } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { fetchBoardPosts } from '@/lib/server/board'
import { parseIntegerParam } from '@/utils/queryParams'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const revalidate = 60

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
      const rateLimiter = await applyRateLimit({
        ...RATE_LIMIT_CONFIGS.GENERAL_API,
        keyGenerator: createUserKeyGenerator('posts'),
      })
      const rateLimitResult = await rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      const { searchParams } = new URL(request.url)
      const categoryParam = searchParams.get('category') || '전체'
      const boardCategory = parseBoardCategory(categoryParam)
      const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 50 })
      const direction = searchParams.get('direction') || 'next'
      const pageParam = searchParams.get('page')
      const cursorParam = searchParams.get('cursor')

      let page = parseIntegerParam(pageParam ?? cursorParam, 1, { min: 1 })
      if (direction === 'prev') {
        page = Math.max(1, page - 1)
      }

      if (!boardCategory) {
        throw ApiError.badRequest('유효하지 않은 카테고리입니다.')
      }

      const boardResult = await fetchBoardPosts({ category: boardCategory, page, pageSize: limit })
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
          category: boardCategory === '전체' ? null : boardCategory,
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

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  const userId = user?.id || null

  return apiPost(
    async () => {
      const rateLimiter = await applyRateLimit({
        ...RATE_LIMIT_CONFIGS.GENERAL_API,
        keyGenerator: createUserKeyGenerator('posts:create'),
      })
      const rateLimitResult = await rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      if (authError || !user) {
        throw ApiError.unauthorized('로그인이 필요합니다.')
      }

      const { data: profile, error: profileError } = await supabase
        .from('member_profiles')
        .select('registration_status, is_active')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        throw ApiError.notFound('사용자 정보를 찾을 수 없습니다.')
      }

      if (profile.registration_status !== 'approved' || !profile.is_active) {
        throw ApiError.forbidden('승인된 활성 멤버만 게시글을 작성할 수 있습니다.')
      }

      const body = await parseJsonObjectBody(request)
      if (!body) {
        throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      }

      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content : ''
      const category = parseBoardCategory(body.category)

      if (!title) {
        throw ApiError.badRequest('제목을 입력해주세요.')
      }

      if (!content.trim()) {
        throw ApiError.badRequest('내용을 입력해주세요.')
      }

      if (!category || category === CATEGORIES.BOARD.ALL) {
        throw ApiError.badRequest('게시글 카테고리를 선택해주세요.')
      }

      const isPinned = category === '공지'
      const { data: post, error: insertError } = await supabase
        .from('posts')
        .insert({
          title,
          content,
          content_format: 'html',
          category,
          author_id: user.id,
          is_pinned: isPinned,
          pinned_at: isPinned ? new Date().toISOString() : null,
        } as never)
        .select()
        .single()

      if (insertError || !post) {
        throw ApiError.badRequest(insertError?.message || '게시글 작성에 실패했습니다.')
      }

      try {
        revalidatePath('/board')
        revalidatePath('/en/board')
        revalidateTag('board-post')
        revalidateTag('board-initial')
        revalidateTag(`board-${category}`)
      } catch {
        // Cache invalidation must not turn a successful database write into a failed create.
      }

      return ApiSuccess.created(post, '게시글이 작성되었습니다.')
    },
    '/api/posts',
    { userId: userId || undefined }
  )
}
