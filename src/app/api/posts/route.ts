/**
 * 게시글 목록 조회 API
 * 새로운 API 래퍼 시스템 사용
 */

import { NextRequest } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { validateSearchQuery } from '@/utils/validation'
import {
  apiGet,
  ApiSuccess,
  ApiError,
  requireAuth,
  parsePaginationParams,
  parseSortParams,
  validateApiInput,
} from '@/utils/apiWrapper'

export const runtime = 'nodejs'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('posts'),
})

// 게시글 데이터 타입 정의
interface PostData {
  id: string
  title: string
  content: string
  content_format: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  like_count: number
  comment_count: number
  is_liked?: boolean
  author: {
    display_name: string
    email: string
  }
}

interface PostListResponse {
  posts: PostData[]
  pagination: {
    current_page: number
    total_pages: number
    total_count: number
    per_page: number
    has_next: boolean
    has_prev: boolean
  }
  filters: {
    category: string | null
    search: string | null
    sort_by: string
    sort_order: string
  }
}

// 🚀 성능 최적화: API 라우트 추가 캐싱 설정
export const revalidate = 60 // 60초 동안 결과 캐시

export async function GET(request: NextRequest) {
  // 로그인은 선택사항 (좋아요 상태 확인용)
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id || null // 로그인 상태는 선택사항

  return apiGet(
    async () => {
      // 🚀 성능 측정 시작
      const startTime = Date.now()
      console.log('📊 [PERFORMANCE] API 요청 시작:', { timestamp: new Date().toISOString() })

      // Rate limiting 적용
      const rateLimitResult = rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      // 로그인한 사용자만 회원 상태 확인
      let profile = null
      if (userId) {
        const { data: profileData } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', userId)
          .single()

        if (
          (profileData && profileData.registration_status !== 'approved') ||
          !profileData?.is_active
        ) {
          throw ApiError.forbidden('승인된 회원만 접근할 수 있습니다.')
        }
        profile = profileData
      }

      // 쿼리 파라미터 처리
      const { searchParams } = new URL(request.url)
      const category = searchParams.get('category') || '전체'
      const searchRaw = searchParams.get('search') || ''
      const includeLikes = searchParams.get('include_likes') !== 'false'

      // 페이지네이션 파라미터 파싱
      const { page, limit, offset } = parsePaginationParams(searchParams, 20, 50)

      // 정렬 파라미터 파싱
      const allowedSortFields = ['created_at', 'updated_at', 'like_count', 'title']
      const { orderBy: sortBy, orderDirection: sortOrder } = parseSortParams(
        searchParams,
        allowedSortFields,
        'created_at'
      )

      // 검색어 검증
      let search = ''
      if (searchRaw) {
        const searchValidation = validateSearchQuery(searchRaw)
        if (!searchValidation.isValid) {
          throw ApiError.badRequest(
            `유효하지 않은 검색어입니다: ${searchValidation.errors.join(', ')}`
          )
        }
        search = searchValidation.sanitized
      }

      // 허용된 카테고리 검증
      const allowedCategories = ['전체', '공지', '잡담', '홍보', '건의']
      validateApiInput(
        category,
        (cat): cat is string => allowedCategories.includes(cat),
        '유효하지 않은 카테고리입니다.'
      )

      // 🚀 최적화된 쿼리: 기본 게시글 정보 + 작성자 정보 조회
      let query = supabase
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
          display_name,
          email
        )
      `
        )
        .eq('is_deleted', false)

      // 카테고리 필터 적용
      if (category !== '전체') {
        query = query.eq('category', category)
      }

      // 검색어 적용
      if (search) {
        const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
        query = query.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
      }

      // 정렬 적용
      const ascending = sortOrder === 'asc'
      if (sortBy === 'created_at') {
        // 고정 게시글을 먼저 표시하고, 그 다음 생성일 순
        query = query.order('is_pinned', { ascending: false, nullsFirst: false })
        query = query.order('created_at', { ascending })
      } else {
        query = query.order(sortBy, { ascending })
      }

      // 페이지네이션 적용
      query = query.range(offset, offset + limit - 1)

      const { data: posts, error: postsError } = await query

      if (postsError) {
        throw new Error(`게시글 조회 실패: ${postsError.message}`)
      }

      // 🚀 성능 최적화: 배치로 모든 부가 정보 조회
      const postIds = (posts || []).map(post => post.id)

      if (postIds.length === 0) {
        // 게시글이 없는 경우 총 개수만 조회
        let countQuery = supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('is_deleted', false)

        if (category !== '전체') {
          countQuery = countQuery.eq('category', category)
        }

        if (search) {
          const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
          countQuery = countQuery.or(
            `title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`
          )
        }

        const { count } = await countQuery

        const result: PostListResponse = {
          posts: [],
          pagination: {
            current_page: page,
            total_pages: 0,
            total_count: count || 0,
            per_page: limit,
            has_next: false,
            has_prev: false,
          },
          filters: {
            category: category === '전체' ? null : category,
            search: search || null,
            sort_by: sortBy,
            sort_order: sortOrder,
          },
        }

        return ApiSuccess.ok(result, '게시글이 없습니다.')
      }

      // 🚀 병렬 처리: 댓글 수, 사용자 좋아요, 전체 개수를 동시에 조회
      const commentCountPromise = supabase
        .from('comments')
        .select('post_id')
        .in('post_id', postIds)
        .eq('is_deleted', false)

      const userLikesPromise =
        includeLikes && userId
          ? supabase
              .from('post_likes')
              .select('post_id')
              .in('post_id', postIds)
              .eq('user_id', userId)
          : Promise.resolve({ data: [] as { post_id: string }[] })

      let countQuery = supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)

      if (category !== '전체') {
        countQuery = countQuery.eq('category', category)
      }

      if (search) {
        const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
        countQuery = countQuery.or(
          `title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`
        )
      }

      const [{ data: commentCounts }, { data: userLikes }, { count, error: countError }] =
        await Promise.all([commentCountPromise, userLikesPromise, countQuery])

      if (countError) {
        throw new Error(`게시글 수 조회 실패: ${countError.message}`)
      }

      // 게시글별 댓글 수 계산
      const commentCountMap = new Map<string, number>()
      commentCounts?.forEach(comment => {
        const postId = comment.post_id
        commentCountMap.set(postId, (commentCountMap.get(postId) || 0) + 1)
      })

      // ✅ 좋아요 수는 posts.like_count 컬럼을 그대로 사용 (추가 쿼리 제거)

      // 사용자 좋아요 맵 생성
      const userLikesMap = new Map<string, boolean>()
      userLikes?.forEach(like => {
        userLikesMap.set(like.post_id, true)
      })

      // 🚀 최적화된 결과 조합
      const postsWithExtra = (posts || []).map(post => ({
        ...post,
        comment_count: commentCountMap.get(post.id) || 0,
        // like_count는 DB 컬럼값 사용
        like_count: (post as any).like_count || 0,
        is_liked: includeLikes ? userLikesMap.get(post.id) || false : undefined,
        author: Array.isArray(post.author) ? post.author[0] : post.author,
      })) as PostData[]

      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit)

      const result: PostListResponse = {
        posts: postsWithExtra,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
        filters: {
          category: category === '전체' ? null : category,
          search: search || null,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      }

      // 🚀 성능 측정 완료
      const endTime = Date.now()
      const duration = endTime - startTime
      console.log('📊 [PERFORMANCE] API 응답 완료:', {
        duration: `${duration}ms`,
        postsCount: postsWithExtra.length,
        totalCount,
        dbQueries: includeLikes && userId ? 4 : 3, // posts + commentCounts + userLikes(optional) + count
        cacheHit: false, // 첫 로드는 항상 cache miss
        timestamp: new Date().toISOString(),
      })

      return ApiSuccess.ok(result, `게시글 목록을 성공적으로 조회했습니다. (${duration}ms)`)
    },
    '/api/posts',
    {
      userId,
      cacheable: true,
      maxAge: 60, // 1분 캐시
    }
  )
}
