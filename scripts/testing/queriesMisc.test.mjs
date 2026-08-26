import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

// 라우트가 쓰는 바로 그 계약을 그대로 import한다 — 베껴 쓰지 않는다
// (단계 4 리뷰 1회차 Important 5).
import {
  MEMBER_SEARCH_ALLOWED_FIELDS,
  MEMBER_SEARCH_BASE_QUERY,
  buildMemberSearchDataQuery,
} from '../../src/constants/memberSearchFields.ts'

/**
 * `src/db/queries/misc.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesActivities.test.mjs`(단계 4 Task 3)와 동일.
 *
 * `executeMemberAdvancedSearch`(execute_advanced_search RPC 대체)의 필터·
 * 정렬·페이지네이션이 `@/utils/advancedFiltering`의 `buildSearchQuery`가
 * 만든 SQL을 그대로 실행해 원본과 같은 결과를 내는지가 이 파일의 핵심
 * 검증 대상이다(task-4-brief.md Step 4).
 */

const DB_PATH = 'scripts/testing/.queries-misc-test.db'
const MISC_MODULE_URL = new URL('../../src/db/queries/misc.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)
const FILTERING_MODULE_URL = new URL('../../src/utils/advancedFiltering.ts', import.meta.url)

async function loadFreshMiscModule() {
  return import(`${MISC_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFilteringModule() {
  return import(FILTERING_MODULE_URL.href)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: createEventApplication이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { createEventApplication } = await loadFreshMiscModule()
    await assert.rejects(() =>
      createEventApplication({
        event_slug: 'evt',
        applicant_name: '홍길동',
        contact_email: null,
        contact_phone: '010-0000-0000',
        performance_info: null,
        items_to_sell: null,
        links: null,
        message: null,
        participation_type: null,
        photo_url: null,
        privacy_consent: true,
        privacy_consent_at: new Date().toISOString(),
      })
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `misc-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: overrides.email ?? `${id}@test.local`,
    display_name: overrides.display_name ?? '기타테스트회원',
    real_name: overrides.real_name ?? null,
    registration_status: overrides.registration_status ?? 'approved',
    is_active: overrides.is_active === undefined ? true : overrides.is_active,
    is_admin: overrides.is_admin === undefined ? false : overrides.is_admin,
    is_artist: overrides.is_artist === undefined ? false : overrides.is_artist,
    artist_role: overrides.artist_role ?? 'owner',
    membership_type: overrides.membership_type ?? 'regular',
  })
  return id
}

// -------------------------------------------------------------- link_previews

test('link_previews 캐시: TTL 안이면 캐시된 값을, 만료되면 null을 돌려준다', async () => {
  const { setCachedLinkPreview, getCachedLinkPreview } = await loadFreshMiscModule()
  await setCachedLinkPreview('https://example.com/fresh', { title: '신선함' }, 3600)
  const fresh = await getCachedLinkPreview('https://example.com/fresh')
  assert.deepEqual(fresh, { title: '신선함' })

  await setCachedLinkPreview('https://example.com/stale', { title: '오래됨' }, 1)
  // ttl_seconds=1이지만 last_fetched를 과거로 직접 되돌려 만료를 강제한다.
  await setupClient.execute({
    sql: 'UPDATE link_previews SET last_fetched = ? WHERE url = ?',
    args: [Date.now() - 10_000, 'https://example.com/stale'],
  })
  const stale = await getCachedLinkPreview('https://example.com/stale')
  assert.equal(stale, null)
})

test('link_previews 캐시: 같은 url로 다시 저장하면 upsert된다(행이 늘지 않는다)', async () => {
  const { setCachedLinkPreview } = await loadFreshMiscModule()
  await setCachedLinkPreview('https://example.com/dup', { title: 'A' })
  await setCachedLinkPreview('https://example.com/dup', { title: 'B' })
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM link_previews WHERE url = ?',
    args: ['https://example.com/dup'],
  })
  assert.equal(Number(result.rows[0].c), 1)
})

// -------------------------------------------------------------- event_applications

test('createEventApplication → listEventApplications: event_slug/status 필터와 페이지네이션', async () => {
  const { createEventApplication, listEventApplications } = await loadFreshMiscModule()
  for (let i = 0; i < 3; i++) {
    await createEventApplication({
      event_slug: 'summer-market',
      applicant_name: `신청자${i}`,
      contact_email: null,
      contact_phone: '010-1111-000' + i,
      performance_info: null,
      items_to_sell: null,
      links: null,
      message: null,
      participation_type: null,
      photo_url: null,
      privacy_consent: true,
      privacy_consent_at: new Date().toISOString(),
    })
  }
  await createEventApplication({
    event_slug: 'winter-market',
    applicant_name: '다른행사',
    contact_email: null,
    contact_phone: '010-2222-0000',
    performance_info: null,
    items_to_sell: null,
    links: null,
    message: null,
    participation_type: null,
    photo_url: null,
    privacy_consent: true,
    privacy_consent_at: new Date().toISOString(),
  })

  const { rows, total } = await listEventApplications({
    eventSlug: 'summer-market',
    status: null,
    page: 1,
    limit: 50,
  })
  assert.equal(total, 3)
  assert.equal(rows.length, 3)
  assert.ok(rows.every(r => r.event_slug === 'summer-market'))
})

test('updateEventApplicationStatus / updateEventApplicationFields / deleteEventApplication', async () => {
  const {
    createEventApplication,
    updateEventApplicationStatus,
    updateEventApplicationFields,
    deleteEventApplication,
  } = await loadFreshMiscModule()
  const { id } = await createEventApplication({
    event_slug: 'test-evt',
    applicant_name: '원본이름',
    contact_email: null,
    contact_phone: '010-3333-0000',
    performance_info: null,
    items_to_sell: null,
    links: null,
    message: null,
    participation_type: null,
    photo_url: null,
    privacy_consent: true,
    privacy_consent_at: new Date().toISOString(),
  })

  await updateEventApplicationStatus(id, 'approved')
  let row = await setupClient.execute({
    sql: 'SELECT status FROM event_applications WHERE id = ?',
    args: [id],
  })
  assert.equal(row.rows[0].status, 'approved')

  await updateEventApplicationFields(id, {
    applicant_name: '수정된이름',
    contact_email: 'x@example.com',
    contact_phone: null,
    performance_info: null,
    items_to_sell: null,
    links: null,
    message: null,
    participation_type: null,
  })
  row = await setupClient.execute({
    sql: 'SELECT applicant_name, contact_email FROM event_applications WHERE id = ?',
    args: [id],
  })
  assert.equal(row.rows[0].applicant_name, '수정된이름')
  assert.equal(row.rows[0].contact_email, 'x@example.com')

  await deleteEventApplication(id)
  row = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM event_applications WHERE id = ?',
    args: [id],
  })
  assert.equal(Number(row.rows[0].c), 0)
})

// -------------------------------------------------------------- member_bulk_operations

test('member_bulk_operations 생애주기: pending → in_progress → completed', async () => {
  const performedBy = await seedProfile()
  const {
    createBulkOperation,
    markBulkOperationInProgress,
    completeBulkOperation,
    listBulkOperations,
  } = await loadFreshMiscModule()

  const op = await createBulkOperation({
    operation_type: 'bulk_approve',
    performed_by: performedBy,
    member_ids: ['m1', 'm2'],
    parameters: {},
  })
  assert.equal(op.status, 'pending')

  await markBulkOperationInProgress(op.id)
  let row = await setupClient.execute({
    sql: 'SELECT status, started_at FROM member_bulk_operations WHERE id = ?',
    args: [op.id],
  })
  assert.equal(row.rows[0].status, 'in_progress')
  assert.ok(row.rows[0].started_at)

  await completeBulkOperation(op.id, { success_count: 2, error_count: 0, details: [] })
  row = await setupClient.execute({
    sql: 'SELECT status, results FROM member_bulk_operations WHERE id = ?',
    args: [op.id],
  })
  assert.equal(row.rows[0].status, 'completed')
  assert.deepEqual(JSON.parse(row.rows[0].results), {
    success_count: 2,
    error_count: 0,
    details: [],
  })

  const list = await listBulkOperations(50)
  assert.ok(list.some(o => o.id === op.id))
})

test('failBulkOperation: status=failed, error_message 기록', async () => {
  const performedBy = await seedProfile()
  const { createBulkOperation, failBulkOperation } = await loadFreshMiscModule()
  const op = await createBulkOperation({
    operation_type: 'bulk_suspend',
    performed_by: performedBy,
    member_ids: ['m3'],
    parameters: {},
  })
  await failBulkOperation(op.id, { success_count: 0, error_count: 1, details: [] }, '실패 사유')
  const row = await setupClient.execute({
    sql: 'SELECT status, error_message FROM member_bulk_operations WHERE id = ?',
    args: [op.id],
  })
  assert.equal(row.rows[0].status, 'failed')
  assert.equal(row.rows[0].error_message, '실패 사유')
})

// -------------------------------------------------------------- execute_advanced_search RPC 대체

/**
 * 라우트 핸들러가 `buildSearchQuery` → `buildMemberSearchDataQuery`로 하는 일과
 * **같은 함수·같은 상수**로 SQL을 만든다. 예전에는 이 함수가 라우트의
 * 화이트리스트·FROM 절·조회 컬럼을 통째로 베껴 자기 사본을 먹였다 — 그래서
 * 라우트의 화이트리스트를 지우거나 넓혀도 아래 테스트들이 전부 통과했다
 * (리뷰 1회차 Important 5). 그 화이트리스트가 정렬 컬럼명 인젝션의 유일한
 * 방어선이다.
 */
function buildDataAndCountSql(query) {
  return async () => {
    const { buildSearchQuery } = await loadFilteringModule()
    const { sql, params, countSql } = buildSearchQuery(
      query,
      MEMBER_SEARCH_BASE_QUERY,
      MEMBER_SEARCH_ALLOWED_FIELDS
    )
    return { dataQuery: buildMemberSearchDataQuery(sql), countSql, params }
  }
}

/**
 * 화이트리스트 자체를 고정한다. 위 테스트들은 화이트리스트를 **쓰기만** 하므로
 * 필드가 하나 더 늘어도 그대로 통과한다 — 늘어난 컬럼명이 정렬 절에 그대로
 * 박히는 게 이 경로의 사고다. 목록을 정확히 단언해 넓힘·삭제 양쪽을 잡는다.
 */
test('멤버 검색 화이트리스트가 정확히 이 15개 컬럼이다(넓히거나 지우면 실패한다)', () => {
  assert.deepEqual(MEMBER_SEARCH_ALLOWED_FIELDS, [
    'display_name',
    'real_name',
    'email',
    'registration_status',
    'is_artist',
    'is_admin',
    'is_active',
    'phone_number',
    'membership_type',
    'artist_id',
    'artist_role',
    'created_at',
    'updated_at',
    'last_login_at',
    'suspension_until',
  ])
})

test('라우트가 이 계약을 그대로 쓴다(자기 사본을 다시 만들면 실패한다)', () => {
  // 위 두 테스트가 검증하는 게 "라우트의 계약"이려면, 라우트가 이 모듈을
  // 실제로 써야 한다. 라우트 파일은 `@/` 별칭 때문에 node 테스트 러너가
  // import할 수 없으므로 여기서만 소스로 확인한다.
  const routeSource = readFileSync('src/app/api/admin/members/advanced-search/route.ts', 'utf8')
  assert.match(routeSource, /from '@\/constants\/memberSearchFields'/)
  assert.match(
    routeSource,
    /buildSearchQuery\(\s*query,\s*MEMBER_SEARCH_BASE_QUERY,\s*MEMBER_SEARCH_ALLOWED_FIELDS\s*\)/
  )
  assert.match(routeSource, /buildMemberSearchDataQuery\(sql\)/)
  assert.doesNotMatch(
    routeSource,
    /const MEMBER_FIELD_DEFINITIONS|const allowedFields|const baseQuery/,
    '라우트가 화이트리스트/FROM 절 사본을 다시 들고 있으면 이 파일의 테스트는 계약을 검증하지 못한다'
  )
})

test('화이트리스트에 없는 컬럼으로 정렬하려 하면 buildSearchQuery가 거부한다', async () => {
  const { buildSearchQuery } = await loadFilteringModule()
  assert.throws(
    () =>
      buildSearchQuery(
        {
          filters: { operator: 'AND', conditions: [] },
          sorts: [{ field: 'mp.password_hash', direction: 'asc', priority: 0 }],
          pagination: { page: 1, limit: 20 },
        },
        MEMBER_SEARCH_BASE_QUERY,
        MEMBER_SEARCH_ALLOWED_FIELDS
      ),
    /Field is not allowed in sort/,
    '정렬 컬럼명은 SQL에 그대로 박힌다 — 화이트리스트가 유일한 방어선이다'
  )
})

test('executeMemberAdvancedSearch: equals 필터(is_admin=true)가 정확히 걸린다', async () => {
  await seedProfile({ display_name: '관리자A', is_admin: true })
  await seedProfile({ display_name: '일반B', is_admin: false })

  const build = buildDataAndCountSql({
    filters: {
      operator: 'AND',
      conditions: [{ field: 'is_admin', operator: 'equals', value: true, type: 'boolean' }],
    },
    pagination: { page: 1, limit: 20 },
  })
  const { dataQuery, countSql, params } = await build()

  const { executeMemberAdvancedSearch } = await loadFreshMiscModule()
  const result = await executeMemberAdvancedSearch(dataQuery, countSql, params)
  assert.ok(result.rows.length >= 1)
  assert.ok(result.rows.every(r => r.is_admin === true))
  assert.equal(result.total, result.rows.length)
})

test('executeMemberAdvancedSearch: contains(ILIKE→LIKE) 필터가 부분 일치를 찾는다', async () => {
  await seedProfile({ display_name: '검색가능한이름' })
  await seedProfile({ display_name: '무관한이름' })

  const build = buildDataAndCountSql({
    filters: {
      operator: 'AND',
      conditions: [
        { field: 'display_name', operator: 'contains', value: '검색가능', type: 'string' },
      ],
    },
    pagination: { page: 1, limit: 20 },
  })
  const { dataQuery, countSql, params } = await build()

  const { executeMemberAdvancedSearch } = await loadFreshMiscModule()
  const result = await executeMemberAdvancedSearch(dataQuery, countSql, params)
  assert.ok(result.rows.some(r => r.display_name === '검색가능한이름'))
  assert.ok(!result.rows.some(r => r.display_name === '무관한이름'))
})

test('executeMemberAdvancedSearch: 날짜 범위 필터(greater_equal, ISO 문자열 → epoch ms 보정)가 동작한다', async () => {
  const oldId = await seedProfile({ display_name: '오래된회원' })
  const newId = await seedProfile({ display_name: '최근회원' })
  const cutoff = new Date('2020-06-01T00:00:00.000Z')
  await setupClient.execute({
    sql: 'UPDATE member_profiles SET created_at = ? WHERE id = ?',
    args: [new Date('2020-01-01T00:00:00.000Z').getTime(), oldId],
  })
  await setupClient.execute({
    sql: 'UPDATE member_profiles SET created_at = ? WHERE id = ?',
    args: [new Date('2021-01-01T00:00:00.000Z').getTime(), newId],
  })

  const build = buildDataAndCountSql({
    filters: {
      operator: 'AND',
      conditions: [
        {
          field: 'created_at',
          operator: 'greater_equal',
          value: cutoff.toISOString(),
          type: 'date',
        },
      ],
    },
    pagination: { page: 1, limit: 20 },
  })
  const { dataQuery, countSql, params } = await build()

  const { executeMemberAdvancedSearch } = await loadFreshMiscModule()
  const result = await executeMemberAdvancedSearch(dataQuery, countSql, params)
  const ids = result.rows.map(r => r.id)
  assert.ok(ids.includes(newId), '기준일 이후 가입자는 포함되어야 한다')
  assert.ok(!ids.includes(oldId), '기준일 이전 가입자는 제외되어야 한다')
})

test('executeMemberAdvancedSearch: 정렬(sort desc)과 페이지네이션(limit/offset)이 원본과 같은 순서를 만든다', async () => {
  const names = ['가나다', '마바사', '아자차']
  for (const name of names) {
    await seedProfile({ display_name: name })
  }

  const build = buildDataAndCountSql({
    filters: {
      operator: 'AND',
      conditions: [{ field: 'display_name', operator: 'in', value: names, type: 'string' }],
    },
    sorts: [{ field: 'display_name', direction: 'desc', priority: 0 }],
    pagination: { page: 1, limit: 2 },
  })
  const { dataQuery, countSql, params } = await build()

  const { executeMemberAdvancedSearch } = await loadFreshMiscModule()
  const result = await executeMemberAdvancedSearch(dataQuery, countSql, params)
  assert.equal(result.total, 3, '카운트 쿼리는 페이지 크기와 무관하게 전체 개수를 돌려줘야 한다')
  assert.equal(result.rows.length, 2, 'limit=2이므로 데이터는 2건만')
  const returnedNames = result.rows.map(r => r.display_name)
  const expectedDesc = [...names].sort().reverse().slice(0, 2)
  assert.deepEqual(returnedNames, expectedDesc)
})

test('executeMemberAdvancedSearch: SQL 인젝션 트립와이어 — 세미콜론/주석이 섞인 SQL은 실행 전에 던진다', async () => {
  const { executeMemberAdvancedSearch } = await loadFreshMiscModule()
  await assert.rejects(() =>
    executeMemberAdvancedSearch(
      'SELECT * FROM member_profiles; DROP TABLE member_profiles;--',
      'SELECT COUNT(*) as total FROM member_profiles',
      []
    )
  )
})
