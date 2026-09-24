import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { validateSearchQuery } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listProfiles, type RegistrationStatus, type ProfileRow } from '@/db/queries/profiles'
import { toMemberListRow } from '@/lib/members/memberListRow'

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

    // 응답에 실을 것은 `toMemberListRow`가 하나씩 골라 적는다
    // (`src/lib/members/memberListRow.ts`). **계좌 세 칸은 빠진다** — 목록
    // 한 번이 곧 전 조합원 계좌의 대량 조회였고 흔적도 남지 않았다. 목록은
    // 등록됐는가의 참·거짓(`bank_account_registered`)만 주고, 값은
    // `GET /api/admin/members/[id]/account`에서 한 사람씩 기록과 함께 나간다.
    const members = rows.map(toMemberListRow)

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
