/**
 * 멤버 고급 검색 API
 * 복합 필터링, 정렬, 전체 텍스트 검색을 지원하는 고급 검색 기능
 */

import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import {
  validateAdvancedSearchQuery,
  buildSearchQuery,
  normalizeConditionTypes,
} from '@/utils/advancedFiltering'
import { executeMemberAdvancedSearch } from '@/db/queries/misc'
// 필드 화이트리스트·FROM 절·조회 컬럼은 라우트 밖(`src/constants/memberSearchFields.ts`)에
// 산다 — 그래야 단위 테스트가 그 계약을 **베끼지 않고** 그대로 import해서 검증한다
// (단계 4 리뷰 1회차 Important 5). 라우트 파일은 `@/` 별칭을 써서 node 테스트
// 러너가 import할 수 없다.
import {
  MEMBER_FIELD_DEFINITIONS,
  MEMBER_SEARCH_ALLOWED_FIELDS,
  MEMBER_SEARCH_BASE_QUERY,
  buildMemberSearchDataQuery,
} from '@/constants/memberSearchFields'
import type { AdvancedSearchQuery, FilteredResult } from '@/types'

export const POST = defineApiRoute<AdvancedSearchQuery>({
  method: 'POST',
  name: 'api/admin/members/advanced-search',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('members_advanced_search'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: error => {
    console.error('고급 검색 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body: searchQuery }) => {
    // 쿼리 검증
    const validation = validateAdvancedSearchQuery(searchQuery, MEMBER_FIELD_DEFINITIONS)
    if (!validation.isValid) {
      return ApiError.badRequest('잘못된 검색 쿼리입니다.').toNextResponse()
    }

    // 기본값 설정
    const query = {
      ...searchQuery,
      // 값 타입은 **서버가 정한다.** 클라이언트가 보낸 `type` 힌트를 그대로 쓰면
      // 힌트가 빠지거나 틀렸을 때 변환이 건너뛰어져, SQLite에서 boolean 필터가
      // 항상 0건이 되고 날짜 필터가 조용히 무효화된다(2026-09-01 감사).
      filters: searchQuery.filters
        ? normalizeConditionTypes(searchQuery.filters, MEMBER_FIELD_DEFINITIONS)
        : searchQuery.filters,
      pagination: {
        page: 1,
        limit: 20,
        ...searchQuery.pagination,
      },
    }

    try {
      const { sql, params, countSql } = buildSearchQuery(
        query,
        MEMBER_SEARCH_BASE_QUERY,
        MEMBER_SEARCH_ALLOWED_FIELDS
      )

      // 데이터 조회 쿼리 (추가 필드 포함)
      const dataQuery = buildMemberSearchDataQuery(sql)

      // 데이터와 총 개수를 한 번에 조회(내부적으로 병렬 실행 — misc.ts 참고)
      let members: Record<string, unknown>[]
      let totalCount: number
      try {
        const result = await executeMemberAdvancedSearch(dataQuery, countSql, params)
        members = result.rows
        totalCount = result.total
      } catch (searchError) {
        console.error('검색 조회 오류:', searchError)
        return ApiError.internalServerError('검색 중 오류가 발생했습니다.').toNextResponse()
      }

      const { page, limit } = query.pagination!
      const totalPages = Math.ceil(totalCount / limit)

      const result: FilteredResult = {
        data: members,
        total: totalCount,
        filtered: members.length,
        pagination: {
          page,
          limit,
          total_pages: totalPages,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
        applied_filters: query.filters || { operator: 'AND', conditions: [] },
        applied_sorts: query.sorts || [],
      }

      return ApiSuccess.ok(result)
    } catch (queryError) {
      console.error('쿼리 실행 오류:', queryError)
      return ApiError.internalServerError('검색 쿼리 실행 중 오류가 발생했습니다.').toNextResponse()
    }
  },
})

// 필드 정의 조회 API
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/members/advanced-search.fields',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('members_advanced_search'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: error => {
    console.error('필드 정의 조회 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  },
  handler: async () => {
    return ApiSuccess.ok({
      fields: MEMBER_FIELD_DEFINITIONS,
      target: 'members',
      description: '멤버 고급 검색을 위한 필드 정의',
    })
  },
})
