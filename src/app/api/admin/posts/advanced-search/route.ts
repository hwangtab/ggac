/**
 * 게시글 고급 검색 API
 * 복합 필터링, 정렬, 전체 텍스트 검색을 지원하는 고급 검색 기능
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { validateAdvancedSearchQuery, buildSearchQuery } from '@/utils/advancedFiltering'
import type { AdvancedSearchQuery, FilteredResult, FieldDefinition } from '@/types'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.ADMIN_API,
  keyGenerator: createUserKeyGenerator('posts_advanced_search'),
})

// 게시글 필드 정의
const POST_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    name: 'title',
    label: '제목',
    type: 'string',
    filterable: true,
    sortable: true,
    searchable: true,
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
    defaultOperator: 'contains',
  },
  {
    name: 'content',
    label: '내용',
    type: 'string',
    filterable: true,
    sortable: false,
    searchable: true,
    operators: ['contains', 'not_contains'],
    defaultOperator: 'contains',
  },
  {
    name: 'category',
    label: '카테고리',
    type: 'select',
    filterable: true,
    sortable: true,
    searchable: false,
    options: [
      { value: '공지', label: '공지사항' },
      { value: '잡담', label: '잡담' },
      { value: '홍보', label: '홍보' },
      { value: '건의', label: '건의사항' },
    ],
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    defaultOperator: 'equals',
  },
  {
    name: 'author_id',
    label: '작성자 ID',
    type: 'string',
    filterable: true,
    sortable: false,
    searchable: false,
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    defaultOperator: 'equals',
  },
  {
    name: 'created_at',
    label: '작성일',
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
    name: 'is_pinned',
    label: '고정 여부',
    type: 'boolean',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals'],
    defaultOperator: 'equals',
  },
  {
    name: 'comment_count',
    label: '댓글 수',
    type: 'number',
    filterable: true,
    sortable: true,
    searchable: false,
    operators: ['equals', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between'],
    defaultOperator: 'greater_equal',
  },
]

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, is_artist, registration_status')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 요청 본문 파싱
    const searchQuery: AdvancedSearchQuery = await request.json()

    // 쿼리 검증
    const validation = validateAdvancedSearchQuery(searchQuery, POST_FIELD_DEFINITIONS)
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

    // 간단한 필터 추출 (복잡한 조건은 지원하지 않음)
    const simpleFilters: any = {}
    const searchText = query.search?.query || ''
    const searchFields = query.search?.fields || ['title', 'content']

    // 기본적인 필터만 추출
    if (query.filters?.conditions) {
      for (const condition of query.filters.conditions) {
        if (
          condition.operator === 'equals' &&
          ['category', 'is_pinned', 'is_deleted'].includes(condition.field)
        ) {
          simpleFilters[condition.field] = condition.value
        }
      }
    }

    // 정렬 조건 추출
    let sortField = 'created_at'
    let sortDirection = 'desc'
    if (query.sorts && query.sorts.length > 0) {
      const firstSort = query.sorts[0]
      if (
        ['title', 'category', 'created_at', 'updated_at', 'comment_count'].includes(firstSort.field)
      ) {
        sortField = firstSort.field
        sortDirection = firstSort.direction
      }
    }

    const { page, limit } = query.pagination!

    try {
      // 안전한 stored procedure 호출
      const [dataResult, countResult] = await Promise.all([
        supabase.rpc('search_posts_advanced', {
          p_filters: simpleFilters,
          p_search_query: searchText,
          p_search_fields: searchFields,
          p_sort_field: sortField,
          p_sort_direction: sortDirection,
          p_page: page,
          p_limit: limit,
        }),
        supabase.rpc('count_posts_advanced', {
          p_filters: simpleFilters,
          p_search_query: searchText,
          p_search_fields: searchFields,
        }),
      ])

      if (dataResult.error) {
        console.error('데이터 조회 오류:', dataResult.error)
        return NextResponse.json({ error: '검색 중 오류가 발생했습니다.' }, { status: 500 })
      }

      if (countResult.error) {
        console.error('카운트 조회 오류:', countResult.error)
        return NextResponse.json({ error: '검색 중 오류가 발생했습니다.' }, { status: 500 })
      }

      const posts = dataResult.data || []
      const totalCount = countResult.data || 0
      const totalPages = Math.ceil(totalCount / limit)

      const result: FilteredResult = {
        data: posts,
        total: totalCount,
        filtered: posts.length,
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

      return NextResponse.json(result)
    } catch (queryError) {
      console.error('쿼리 실행 오류:', queryError)
      return NextResponse.json(
        {
          error: '검색 쿼리 실행 중 오류가 발생했습니다.',
          details: queryError instanceof Error ? queryError.message : String(queryError),
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('고급 검색 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

// 필드 정의 조회 API
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 게시글 필드 정의 반환
    return NextResponse.json({
      fields: POST_FIELD_DEFINITIONS,
      target: 'posts',
      description: '게시글 고급 검색을 위한 필드 정의',
    })
  } catch (error) {
    console.error('필드 정의 조회 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
