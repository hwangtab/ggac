import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { validateSearchQuery } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { listPostsForAdmin } from '@/db/queries/posts'

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
  handler: async ({ request }) => {
    // Get query parameters
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all'
    const searchRaw = searchParams.get('search') || ''
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1, max: 10000 })
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 100 })

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

    // Task 8: posts/comments 조회를 Supabase에서 Turso 쿼리 계층
    // (listPostsForAdmin, src/db/queries/posts.ts)로 옮겼다. 필터 의미는
    // 그대로 보존한다 — 'deleted'만 is_deleted=true로 좁히고, 'all'·'pinned'·
    // 카테고리는 is_deleted를 전혀 필터링하지 않는다(삭제된 글도 섞여
    // 나온다 — 기존 동작 그대로). 댓글 수는 게시글마다 쿼리하지 않고 배치로
    // 붙는다(countCommentsByPostIds). total은 count(*) over()가 아니라 별도
    // COUNT 쿼리라 마지막 페이지를 넘겨도 0으로 떨어지지 않는다
    // (task-8-brief의 "listPosts.total 경계" 경고 대상이 바로 이 화면).
    let postsWithCommentCount, totalCount
    try {
      const result = await listPostsForAdmin({ filter, search, page, limit })
      postsWithCommentCount = result.rows
      totalCount = result.total
    } catch (error) {
      console.error('Posts fetch error:', error)
      return ApiError.internalServerError(
        '게시글을 조회하는 중 오류가 발생했습니다.'
      ).toNextResponse()
    }

    const totalPages = Math.ceil(totalCount / limit)

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
