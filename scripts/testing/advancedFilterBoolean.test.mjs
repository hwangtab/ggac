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

/**
 * 2026-09-01 감사 — 위 수정의 **남은 절반**.
 *
 * `convertValue`가 제대로 불리게 됐지만, 그 함수가 받는 `type`은 여전히
 * **클라이언트가 보낸 힌트**였다. `validateFilterCondition`은 필드명·연산자·필터
 * 가능 여부를 검증하면서 `type`은 필드 정의와 대조하지 않는다. 힌트가 빠지거나
 * 틀리면 변환이 건너뛰어져 SQLite에서 다시 조용히 틀린 답이 나온다.
 */
test('서버가 조건의 type을 필드 정의로 덮어쓴다 — 클라이언트 힌트를 믿지 않는다', async () => {
  const { normalizeConditionTypes } = await import('../../src/utils/advancedFiltering.ts')
  const { MEMBER_FIELD_DEFINITIONS } = await import('../../src/constants/memberSearchFields.ts')

  const 악의적_또는_누락 = {
    operator: 'AND',
    conditions: [
      { field: 'is_admin', operator: 'equals', value: 'true' }, // type 누락
      { field: 'is_admin', operator: 'equals', value: 'true', type: 'string' }, // type 거짓
    ],
    groups: [
      {
        operator: 'OR',
        conditions: [{ field: 'is_admin', operator: 'equals', value: 'false' }], // 중첩 그룹도
      },
    ],
  }

  const normalized = normalizeConditionTypes(악의적_또는_누락, MEMBER_FIELD_DEFINITIONS)

  assert.equal(normalized.conditions[0].type, 'boolean', '누락된 type을 채워야 한다')
  assert.equal(normalized.conditions[1].type, 'boolean', '틀린 type을 덮어써야 한다')
  assert.equal(normalized.groups[0].conditions[0].type, 'boolean', '중첩 그룹도 정규화해야 한다')
})

test('정규화를 거치면 boolean 필터가 실제로 0/1 파라미터를 만든다', async () => {
  const { normalizeConditionTypes } = await import('../../src/utils/advancedFiltering.ts')
  const { MEMBER_FIELD_DEFINITIONS } = await import('../../src/constants/memberSearchFields.ts')

  // type 힌트가 없는 요청 — 정규화 전이라면 문자열 'true'가 그대로 바인딩된다.
  const raw = {
    filters: {
      operator: 'AND',
      conditions: [{ field: 'is_admin', operator: 'equals', value: 'true' }],
    },
    pagination: { page: 1, limit: 20 },
  }

  const before = buildSearchQuery(raw, MEMBER_SEARCH_BASE_QUERY, MEMBER_SEARCH_ALLOWED_FIELDS)
  assert.equal(
    before.params[0],
    'true',
    "정규화 전에는 문자열이 그대로 간다 — SQLite에서 1 = 'true'는 거짓이라 0건이 된다"
  )

  const normalized = {
    ...raw,
    filters: normalizeConditionTypes(raw.filters, MEMBER_FIELD_DEFINITIONS),
  }
  const after = buildSearchQuery(normalized, MEMBER_SEARCH_BASE_QUERY, MEMBER_SEARCH_ALLOWED_FIELDS)
  assert.notEqual(after.params[0], 'true', '정규화 후에는 문자열이면 안 된다')
})

test('advanced-search 라우트가 정규화를 실제로 거친다', async () => {
  // 위 두 테스트는 함수의 성질만 본다. 정작 버그는 **라우트가 그것을 부르지
  // 않는 것**이었으므로 호출부를 못박는다.
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(
    new URL('../../src/app/api/admin/members/advanced-search/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(
    src,
    /normalizeConditionTypes\(\s*searchQuery\.filters,\s*MEMBER_FIELD_DEFINITIONS\s*\)/,
    '라우트가 필드 정의로 타입을 정규화해야 한다'
  )
})
