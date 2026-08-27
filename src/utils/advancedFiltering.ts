/**
 * 고급 필터링 시스템 유틸리티
 * SQL 쿼리 생성, 조건 검증, 필터 최적화 등을 담당
 */

import type {
  FilterCondition,
  FilterGroup,
  FilterOperator,
  SortCondition,
  AdvancedSearchQuery,
  FieldDefinition,
  LogicalOperator,
} from '@/types'

/**
 * 필터 조건을 SQL WHERE 절로 변환
 */
export function buildWhereClause(
  condition: FilterCondition,
  paramIndex: number = 1
): { sql: string; params: any[]; nextIndex: number } {
  const { field, operator, value, type } = condition
  const params: any[] = []
  let sql = ''
  let nextIndex = paramIndex

  // 필드명 검증 (SQL 인젝션 방지)
  if (!isValidFieldName(field)) {
    throw new Error(`Invalid field name: ${field}`)
  }

  switch (operator) {
    // `equals`/`not_equals`가 `convertValue`를 건너뛰던 것이 컷오버 회귀였다.
    //
    // UI(`FilterConditionEditor.tsx`의 `<select>`)는 boolean 필드에 대해 **항상
    // 문자열** `'true'`/`'false'`를 보낸다. Postgres는 `is_admin = $1`에서
    // 파라미터 타입을 boolean으로 추론해 통과시켰지만, **SQLite에서 `1 = 'true'`는
    // 거짓**이다(INTEGER < TEXT). 그래서 관리자가 "관리자 여부 = 예"로 거르면
    // 에러 없이 **항상 0건**이 나온다 — 위쪽 통계 바에는 진짜 숫자가 그대로
    // 보이므로 필터가 고장 난 줄 모른다. 적대 감사(2026-08-27) 실측.
    //
    // boolean 필드는 `operators: ['equals']`뿐이라(memberSearchFields.ts) 다른
    // 연산자로 우회할 수도 없었다. 같은 저장소의 `posts.ts`
    // `normalizeBooleanFilterValue`가 이미 올바른 참조 구현이다.
    case 'equals':
      sql = `${field} = $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'not_equals':
      sql = `${field} != $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'contains':
      sql = `${field} ILIKE $${nextIndex}`
      params.push(`%${value}%`)
      nextIndex++
      break

    case 'not_contains':
      sql = `${field} NOT ILIKE $${nextIndex}`
      params.push(`%${value}%`)
      nextIndex++
      break

    case 'starts_with':
      sql = `${field} ILIKE $${nextIndex}`
      params.push(`${value}%`)
      nextIndex++
      break

    case 'ends_with':
      sql = `${field} ILIKE $${nextIndex}`
      params.push(`%${value}`)
      nextIndex++
      break

    case 'greater_than':
      sql = `${field} > $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'greater_equal':
      sql = `${field} >= $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'less_than':
      sql = `${field} < $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'less_equal':
      sql = `${field} <= $${nextIndex}`
      params.push(convertValue(value, type))
      nextIndex++
      break

    case 'between':
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('Between operator requires array with 2 values')
      }
      sql = `${field} BETWEEN $${nextIndex} AND $${nextIndex + 1}`
      params.push(convertValue(value[0], type), convertValue(value[1], type))
      nextIndex += 2
      break

    case 'in':
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('In operator requires non-empty array')
      }
      const inPlaceholders = value.map((_, i) => `$${nextIndex + i}`).join(', ')
      sql = `${field} IN (${inPlaceholders})`
      params.push(...value.map(v => convertValue(v, type)))
      nextIndex += value.length
      break

    case 'not_in':
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Not in operator requires non-empty array')
      }
      const notInPlaceholders = value.map((_, i) => `$${nextIndex + i}`).join(', ')
      sql = `${field} NOT IN (${notInPlaceholders})`
      params.push(...value.map(v => convertValue(v, type)))
      nextIndex += value.length
      break

    case 'is_null':
      sql = `${field} IS NULL`
      break

    case 'is_not_null':
      sql = `${field} IS NOT NULL`
      break

    default:
      throw new Error(`Unsupported operator: ${operator}`)
  }

  return { sql, params, nextIndex }
}

/**
 * 필터 그룹을 SQL WHERE 절로 변환
 */
export function buildFilterGroupClause(
  group: FilterGroup,
  paramIndex: number = 1
): { sql: string; params: any[]; nextIndex: number } {
  const { operator, conditions, groups } = group
  const allParams: any[] = []
  const clauses: string[] = []
  let currentIndex = paramIndex

  // 조건들 처리
  for (const condition of conditions) {
    try {
      const result = buildWhereClause(condition, currentIndex)
      clauses.push(result.sql)
      allParams.push(...result.params)
      currentIndex = result.nextIndex
    } catch (error) {
      console.warn(`Skipping invalid condition:`, condition, error)
    }
  }

  // 중첩 그룹들 처리
  if (groups) {
    for (const nestedGroup of groups) {
      try {
        const result = buildFilterGroupClause(nestedGroup, currentIndex)
        if (result.sql) {
          clauses.push(`(${result.sql})`)
          allParams.push(...result.params)
          currentIndex = result.nextIndex
        }
      } catch (error) {
        console.warn(`Skipping invalid group:`, nestedGroup, error)
      }
    }
  }

  if (clauses.length === 0) {
    return { sql: '', params: [], nextIndex: currentIndex }
  }

  const sql = clauses.join(` ${operator} `)
  return { sql, params: allParams, nextIndex: currentIndex }
}

/**
 * 정렬 조건을 SQL ORDER BY 절로 변환
 */
export function buildOrderByClause(sorts: SortCondition[], allowedFields: string[] = []): string {
  if (!sorts || sorts.length === 0) {
    return ''
  }

  if (allowedFields.length === 0) {
    throw new Error('Sort fields require an explicit allowlist')
  }

  // 우선순위로 정렬하고 SQL 생성
  const sortedSorts = [...sorts].sort((a, b) => (a.priority || 0) - (b.priority || 0))

  const orderClauses = sortedSorts.map(sort => {
    if (!isValidFieldName(sort.field)) {
      throw new Error(`Invalid field name in sort: ${sort.field}`)
    }
    if (!allowedFields.includes(sort.field)) {
      throw new Error(`Field is not allowed in sort: ${sort.field}`)
    }
    if (!['asc', 'desc'].includes(sort.direction)) {
      throw new Error(`Invalid sort direction: ${sort.direction}`)
    }
    return `${sort.field} ${sort.direction.toUpperCase()}`
  })

  return `ORDER BY ${orderClauses.join(', ')}`
}

function collectFilterFields(group: FilterGroup): string[] {
  const fields = Array.isArray(group.conditions)
    ? group.conditions
        .map(condition => condition?.field)
        .filter((field): field is string => typeof field === 'string')
    : []
  const nestedFields = Array.isArray(group.groups) ? group.groups.flatMap(collectFilterFields) : []
  return [...fields, ...nestedFields]
}

/**
 * 전체 검색 쿼리를 SQL로 변환
 */
export function buildSearchQuery(
  query: AdvancedSearchQuery,
  baseTable: string,
  allowedFields: string[] = []
): { sql: string; params: any[]; countSql: string } {
  let whereClause = ''
  let orderByClause = ''
  let limitClause = ''
  const allParams: any[] = []
  let paramIndex = 1

  // 필터 조건 처리
  if (query.filters) {
    if (allowedFields.length === 0) {
      throw new Error('Filter fields require an explicit allowlist')
    }

    const disallowedFields = collectFilterFields(query.filters).filter(
      field => !allowedFields.includes(field)
    )
    if (disallowedFields.length > 0) {
      throw new Error(`Disallowed filter fields: ${[...new Set(disallowedFields)].join(', ')}`)
    }

    const filterResult = buildFilterGroupClause(query.filters, paramIndex)
    if (filterResult.sql) {
      whereClause = `WHERE ${filterResult.sql}`
      allParams.push(...filterResult.params)
      paramIndex = filterResult.nextIndex
    }
  }

  // 전체 텍스트 검색 처리
  if (query.search && query.search.query.trim()) {
    if (allowedFields.length === 0) {
      throw new Error('Search fields require an explicit allowlist')
    }

    const disallowedSearchFields = query.search.fields.filter(
      field => !allowedFields.includes(field)
    )
    if (disallowedSearchFields.length > 0) {
      throw new Error(
        `Disallowed search fields: ${[...new Set(disallowedSearchFields)].join(', ')}`
      )
    }

    const searchFields = query.search.fields

    if (searchFields.length > 0) {
      const searchConditions = searchFields.map(field => {
        if (!isValidFieldName(field)) {
          throw new Error(`Invalid search field: ${field}`)
        }
        return `${field} ILIKE $${paramIndex}`
      })

      const searchClause = `(${searchConditions.join(' OR ')})`
      const searchValue = `%${query.search.query}%`

      if (whereClause) {
        whereClause += ` AND ${searchClause}`
      } else {
        whereClause = `WHERE ${searchClause}`
      }

      // 모든 검색 필드에 같은 값 추가
      searchFields.forEach(() => {
        allParams.push(searchValue)
        paramIndex++
      })
    }
  }

  // 정렬 처리
  if (query.sorts && query.sorts.length > 0) {
    orderByClause = buildOrderByClause(query.sorts, allowedFields)
  }

  // 페이지네이션 처리
  if (query.pagination) {
    const { page, limit } = query.pagination
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new Error('Invalid pagination values')
    }
    const offset = (page - 1) * limit
    limitClause = `LIMIT ${limit} OFFSET ${offset}`
  }

  // 최종 쿼리 조합
  const sql = [`SELECT * FROM ${baseTable}`, whereClause, orderByClause, limitClause]
    .filter(Boolean)
    .join(' ')

  // 카운트 쿼리 (페이지네이션용)
  const countSql = [`SELECT COUNT(*) as total FROM ${baseTable}`, whereClause]
    .filter(Boolean)
    .join(' ')

  return { sql, params: allParams, countSql }
}

/**
 * 필드명 검증 (SQL 인젝션 방지)
 */
export function isValidFieldName(field: string): boolean {
  // 영문자, 숫자, 언더스코어, 점만 허용
  const validPattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/
  return validPattern.test(field) && field.length <= 100
}

/**
 * 값 타입 변환
 */
export function convertValue(value: any, type?: string): any {
  if (value === null || value === undefined) {
    return null
  }

  switch (type) {
    case 'number':
      const num = Number(value)
      return Number.isFinite(num) ? num : null

    case 'date':
      const date = new Date(value)
      return isNaN(date.getTime()) ? null : date.toISOString()

    case 'boolean':
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true'
      }
      return Boolean(value)

    case 'string':
    default:
      return String(value)
  }
}

/**
 * 필터 조건 검증
 */
export function validateFilterCondition(
  condition: FilterCondition,
  fieldDef?: FieldDefinition,
  requireKnownField: boolean = false
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return { isValid: false, errors: ['Filter condition must be an object'] }
  }

  // 필드명 검증
  if (!condition.field || !isValidFieldName(condition.field)) {
    errors.push('Invalid field name')
  }

  if (requireKnownField && !fieldDef) {
    errors.push(`Field ${condition.field} is not allowed`)
  }

  // 연산자 검증
  if (!condition.operator) {
    errors.push('Operator is required')
  }

  // 필드 정의가 있는 경우 추가 검증
  if (fieldDef) {
    if (!fieldDef.filterable) {
      errors.push(`Field ${condition.field} is not filterable`)
    }

    if (fieldDef.operators && !fieldDef.operators.includes(condition.operator)) {
      errors.push(`Operator ${condition.operator} is not supported for field ${condition.field}`)
    }
  }

  // 값 검증
  switch (condition.operator) {
    case 'between':
      if (!Array.isArray(condition.value) || condition.value.length !== 2) {
        errors.push('Between operator requires array with exactly 2 values')
      }
      break

    case 'in':
    case 'not_in':
      if (!Array.isArray(condition.value) || condition.value.length === 0) {
        errors.push(`${condition.operator} operator requires non-empty array`)
      }
      break

    case 'is_null':
    case 'is_not_null':
      // 값이 필요하지 않음
      break

    default:
      if (condition.value === null || condition.value === undefined || condition.value === '') {
        errors.push('Value is required for this operator')
      }
  }

  return { isValid: errors.length === 0, errors }
}

/**
 * 필터 그룹 검증
 */
export function validateFilterGroup(
  group: FilterGroup,
  fieldDefs?: FieldDefinition[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!group || typeof group !== 'object') {
    return { isValid: false, errors: ['Filter group must be an object'] }
  }

  // 논리 연산자 검증
  if (!group.operator || !['AND', 'OR'].includes(group.operator)) {
    errors.push('Invalid logical operator')
  }

  // 조건들 검증
  if (group.conditions && !Array.isArray(group.conditions)) {
    errors.push('Filter conditions must be an array')
  } else if (group.conditions) {
    group.conditions.forEach((condition, index) => {
      const fieldDef = fieldDefs?.find(def => def.name === condition.field)
      const validation = fieldDefs
        ? validateFilterCondition(condition, fieldDef, true)
        : validateFilterCondition(condition)

      if (!validation.isValid) {
        validation.errors.forEach(error => {
          errors.push(`Condition ${index + 1}: ${error}`)
        })
      }
    })
  }

  // 중첩 그룹들 검증
  if (group.groups && !Array.isArray(group.groups)) {
    errors.push('Nested filter groups must be an array')
  } else if (group.groups) {
    group.groups.forEach((nestedGroup, index) => {
      const validation = validateFilterGroup(nestedGroup, fieldDefs)

      if (!validation.isValid) {
        validation.errors.forEach(error => {
          errors.push(`Group ${index + 1}: ${error}`)
        })
      }
    })
  }

  // 최소한 하나의 조건이나 그룹이 있어야 함
  if (
    (!Array.isArray(group.conditions) || group.conditions.length === 0) &&
    (!Array.isArray(group.groups) || group.groups.length === 0)
  ) {
    errors.push('Filter group must have at least one condition or nested group')
  }

  return { isValid: errors.length === 0, errors }
}

/**
 * 고급 검색 쿼리 검증
 */
export function validateAdvancedSearchQuery(
  query: AdvancedSearchQuery,
  fieldDefs?: FieldDefinition[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { isValid: false, errors: ['Search query must be an object'] }
  }

  // 필터 검증
  if (query.filters) {
    const validation = validateFilterGroup(query.filters, fieldDefs)
    if (!validation.isValid) {
      validation.errors.forEach(error => {
        errors.push(`Filter: ${error}`)
      })
    }
  }

  // 정렬 검증
  if (query.sorts && !Array.isArray(query.sorts)) {
    errors.push('Sorts must be an array')
  } else if (query.sorts) {
    query.sorts.forEach((sort, index) => {
      if (!sort.field || !isValidFieldName(sort.field)) {
        errors.push(`Sort ${index + 1}: Invalid field name`)
      }

      if (!sort.direction || !['asc', 'desc'].includes(sort.direction)) {
        errors.push(`Sort ${index + 1}: Invalid direction`)
      }

      const fieldDef = fieldDefs?.find(def => def.name === sort.field)
      if (fieldDefs && !fieldDef) {
        errors.push(`Sort ${index + 1}: Field ${sort.field} is not allowed`)
      } else if (fieldDef && !fieldDef.sortable) {
        errors.push(`Sort ${index + 1}: Field ${sort.field} is not sortable`)
      }
    })
  }

  // 페이지네이션 검증
  if (query.pagination) {
    if (typeof query.pagination !== 'object' || Array.isArray(query.pagination)) {
      errors.push('Pagination must be an object')
    } else {
      const { page, limit } = query.pagination

      if (!Number.isInteger(page) || page < 1) {
        errors.push('Page must be a positive integer')
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        errors.push('Limit must be between 1 and 1000')
      }
    }
  }

  // 검색 검증
  if (query.search) {
    if (typeof query.search !== 'object' || Array.isArray(query.search)) {
      errors.push('Search must be an object')
    } else {
      if (!query.search.query || typeof query.search.query !== 'string') {
        errors.push('Search query must be a non-empty string')
      }

      if (!Array.isArray(query.search.fields) || query.search.fields.length === 0) {
        errors.push('Search fields must be a non-empty array')
      }

      if (Array.isArray(query.search.fields)) {
        query.search.fields.forEach((field, index) => {
          if (!isValidFieldName(field)) {
            errors.push(`Search field ${index + 1}: Invalid field name`)
          }

          const fieldDef = fieldDefs?.find(def => def.name === field)
          if (fieldDefs && !fieldDef) {
            errors.push(`Search field ${index + 1}: Field ${field} is not allowed`)
          } else if (fieldDef && !fieldDef.searchable) {
            errors.push(`Search field ${index + 1}: Field ${field} is not searchable`)
          }
        })
      }
    }
  }

  return { isValid: errors.length === 0, errors }
}

/**
 * 기본 필터 그룹 생성
 */
export function createDefaultFilterGroup(operator: LogicalOperator = 'AND'): FilterGroup {
  return {
    operator,
    conditions: [],
    groups: [],
  }
}

/**
 * 필터 조건 생성 헬퍼
 */
export function createFilterCondition(
  field: string,
  operator: FilterOperator,
  value: any,
  type?: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'select' | 'multiselect'
): FilterCondition {
  return {
    field,
    operator,
    value,
    type,
  }
}

/**
 * 정렬 조건 생성 헬퍼
 */
export function createSortCondition(
  field: string,
  direction: 'asc' | 'desc' = 'asc',
  priority?: number
): SortCondition {
  return {
    field,
    direction,
    priority,
  }
}

const advancedFiltering = {
  buildWhereClause,
  buildFilterGroupClause,
  buildOrderByClause,
  buildSearchQuery,
  isValidFieldName,
  convertValue,
  validateFilterCondition,
  validateFilterGroup,
  validateAdvancedSearchQuery,
  createDefaultFilterGroup,
  createFilterCondition,
  createSortCondition,
}

export default advancedFiltering
