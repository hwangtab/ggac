import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchQuery, convertValue } from '../../src/utils/advancedFiltering.ts'
import {
  MEMBER_SEARCH_BASE_QUERY,
  MEMBER_SEARCH_ALLOWED_FIELDS,
} from '../../src/constants/memberSearchFields.ts'

/**
 * 적대 감사(2026-08-27) — 관리자 고급검색의 boolean 필터가 **항상 0건**이었다.
 *
 * UI(`FilterConditionEditor.tsx`의 `<select onChange={… e.target.value}>`)는
 * boolean 필드에 **항상 문자열** `'true'`/`'false'`를 보낸다. Postgres는
 * `is_admin = $1`에서 파라미터 타입을 boolean으로 추론해 통과시켰지만,
 * **SQLite에서 `1 = 'true'`는 거짓**이다(INTEGER < TEXT).
 *
 * 그래서 관리자가 "관리자 여부 = 예"로 거르면 **에러 없이 빈 목록**이 나온다.
 * 위쪽 통계 바에는 진짜 숫자가 그대로 보이므로 필터가 고장 난 줄 모른다.
 * boolean 필드는 `operators: ['equals']`뿐이라 다른 연산자로 우회할 수도 없다.
 *
 * 원인은 `equals`/`not_equals`만 `convertValue`를 건너뛴 것이었다.
 *
 * **기존 단위 테스트가 못 잡은 이유**: UI가 보내는 문자열이 아니라 진짜
 * boolean을 넣어 검사했다. 그래서 이 테스트는 **문자열 입력**을 쓴다.
 */
function paramsFor(field, value) {
  const q = buildSearchQuery(
    {
      filters: {
        operator: 'AND',
        conditions: [{ field, operator: 'equals', value, type: 'boolean' }],
      },
      sorts: [],
      pagination: { page: 1, limit: 50 },
    },
    MEMBER_SEARCH_BASE_QUERY,
    MEMBER_SEARCH_ALLOWED_FIELDS
  )
  return q.params
}

test("UI가 보내는 문자열 'true'가 진짜 boolean으로 바인딩된다", () => {
  const params = paramsFor('is_admin', 'true')
  assert.equal(
    params[0],
    true,
    "문자열 그대로 바인딩하면 SQLite에서 1 = 'true'가 거짓이라 항상 0건이 된다"
  )
})

test("문자열 'false'도 진짜 boolean으로 바인딩된다", () => {
  assert.equal(paramsFor('is_active', 'false')[0], false)
})

test('진짜 boolean 입력은 그대로 통과한다 (API 직접 호출 경로)', () => {
  assert.equal(paramsFor('is_artist', true)[0], true)
  assert.equal(paramsFor('is_artist', false)[0], false)
})

test('not_equals도 같은 변환을 탄다', () => {
  const q = buildSearchQuery(
    {
      filters: {
        operator: 'AND',
        conditions: [{ field: 'is_admin', operator: 'not_equals', value: 'true', type: 'boolean' }],
      },
      sorts: [],
      pagination: { page: 1, limit: 50 },
    },
    MEMBER_SEARCH_BASE_QUERY,
    MEMBER_SEARCH_ALLOWED_FIELDS
  )
  assert.equal(q.params[0], true)
})

test('문자열 타입 필드는 문자열로 남는다 (과잉 변환 방지)', () => {
  const q = buildSearchQuery(
    {
      filters: {
        operator: 'AND',
        conditions: [{ field: 'display_name', operator: 'equals', value: 'true', type: 'string' }],
      },
      sorts: [],
      pagination: { page: 1, limit: 50 },
    },
    MEMBER_SEARCH_BASE_QUERY,
    MEMBER_SEARCH_ALLOWED_FIELDS
  )
  assert.equal(q.params[0], 'true', 'boolean 변환이 문자열 필드까지 삼키면 안 된다')
})

test('convertValue의 boolean 계약', () => {
  assert.equal(convertValue('true', 'boolean'), true)
  assert.equal(convertValue('false', 'boolean'), false)
  assert.equal(convertValue(true, 'boolean'), true)
})
