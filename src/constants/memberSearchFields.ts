/**
 * 멤버 고급 검색(`/api/admin/members/advanced-search`)의 **계약**.
 *
 * 필드 화이트리스트(`MEMBER_SEARCH_ALLOWED_FIELDS`)는 정렬·필터 컬럼명이
 * SQL에 그대로 박히는 경로(`src/utils/advancedFiltering.ts`의
 * `buildSearchQuery`)의 **유일한 방어선**이다 — 넓어지거나 사라지면 컬럼명
 * 인젝션이 열린다.
 *
 * 그래서 라우트 파일 안이 아니라 여기에 둔다: 라우트는 `@/`, `next/server`
 * 등에 의존해 node 테스트 러너가 import할 수 없고(경로 별칭 미해석), 테스트가
 * 상수를 **베껴 쓰면** 화이트리스트를 넓혀도 테스트가 전부 통과한다
 * (단계 4 리뷰 1회차 Important 5에서 실제로 그 상태였다).
 * `src/constants/contentFormat.ts`·`userSettings.ts`가 allowlist를 라우트
 * 밖으로 뺀 것과 같은 이유·같은 자리다.
 *
 * 이 파일은 값 선언만 담는다(런타임 import 0개, 타입 import는 스트리핑으로
 * 지워진다) — 그래야 라우트와 테스트가 **같은 한 벌**을 본다.
 */

import type { FieldDefinition } from '@/types'

/** 필터·정렬·검색 가능한 멤버 필드 정의(응답의 `fields`로도 그대로 나간다). */
export const MEMBER_FIELD_DEFINITIONS: FieldDefinition[] = [
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

/**
 * `buildSearchQuery`에 넘기는 컬럼명 화이트리스트. 정의에서 파생해 한 벌만
 * 유지한다 — 라우트가 따로 `.map(field => field.name)`을 다시 쓰면 두 곳이
 * 갈라질 수 있다.
 */
export const MEMBER_SEARCH_ALLOWED_FIELDS: string[] = MEMBER_FIELD_DEFINITIONS.map(
  field => field.name
)

/**
 * 검색의 FROM/JOIN 절. Task 4: execute_advanced_search RPC(Postgres) 대체로
 * `src/db/queries/misc.ts`의 `executeMemberAdvancedSearch`(SQLite/Turso)가
 * 실행한다 — 그 함수 JSDoc 참고. `artists`를 직접 LEFT JOIN하지 않고
 * 서브쿼리로 좁혀 `member_profiles`와 겹치는 `created_at`/`updated_at`
 * 컬럼명의 모호성을 피한다(선택 컬럼은 원본과 동일하게 `a.name`/`a.slug`뿐).
 * `is_deleted = false`는 SQLite 정수 불리언 표현인 `is_deleted = 0`으로 바꿨다.
 */
export const MEMBER_SEARCH_BASE_QUERY = `
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

/** `buildSearchQuery`가 만든 `SELECT * FROM ...`을 실제 조회 컬럼으로 바꾼다. */
export function buildMemberSearchDataQuery(sql: string): string {
  return sql.replace(
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
}
