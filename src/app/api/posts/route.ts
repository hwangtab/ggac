/**
 * 게시글 목록 조회 API - 단순 페이지 기반
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { fetchBoardPosts } from '@/lib/server/board'
import { parseIntegerParam } from '@/utils/queryParams'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import { getBoardListRevalidationPaths } from '@/lib/revalidationPaths'

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
  // 로그인 여부에 따라 개인화 데이터(내 좋아요 여부)를 얹는 선택적 조회다.
  // 비로그인도 게시글 목록을 읽을 수 있어야 하므로 requireUser로 바꾸지 않는다.
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

  // 레이트리밋은 원래도 인증 확인보다 먼저 검사했다 — 순서를 그대로 유지한다.
  const rateLimiter = await applyRateLimit({
    ...RATE_LIMIT_CONFIGS.GENERAL_API,
    keyGenerator: createUserKeyGenerator('posts:create'),
  })
  const rateLimitResult = await rateLimiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  // 게시글 작성은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
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
      // content_format은 항상 'html' → 저장 전 본문 이미지 크기 주입(CLS 방지). 절대 throw 안 함.
      const contentToSave = await annotateImageDimensionsSafe(content)
      const { data: post, error: insertError } = await supabase
        .from('posts')
        .insert({
          title,
          content: contentToSave,
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
        // ko는 URL에 접두사가 없지만 렌더는 내부 rewrite된 `/ko/board`에서
        // 일어나므로 `/board`로는 무효화되지 않는다. 자세한 배경은
        // @/lib/revalidationPaths 참고.
        for (const boardPath of getBoardListRevalidationPaths()) {
          revalidatePath(boardPath)
        }
        revalidateTag('board-post')
        revalidateTag('board-initial')
        revalidateTag(`board-${category}`)
      } catch {
        // Cache invalidation must not turn a successful database write into a failed create.
      }

      return ApiSuccess.created(post, '게시글이 작성되었습니다.')
    },
    '/api/posts',
    { userId: user.id }
  )
}
