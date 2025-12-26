/**
 * 고급 필터링 시스템 타입 정의
 */

/**
 * 필터 연산자
 */
export type FilterOperator =
  | 'equals' // 같음
  | 'not_equals' // 같지 않음
  | 'contains' // 포함
  | 'not_contains' // 포함하지 않음
  | 'starts_with' // 시작
  | 'ends_with' // 끝남
  | 'greater_than' // 초과
  | 'greater_equal' // 이상
  | 'less_than' // 미만
  | 'less_equal' // 이하
  | 'between' // 범위
  | 'in' // 목록에 포함
  | 'not_in' // 목록에 미포함
  | 'is_null' // null임
  | 'is_not_null' // null이 아님

/**
 * 필터 조건
 */
export interface FilterCondition {
  /** 필드명 */
  field: string
  /** 연산자 */
  operator: FilterOperator
  /** 값 (배열 또는 단일 값) */
  value: any
  /** 값 타입 힌트 */
  type?: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'select' | 'multiselect'
}

/**
 * 논리 연산자
 */
export type LogicalOperator = 'AND' | 'OR'

/**
 * 필터 그룹
 */
export interface FilterGroup {
  /** 논리 연산자 */
  operator: LogicalOperator
  /** 조건들 */
  conditions: FilterCondition[]
  /** 중첩 그룹들 */
  groups?: FilterGroup[]
}

/**
 * 정렬 방향
 */
export type SortDirection = 'asc' | 'desc'

/**
 * 정렬 조건
 */
export interface SortCondition {
  /** 필드명 */
  field: string
  /** 정렬 방향 */
  direction: SortDirection
  /** 우선순위 (낮을수록 우선) */
  priority?: number
}

/**
 * 고급 검색 쿼리
 */
export interface AdvancedSearchQuery {
  /** 필터 그룹 */
  filters?: FilterGroup
  /** 정렬 조건들 */
  sorts?: SortCondition[]
  /** 페이지네이션 */
  pagination?: {
    page: number
    limit: number
  }
  /** 포함할 관련 데이터 */
  include?: string[]
  /** 검색할 필드들 (전체 텍스트 검색용) */
  search?: {
    query: string
    fields: string[]
  }
}

/**
 * 필터 프리셋
 */
export interface FilterPreset {
  /** 프리셋 ID */
  id: string
  /** 프리셋 이름 */
  name: string
  /** 설명 */
  description?: string
  /** 적용 대상 (posts, members 등) */
  target: string
  /** 필터 설정 */
  query: AdvancedSearchQuery
  /** 생성자 */
  created_by?: string
  /** 공개 여부 */
  is_public?: boolean
  /** 생성일 */
  created_at?: string
}

/**
 * 필드 정의
 */
export interface FieldDefinition {
  /** 필드명 */
  name: string
  /** 표시명 */
  label: string
  /** 필드 타입 */
  type: 'string' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect'
  /** 필터링 가능 여부 */
  filterable: boolean
  /** 정렬 가능 여부 */
  sortable: boolean
  /** 검색 가능 여부 */
  searchable: boolean
  /** 선택 옵션들 (select, multiselect 타입용) */
  options?: Array<{ value: any; label: string }>
  /** 지원하는 연산자들 */
  operators?: FilterOperator[]
  /** 기본 연산자 */
  defaultOperator?: FilterOperator
}

/**
 * 필터링 결과
 */
export interface FilteredResult<T = any> {
  /** 결과 데이터 */
  data: T[]
  /** 전체 개수 */
  total: number
  /** 필터된 개수 */
  filtered: number
  /** 페이지네이션 정보 */
  pagination: {
    page: number
    limit: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
  /** 적용된 필터 */
  applied_filters: FilterGroup
  /** 적용된 정렬 */
  applied_sorts: SortCondition[]
}
