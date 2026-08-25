/**
 * 멤버 고급 검색 API
 * 복합 필터링, 정렬, 전체 텍스트 검색을 지원하는 고급 검색 기능
 */

import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateAdvancedSearchQuery, buildSearchQuery } from '@/utils/advancedFiltering'
import { executeMemberAdvancedSearch } from '@/db/queries/misc'
import type { AdvancedSearchQuery, FilteredResult, FieldDefinition } from '@/types'

// 멤버 필드 정의
const MEMBER_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    name: 'display_name',
    label: '표시명',
    type: 'string',
    filterable: true,
    sortable: true,
    searchable: true,
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
    defaultOperator: 'contains',
  },
  {
    name: 'real_name',
    label: '실명',
    type: 'string',
    filterable: true,
    sortable: true,
    searchable: true,
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
    defaultOperator: 'contains',
  },
  {
    name: 'email',
    label: '이메일',
    type: 'string',
    filterable: true,
    sortable: true,
    searchable: true,
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
    defaultOperator: 'contains',
  },
  {
    name: 'registration_status',
    label: '가입 상태',
    type: 'select',
    filterable: true,
    sortable: true,
    searchable: false,
    options: [
      { value: 'pending', label: '승인 대기' },
      { value: 'approved', label: '승인됨' },
      { value: 'rejected', label: '거부됨' },
    ],
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    defaultOperator: 'equals',
  },
  {
    name: 'is_artist',
    label: '아티스트 여부',
    type: 'boolean',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals'],
    defaultOperator: 'equals',
  },
  {
    name: 'is_admin',
    label: '관리자 여부',
    type: 'boolean',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals'],
    defaultOperator: 'equals',
  },
  {
    name: 'is_active',
    label: '활성 상태',
    type: 'boolean',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals'],
    defaultOperator: 'equals',
  },
  {
    name: 'phone_number',
    label: '연락처',
    type: 'string',
    filterable: true,
    sortable: false,
    searchable: true,
    operators: ['equals', 'not_equals', 'contains', 'not_contains'],
    defaultOperator: 'contains',
  },
  {
    name: 'membership_type',
    label: '멤버십 유형',
    type: 'select',
    filterable: true,
    sortable: true,
    searchable: false,
    options: [
      { value: 'regular', label: '일반' },
      { value: 'premium', label: '프리미엄' },
      { value: 'lifetime', label: '종신' },
    ],
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    defaultOperator: 'equals',
  },
  {
    name: 'artist_id',
    label: '아티스트 ID',
    type: 'string',
    filterable: true,
    sortable: false,
    searchable: false,
    operators: ['equals', 'not_equals', 'is_null', 'is_not_null'],
    defaultOperator: 'equals',
  },
  {
    name: 'artist_role',
    label: '아티스트 역할',
    type: 'select',
    filterable: true,
    sortable: true,
    searchable: false,
    options: [
      { value: 'owner', label: '소유자' },
      { value: 'manager', label: '관리자' },
      { value: 'collaborator', label: '협력자' },
    ],
    operators: ['equals', 'not_equals', 'in', 'not_in', 'is_null', 'is_not_null'],
    defaultOperator: 'equals',
  },
  {
    name: 'created_at',
    label: '가입일',
    type: 'date',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between'],
    defaultOperator: 'greater_equal',
  },
  {
    name: 'updated_at',
    label: '수정일',
    type: 'date',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between'],
    defaultOperator: 'greater_equal',
  },
  {
    name: 'last_login_at',
    label: '마지막 로그인',
    type: 'date',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: [
      'equals',
      'greater_than',
      'greater_equal',
      'less_than',
      'less_equal',
      'between',
      'is_null',
      'is_not_null',
    ],
    defaultOperator: 'greater_equal',
  },
  {
    name: 'suspension_until',
    label: '정지 해제일',
    type: 'date',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: [
      'equals',
      'greater_than',
      'greater_equal',
      'less_than',
      'less_equal',
      'between',
      'is_null',
      'is_not_null',
    ],
    defaultOperator: 'greater_equal',
  },
]

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
      pagination: {
        page: 1,
        limit: 20,
        ...searchQuery.pagination,
      },
    }

    // SQL 쿼리 생성. Task 4: execute_advanced_search RPC(Postgres) 대체로
    // src/db/queries/misc.ts의 executeMemberAdvancedSearch(SQLite/Turso)를
    // 쓴다 — 그 함수 JSDoc 참고. `artists`를 직접 LEFT JOIN하지 않고 서브쿼리로
    // 좁혀 member_profiles와 겹치는 created_at/updated_at 컬럼명의 모호성을
    // 피한다(선택 컬럼은 원본과 동일하게 a.name/a.slug뿐이다). `is_deleted =
    // false`는 SQLite 정수 불리언 표현인 `is_deleted = 0`으로 바꿨다.
    const baseQuery = `
      member_profiles mp
      LEFT JOIN (SELECT legacy_id, name, slug FROM artists) a ON mp.artist_id = a.legacy_id
      LEFT JOIN (
        SELECT author_id, COUNT(*) as post_count
        FROM posts
        WHERE is_deleted = 0
        GROUP BY author_id
      ) p ON mp.id = p.author_id
      LEFT JOIN (
        SELECT author_id, COUNT(*) as comment_count
        FROM comments
        GROUP BY author_id
      ) c ON mp.id = c.author_id
    `

    const allowedFields = MEMBER_FIELD_DEFINITIONS.map(field => field.name)

    try {
      const { sql, params, countSql } = buildSearchQuery(query, baseQuery, allowedFields)

      // 데이터 조회 쿼리 (추가 필드 포함)
      const dataQuery = sql.replace(
        'SELECT * FROM',
        `SELECT 
          mp.id, mp.display_name, mp.real_name, mp.email, mp.phone_number,
          mp.registration_status, mp.is_artist, mp.is_admin, mp.is_active,
          mp.membership_type, mp.artist_id, mp.artist_role,
          mp.created_at, mp.updated_at, mp.last_login_at, mp.suspension_until,
          a.name as artist_name, a.slug as artist_slug,
          COALESCE(p.post_count, 0) as post_count,
          COALESCE(c.comment_count, 0) as comment_count
        FROM`
      )

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
