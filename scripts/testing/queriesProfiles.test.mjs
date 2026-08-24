import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/profiles.ts`를 실제 SQLite 파일 DB(스텁 mock이 아니라)로
 * 검증한다. 스키마는 `src/db/migrations/0000_dizzy_krista_starr.sql`을 그대로
 * 실행해 만든다 — `scripts/testing/contentMapping.test.mjs`·
 * `scripts/testing/migrate-loader.test.mjs`와 같은 패턴이다.
 *
 * `src/db/client.ts`의 `db`는 지연 생성 Proxy이고, 한 번 접속하면 그 연결을
 * 프로세스 안에서 계속 재사용한다(`cachedRawClient`/`cachedDb`). 그래서 이
 * 파일의 테스트 순서가 중요하다 — "깨진 경로" 대조 테스트(맨 앞)가 실제 DB에
 * 처음 접속하기 전에 먼저 실행돼야, 이후 테스트에서 올바른 경로로 접속한
 * 캐시가 깨진 경로로 오염되지 않는다. `profiles.ts` 자체는 매번 캐시 무효화
 * 쿼리스트링으로 새로 import하지만, 그 안에서 다시 import하는 `../client.ts`는
 * 쿼리스트링이 없는 고정 경로라 Node 모듈 캐시가 그대로 유지된다 — 즉
 * `client.ts`의 내부 캐시(raw client)는 이 파일 전체에서 "처음 실제로 접근한
 * 시점의 `TURSO_DATABASE_URL`"로 한 번 고정된다.
 */

const DB_PATH = 'scripts/testing/.queries-profiles-test.db'
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await setupClient.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: getProfilesByIds([])는 실제로 DB에 접속하지 않는다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  // 존재하지 않는 디렉터리 — 실제로 쿼리를 시도하면 파일을 열 수 없어 던진다.
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getProfilesByIds } = await loadFreshProfilesModule()
    const result = await getProfilesByIds([])
    assert.deepEqual(result, new Map())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

test('위 대조의 근거: 같은 깨진 경로로 실제 조회를 시도하면 던진다(빈 배열 분기가 예외적으로 조용한 게 아님을 확인)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getProfileById } = await loadFreshProfilesModule()
    await assert.rejects(() => getProfileById('any-id'))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

function makeProfile(overrides = {}) {
  return {
    id: overrides.id,
    email: overrides.email,
    display_name: overrides.display_name ?? '테스트회원',
    registration_status: overrides.registration_status ?? 'pending',
    is_active: overrides.is_active ?? false,
    ...overrides,
  }
}

test('getProfileById: 없는 id는 null을 돌려준다', async () => {
  const { getProfileById } = await loadFreshProfilesModule()
  const result = await getProfileById('00000000-0000-4000-8000-000000000000')
  assert.equal(result, null)
})

test('upsertProfile로 생성한 행을 getProfileById가 snake_case + ISO 타임스탬프로 돌려준다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-001'
  await upsertProfile(makeProfile({ id, email: 'p001@test.local', display_name: '홍길동' }))

  const row = await getProfileById(id)
  assert.ok(row)
  assert.equal(row.id, id)
  assert.equal(row.display_name, '홍길동')
  assert.equal(row.email, 'p001@test.local')
  assert.equal(row.registration_status, 'pending')
  assert.equal(row.is_active, false)
  assert.equal(row.is_member, true) // DB 기본값
  assert.equal(row.profile_completeness_score, 0) // DB 기본값
  assert.deepEqual(row.verification_status, { email: false, phone: false, identity: false })

  // snake_case 키만 있어야 한다 — camelCase 키가 섞이면 프런트가 못 읽는다.
  for (const key of Object.keys(row)) {
    assert.doesNotMatch(key, /[A-Z]/, `${key}는 camelCase 흔적이다`)
  }

  // 타임스탬프는 Date 객체가 아니라 ISO 문자열이어야 한다.
  assert.equal(typeof row.created_at, 'string')
  assert.equal(typeof row.updated_at, 'string')
  assert.ok(!Number.isNaN(Date.parse(row.created_at)))
})

test('upsertProfile: 같은 id로 다시 부르면 갱신한다(onConflictDoUpdate)', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-002'
  await upsertProfile(makeProfile({ id, email: 'p002@test.local', display_name: '갱신전' }))
  await upsertProfile(
    makeProfile({
      id,
      email: 'p002@test.local',
      display_name: '갱신후',
      registration_status: 'approved',
      is_active: true,
    })
  )

  const row = await getProfileById(id)
  assert.equal(row.display_name, '갱신후')
  assert.equal(row.registration_status, 'approved')
  assert.equal(row.is_active, true)
})

test('getProfilesByIds: 쿼리 한 번으로 여러 프로필을 가져오고, 존재하지 않는 id는 결과에서 빠진다', async () => {
  const { upsertProfile, getProfilesByIds } = await loadFreshProfilesModule()
  const ids = ['batch-1', 'batch-2', 'batch-3']
  for (const id of ids) {
    await upsertProfile(makeProfile({ id, email: `${id}@test.local`, display_name: id }))
  }

  const missingId = '00000000-batch-missing'
  const result = await getProfilesByIds([...ids, missingId])

  assert.equal(result.size, 3)
  for (const id of ids) {
    assert.equal(result.get(id)?.display_name, id)
  }
  assert.equal(result.has(missingId), false)
})

test('getProfilesByIds 구현은 db.select를 정확히 한 번만 호출하고 inArray를 쓴다 (소스 가드 — N+1 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/profiles.ts', 'utf8')
  const match = src.match(/export async function getProfilesByIds\([\s\S]*?\n\}\n/)
  assert.ok(match, 'getProfilesByIds 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.match(body, /inArray\(/, '배치 조회는 inArray를 써야 한다')
  assert.doesNotMatch(
    body,
    /getProfileById\(/,
    '배치 조회가 단건 조회 함수를 id별로 호출하면 N+1이다'
  )
  const selectCalls = body.match(/db\.select\(/g) ?? []
  assert.equal(selectCalls.length, 1, 'db.select 호출이 정확히 한 번이어야 한다(쿼리 한 번)')
})

test('listProfiles: status 필터·search·페이지네이션·total이 동작한다', async () => {
  const { upsertProfile, listProfiles } = await loadFreshProfilesModule()
  await upsertProfile(
    makeProfile({
      id: 'list-approved-1',
      email: 'approved1@test.local',
      display_name: '김승인',
      registration_status: 'approved',
      is_active: true,
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'list-approved-2',
      email: 'approved2@test.local',
      display_name: '이승인',
      registration_status: 'approved',
      is_active: true,
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'list-pending-1',
      email: 'pending1@test.local',
      display_name: '박대기',
      registration_status: 'pending',
    })
  )

  const approvedOnly = await listProfiles({ status: 'approved', limit: 50, offset: 0 })
  assert.ok(approvedOnly.rows.every(r => r.registration_status === 'approved'))
  assert.ok(approvedOnly.rows.some(r => r.id === 'list-approved-1'))
  assert.ok(!approvedOnly.rows.some(r => r.id === 'list-pending-1'))
  assert.ok(approvedOnly.total >= 2)

  const searched = await listProfiles({ search: '김승인', limit: 50, offset: 0 })
  assert.ok(searched.rows.some(r => r.id === 'list-approved-1'))
  assert.ok(!searched.rows.some(r => r.id === 'list-approved-2'))

  const page1 = await listProfiles({ limit: 1, offset: 0 })
  const page2 = await listProfiles({ limit: 1, offset: 1 })
  assert.equal(page1.rows.length, 1)
  assert.equal(page2.rows.length, 1)
  assert.notEqual(page1.rows[0].id, page2.rows[0].id)
  assert.equal(page1.total, page2.total)
})

test('updateProfile: 패치한 필드가 반영되고 updated_at이 갱신된다(트리거 없음 — 코드가 해야 한다)', async () => {
  const { upsertProfile, updateProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-update-1'
  await upsertProfile(makeProfile({ id, email: 'update1@test.local', display_name: '전' }))
  const before = await getProfileById(id)

  await new Promise(resolve => setTimeout(resolve, 5))
  await updateProfile(id, { display_name: '후', phone_number: '010-0000-0000' })

  const after = await getProfileById(id)
  assert.equal(after.display_name, '후')
  assert.equal(after.phone_number, '010-0000-0000')
  assert.ok(
    Date.parse(after.updated_at) > Date.parse(before.updated_at),
    'updated_at이 갱신되지 않았다'
  )
})

test('updateProfile: 관리자 승인 흐름에서 쓰는 타임스탬프 컬럼(approved_at)을 ISO 문자열로 써도 정상 저장된다', async () => {
  const { upsertProfile, updateProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-approve-1'
  await upsertProfile(makeProfile({ id, email: 'approve1@test.local' }))

  const approvedAtIso = new Date().toISOString()
  await updateProfile(id, {
    registration_status: 'approved',
    is_active: true,
    approved_at: approvedAtIso,
    approved_by: 'admin-1',
  })

  const row = await getProfileById(id)
  assert.equal(row.registration_status, 'approved')
  assert.equal(row.is_active, true)
  assert.equal(row.approved_by, 'admin-1')
  assert.equal(row.approved_at, approvedAtIso)
})

test('updateProfile: 빈 patch는 쿼리를 실행하지 않는다(호출 자체는 성공)', async () => {
  const { upsertProfile, updateProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-empty-patch'
  await upsertProfile(makeProfile({ id, email: 'empty@test.local' }))
  const before = await getProfileById(id)

  await updateProfile(id, {})

  const after = await getProfileById(id)
  assert.deepEqual(after, before)
})
