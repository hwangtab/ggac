/**
 * 멤버 고급 검색 API
 * 복합 필터링, 정렬, 전체 텍스트 검색을 지원하는 고급 검색 기능
 */

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { requireAdmin } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { validateAdvancedSearchQuery, buildSearchQuery } from '@/utils/advancedFiltering'
import type { AdvancedSearchQuery, FilteredResult, FieldDefinition } from '@/types'
import { parseJsonObjectBody } from '@/utils/requestBody'

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

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('members_advanced_search'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // 요청 본문 파싱
    const searchQuery = (await parseJsonObjectBody(request)) as AdvancedSearchQuery | null
    if (!searchQuery) {
      return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
    }

    // 쿼리 검증
    const validation = validateAdvancedSearchQuery(searchQuery, MEMBER_FIELD_DEFINITIONS)
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: '잘못된 검색 쿼리입니다.',
          details: validation.errors,
        },
        { status: 400 }
      )
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

    // SQL 쿼리 생성
    const baseQuery = `
      member_profiles mp
      LEFT JOIN artists a ON mp.artist_id = a.legacy_id
      LEFT JOIN (
        SELECT author_id, COUNT(*) as post_count 
        FROM posts 
        WHERE is_deleted = false 
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

      // 병렬로 데이터와 총 개수 조회
      const [dataResult, countResult] = await Promise.all([
        db.rpc('execute_advanced_search', {
          query_sql: dataQuery,
          query_params: params,
        }),
        db.rpc('execute_advanced_search', {
          query_sql: countSql,
          query_params: params,
        }),
      ])

      if (dataResult.error) {
        console.error('데이터 조회 오류:', dataResult.error)
        return createErrorResponse({ success: false, error: '검색 중 오류가 발생했습니다.' }, 500)
      }

      if (countResult.error) {
        console.error('카운트 조회 오류:', countResult.error)
        return createErrorResponse({ success: false, error: '검색 중 오류가 발생했습니다.' }, 500)
      }

      const members = dataResult.data || []
      const totalCount = countResult.data?.[0]?.total || 0
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

      const response = NextResponse.json(result)
      return addRateLimitHeaders(
        response,
        RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      )
    } catch (queryError) {
      console.error('쿼리 실행 오류:', queryError)
      return createErrorResponse(
        { success: false, error: '검색 쿼리 실행 중 오류가 발생했습니다.' },
        500
      )
    }
  } catch (error) {
    console.error('고급 검색 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}

// 필드 정의 조회 API
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('members_advanced_search'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const response = NextResponse.json({
      fields: MEMBER_FIELD_DEFINITIONS,
      target: 'members',
      description: '멤버 고급 검색을 위한 필드 정의',
    })
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('필드 정의 조회 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}
