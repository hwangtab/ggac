/**
 * 게시글 고급 검색 API
 * 복합 필터링, 정렬, 전체 텍스트 검색을 지원하는 고급 검색 기능
 */

import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateAdvancedSearchQuery } from '@/utils/advancedFiltering'
import type { AdvancedSearchQuery, FilteredResult, FieldDefinition } from '@/types'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  searchPostsAdvanced,
  countPostsAdvanced,
  type AdvancedSearchSortField,
} from '@/db/queries/posts'

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

export const POST = defineApiRoute<AdvancedSearchQuery>({
  method: 'POST',
  name: 'api/admin/posts/advanced-search',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('posts_advanced_search'),
  },
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
    const validation = validateAdvancedSearchQuery(searchQuery, POST_FIELD_DEFINITIONS)
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
      // Task 8: 존재하지 않던 RPC(search_posts_advanced/count_posts_advanced,
      // 이 라우트는 500만 내고 한 번도 동작한 적이 없었다 — decisions.md 참고)를
      // Drizzle 쿼리(src/db/queries/posts.ts)로 대체한다. simpleFilters/
      // searchText/searchFields/sortField/sortDirection은 이미 위에서 파싱한
      // 값을 그대로 넘긴다 — 라우트의 파싱 로직은 손대지 않았다.
      //
      // total은 searchPostsAdvanced의 count(*) over()가 아니라 countPostsAdvanced
      // (별도 COUNT 쿼리)로 구한다 — task-8-brief의 "listPosts.total 경계"
      // 경고 대상이 바로 이 화면이다(관리자 페이지네이션 UI가 total을 표시).
      // offset이 실제 총 개수를 넘어서면 count(*) over()는 0으로 떨어지지만
      // countPostsAdvanced는 페이지 위치와 무관하게 정확하다.
      const [dataResult, totalCount] = await Promise.all([
        searchPostsAdvanced({
          simpleFilters,
          searchText,
          searchFields,
          sortField: sortField as AdvancedSearchSortField,
          sortDirection: sortDirection as 'asc' | 'desc',
          page,
          limit,
        }),
        countPostsAdvanced({ simpleFilters, searchText, searchFields }),
      ])

      const posts = dataResult.rows
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
  name: 'api/admin/posts/advanced-search.fields',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('posts_advanced_search'),
  },
  auth: 'admin',
  errorResponse: error => {
    console.error('필드 정의 조회 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  },
  handler: async () => {
    return ApiSuccess.ok({
      fields: POST_FIELD_DEFINITIONS,
      target: 'posts',
      description: '게시글 고급 검색을 위한 필드 정의',
    })
  },
})
