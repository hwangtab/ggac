import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { validateSearchQuery, escapePostgrestValue } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 회원 목록 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/members',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_members'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MEMBERS_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError(
      '회원 정보를 조회하는 중 오류가 발생했습니다.'
    ).toNextResponse()
  },
  handler: async ({ request, auth }) => {
    const { db } = auth

    // 쿼리 파라미터 추출 및 검증
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all'
    const searchRaw = searchParams.get('search') || ''
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1, max: 10000 })
    const limit = parseIntegerParam(searchParams.get('limit'), 50, { min: 1, max: 100 })
    const offset = (page - 1) * limit

    // 입력 검증
    let search = ''
    if (searchRaw) {
      const searchValidation = validateSearchQuery(searchRaw)
      if (!searchValidation.isValid) {
        logSecurityEvent(
          'INVALID_MEMBER_SEARCH',
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
    const allowedFilters = ['all', 'pending', 'approved', 'rejected']
    if (!allowedFilters.includes(filter)) {
      return ApiError.badRequest('유효하지 않은 필터입니다.').toNextResponse()
    }

    // 기본 쿼리 구성 (서비스 롤 클라이언트로 RLS 우회)
    let query = db.from('member_profiles').select(
      `
        id,
        display_name,
        email,
        phone_number,
        real_name,
        created_at,
        updated_at,
        registration_status,
        is_active,
        is_admin,
        is_director,
        director_title,
        is_auditor,
        is_artist,
        artist_id,
        monthly_fee,
        bank_name,
        account_number,
        account_holder,
        last_login_at,
        is_suspended,
        suspension_reason,
        suspension_until,
        profile_completeness_score,
        verification_status,
        membership_type,
        engagement_score,
        approved_by,
        rejected_by
      `,
      { count: 'exact' }
    )

    // 필터 적용
    if (filter !== 'all') {
      query = query.eq('registration_status', filter)
    }

    // 검색 적용 (SQL 인젝션 방지)
    if (search) {
      const escapedSearch = escapePostgrestValue(search)
      query = query.or(
        `display_name.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%,real_name.ilike.%${escapedSearch}%`
      )
    }

    // 정렬 및 페이지네이션
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: members, error: membersError, count } = await query

    if (membersError) {
      console.error('Members fetch error:', membersError)
      return ApiError.internalServerError(
        '회원 정보를 조회하는 중 오류가 발생했습니다.'
      ).toNextResponse()
    }

    // 페이지네이션 정보 계산
    const totalPages = Math.ceil((count || 0) / limit)
    const hasNext = page < totalPages

    return ApiSuccess.ok({
      members: members || [],
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: count || 0,
        hasNext,
      },
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
