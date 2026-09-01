import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { validateSearchQuery } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listProfiles, type RegistrationStatus, type ProfileRow } from '@/db/queries/profiles'

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
  handler: async ({ request }) => {
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

    // 회원 조회 (Turso). 정렬은 기존과 동일하게 created_at 내림차순 —
    // listProfiles가 이 정렬을 고정으로 보장한다(공개 인터페이스 참고).
    let rows: ProfileRow[]
    let total: number
    try {
      ;({ rows, total } = await listProfiles({
        status: filter === 'all' ? undefined : (filter as RegistrationStatus),
        search: search || undefined,
        limit,
        offset,
      }))
    } catch (error) {
      console.error('Members fetch error:', error)
      return ApiError.internalServerError(
        '회원 정보를 조회하는 중 오류가 발생했습니다.'
      ).toNextResponse()
    }

    // 응답 필드를 이전 select 목록과 정확히 동일하게 좁힌다 — ProfileRow는
    // 33개 컬럼 전부를 담지만, 이전 Supabase 쿼리는 29개만 골라 보냈다
    // (birth_date/approved_at/is_member/artist_role 미포함). 프런트
    // `Member` 타입(admin/members/page.tsx)이 이 29개와 정확히 일치한다.
    const members = rows.map(row => ({
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      phone_number: row.phone_number,
      real_name: row.real_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      registration_status: row.registration_status,
      is_active: row.is_active,
      is_admin: row.is_admin,
      is_director: row.is_director,
      director_title: row.director_title,
      is_auditor: row.is_auditor,
      is_artist: row.is_artist,
      artist_id: row.artist_id,
      monthly_fee: row.monthly_fee,
      bank_name: row.bank_name,
      account_number: row.account_number,
      account_holder: row.account_holder,
      last_login_at: row.last_login_at,
      is_suspended: row.is_suspended,
      suspension_reason: row.suspension_reason,
      suspension_until: row.suspension_until,
      profile_completeness_score: row.profile_completeness_score,
      verification_status: row.verification_status,
      membership_type: row.membership_type,
      engagement_score: row.engagement_score,
      approved_by: row.approved_by,
      rejected_by: row.rejected_by,
      // 탈퇴 신청 여부 판단용 — registration_status는 신청 중에도 'approved'로
      // 남으므로(0011 참조) 화면이 이 필드로 신청 상태를 구분한다.
      withdrawal_requested_at: row.withdrawal_requested_at,
    }))

    // 페이지네이션 정보 계산
    const totalPages = Math.ceil(total / limit)
    const hasNext = page < totalPages

    return ApiSuccess.ok({
      members,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: total,
        hasNext,
      },
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
