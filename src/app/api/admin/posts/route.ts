import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { validateSearchQuery, escapePostgrestValue } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/posts',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_posts'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_POSTS_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ request, auth }) => {
    const { db } = auth

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all'
    const searchRaw = searchParams.get('search') || ''
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1, max: 10000 })
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 100 })
    const offset = (page - 1) * limit

    // 입력 검증
    let search = ''
    if (searchRaw) {
      const searchValidation = validateSearchQuery(searchRaw)
      if (!searchValidation.isValid) {
        logSecurityEvent(
          'INVALID_SEARCH_QUERY',
          {
            query: searchRaw,
            errors: searchValidation.errors,
          },
          'medium'
        )
        return ApiError.badRequest('유효하지 않은 검색어입니다.').toNextResponse()
      }
      search = searchValidation.sanitized
    }

    // 페이지 번호 검증
    if (page < 1 || page > 10000) {
      return ApiError.badRequest('유효하지 않은 페이지 번호입니다.').toNextResponse()
    }

    // 필터 값 검증
    const allowedFilters = ['all', 'deleted', 'pinned', '공지', '잡담', '홍보', '건의']
    if (!allowedFilters.includes(filter)) {
      return ApiError.badRequest('유효하지 않은 필터입니다.').toNextResponse()
    }

    // Build query based on filter
    let query = db
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
        is_deleted,
        is_pinned,
        pinned_at,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name,
          email
        )
      `
      )
      .order('created_at', { ascending: false })

    // Apply filter - STEP 1: Restore full filtering
    if (filter === 'deleted') {
      query = query.eq('is_deleted', true)
    } else if (filter === 'pinned') {
      query = query.eq('is_pinned', true)
    } else if (filter !== 'all') {
      query = query.eq('category', filter)
    }

    // Apply search (SQL 인젝션 방지를 위해 파라미터 바인딩 사용)
    if (search) {
      // 이스케이프 처리된 검색어 사용
      const escapedSearch = escapePostgrestValue(search)
      query = query.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: posts, error: postsError } = await query

    if (postsError) {
      console.error('Posts fetch error:', postsError)
      return ApiError.internalServerError(
        '게시글을 조회하는 중 오류가 발생했습니다.'
      ).toNextResponse()
    }

    // Get total count for pagination
    let countQuery = db.from('posts').select('id', { count: 'exact', head: true })

    if (filter === 'deleted') {
      countQuery = countQuery.eq('is_deleted', true)
    } else if (filter === 'pinned') {
      countQuery = countQuery.eq('is_pinned', true)
    } else if (filter !== 'all') {
      countQuery = countQuery.eq('category', filter)
    }

    if (search) {
      const escapedSearch = escapePostgrestValue(search)
      countQuery = countQuery.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    const { count, error: countError } = await countQuery

    if (countError) {
      console.error('Count fetch error:', countError)
      return ApiError.internalServerError(
        '게시글 수를 조회하는 중 오류가 발생했습니다.'
      ).toNextResponse()
    }

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)

    // Get all comment counts in one query instead of N+1 individual queries
    const postIds = posts.map(p => p.id)
    const { data: commentCounts } = await db
      .from('comments')
      .select('post_id')
      .in('post_id', postIds)

    // Build a count map
    const countMap = new Map<string, number>()
    for (const row of commentCounts || []) {
      countMap.set(row.post_id, (countMap.get(row.post_id) || 0) + 1)
    }

    const postsWithCommentCount = posts.map(post => ({
      ...post,
      comment_count: countMap.get(post.id) || 0,
    }))

    return ApiSuccess.ok({
      posts: postsWithCommentCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNext: page < totalPages,
      },
    })
  },
})
