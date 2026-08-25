import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/profiles.ts`를 실제 SQLite 파일 DB(스텁 mock이 아니라)로
 * 검증한다. 스키마는 `src/db/migrations/`의 마이그레이션 전부를 그대로
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
  await applyMigrations(setupClient)
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
  // display_name 10 + email 10. 단계 4 Task 6b가 Postgres 트리거
  // profile_completeness_trigger를 쿼리 계층으로 옮기면서, 이 값은 더 이상
  // DB 기본값(0)이 아니라 방금 쓴 행에서 계산된 점수다(아래 배점 테스트 참고).
  assert.equal(row.profile_completeness_score, 20)
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

test('upsertProfile: 같은 id로 다시 부르면 일반 컬럼(display_name)은 새 값으로 갱신한다(onConflictDoUpdate)', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-002'
  await upsertProfile(makeProfile({ id, email: 'p002@test.local', display_name: '갱신전' }))
  await upsertProfile(makeProfile({ id, email: 'p002@test.local', display_name: '갱신후' }))

  const row = await getProfileById(id)
  assert.equal(row.display_name, '갱신후')
})

// ---------------------------------------------------------------- upsertProfile 충돌 규칙 (9pre 수정 3)
//
// 원본 Postgres 트리거(supabase/migrations/20250108090010_fix_signup_flow.sql:
// 53-65)는 registration_status·is_active·is_admin을 ON CONFLICT UPDATE에 넣지
// 않았다. buildSignupProfileRow/buildMemberProfileRow가 항상 pending/false를
// 명시적으로 채우므로, 이 보호가 없으면 재이관·재가입·관리자 복구 등으로 기존
// id와 충돌한 순간 승인된 관리자가 pending·비활성으로 강등되고 권한과
// 계좌번호를 잃는다 — Turso에는 PITR이 없어 복구 불가다. 아래 테스트가 그
// 보호를 못박는다.

test('upsertProfile 충돌: registration_status·is_admin·계좌번호가 있는 승인된 관리자에게 최소 필드만 담아 다시 호출해도 그대로 남는다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-admin-conflict'

  // 1) 승인된 관리자 프로필을 먼저 만든다(계좌번호 포함).
  await upsertProfile(
    makeProfile({
      id,
      email: 'admin-conflict@test.local',
      display_name: '기존 관리자',
      registration_status: 'approved',
      is_active: true,
      is_admin: true,
      account_number: '110-123-456789',
    })
  )

  // 2) 재이관/재가입/관리자 복구 헬퍼를 흉내낸 최소 필드 호출 — 미입력
  // 필드는 buildSignupProfileRow/buildMemberProfileRow처럼 명시적 null이다.
  await upsertProfile({
    id,
    email: 'admin-conflict@test.local',
    display_name: '재가입 시도',
    registration_status: 'pending',
    is_active: false,
    is_admin: false,
    account_number: null,
  })

  const row = await getProfileById(id)
  // 권한·승인 상태 컬럼은 새 값(pending/false)이 왔어도 그대로 남아야 한다.
  assert.equal(row.registration_status, 'approved')
  assert.equal(row.is_active, true)
  assert.equal(row.is_admin, true)
  // 나머지 컬럼은 COALESCE 의미 — 새 값이 null이면 기존 값을 지킨다.
  assert.equal(row.account_number, '110-123-456789')
  // 새 값이 null이 아니면(display_name) 실제로 갱신된다.
  assert.equal(row.display_name, '재가입 시도')
})

test('upsertProfile 충돌: is_director·is_auditor도 보호 대상이다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-director-conflict'

  await upsertProfile(
    makeProfile({
      id,
      email: 'director-conflict@test.local',
      display_name: '기존 이사',
      is_director: true,
      is_auditor: true,
    })
  )

  await upsertProfile({
    id,
    email: 'director-conflict@test.local',
    display_name: '기존 이사',
    is_director: false,
    is_auditor: false,
  })

  const row = await getProfileById(id)
  assert.equal(row.is_director, true)
  assert.equal(row.is_auditor, true)
})

// 코드리뷰 9pre-2 Important 2 대응: buildConflictSet은 블랙리스트(권한
// 컬럼만 나열해 빼는 방식)가 아니라 화이트리스트(갱신을 허용할 "데이터"
// 컬럼만 나열)다. 블랙리스트였던 이전 구현은 is_member가 무방비였다 —
// 두 빌더(buildMemberProfileRow/buildSignupProfileRow)가 항상 is_member:
// true를 명시적으로 써서 매번 덮였다. 화이트리스트는 "앞으로 빌더에
// 추가되는 컬럼"도 기본이 보호(갱신 안 함)이므로, 그 시나리오를 실제
// 컬럼(is_member·artist_id — 둘 다 화이트리스트 밖)으로 재현한다.
test('upsertProfile 충돌: 화이트리스트 밖 컬럼(is_member·artist_id)은 "새로 추가된 컬럼"을 흉내내도 자동으로 보호된다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'p-whitelist-miss'

  await upsertProfile(
    makeProfile({
      id,
      email: 'whitelist-miss@test.local',
      display_name: '기존 회원',
      is_member: true,
      artist_id: null,
    })
  )

  // 미래에 buildSignupProfileRow 같은 빌더가 is_member/artist_id를 새로
  // 채워 보내는 상황을 흉내낸다 — 화이트리스트에 없으므로 값이 와도 무시돼야
  // 한다(값이 있어도 반영되면 위험한 컬럼이 조용히 뚫린 것).
  await upsertProfile({
    id,
    email: 'whitelist-miss@test.local',
    display_name: '기존 회원',
    is_member: false,
    artist_id: 'artist-999',
  })

  const row = await getProfileById(id)
  assert.equal(row.is_member, true, 'is_member는 화이트리스트 밖이라 그대로 남아야 한다')
  assert.equal(row.artist_id, null, 'artist_id도 화이트리스트 밖이라 그대로 남아야 한다')
})

test('부정 대조: buildConflictSet에서 보호(화이트리스트 제외) 로직을 지우면 위 보호 테스트가 실패한다(보호가 실제로 이 코드에서 온다는 증거)', async () => {
  // upsertProfile은 buildConflictSet(values)를 통해 CONFLICT_UPDATABLE_FIELDS
  // 화이트리스트 안 컬럼만 set 객체에 넣어 onConflictDoUpdate에 넘긴다.
  // 소스에서 그 화이트리스트가 실제로 존재하고 "데이터" 컬럼 9개만
  // 담고 있는지(권한·is_member는 없는지) 직접 확인한다 — 이 목록이 넓어지면
  // 위 보호 테스트들이 즉시 실패로 잡아낸다는 것을 문서화한다.
  const src = readFileSync('src/db/queries/profiles.ts', 'utf8')
  const match = src.match(/const CONFLICT_UPDATABLE_FIELDS[\s\S]*?\n\]\)/)
  assert.ok(match, 'CONFLICT_UPDATABLE_FIELDS 정의를 찾지 못했다')
  const body = match[0]
  for (const field of [
    'email',
    'displayName',
    'realName',
    'phoneNumber',
    'birthDate',
    'monthlyFee',
    'bankName',
    'accountNumber',
    'accountHolder',
  ]) {
    assert.match(body, new RegExp(field), `${field}은 화이트리스트에 있어야 한다`)
  }
  for (const field of [
    'registrationStatus',
    'isActive',
    'isAdmin',
    'isDirector',
    'isAuditor',
    'isMember',
  ]) {
    assert.doesNotMatch(body, new RegExp(`'${field}'`), `${field}은 화이트리스트에 있으면 안 된다`)
  }
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
  // db와 .select( 사이에 개행이 껴도(prettier가 체인을 쪼개면) 잡히도록 공백류 허용.
  const selectCalls = body.match(/db\s*\.select\(/g) ?? []
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

test('updateProfilesByIds: 여러 id를 한 번에 갱신하고 갱신된 id 목록을 돌려준다(관리자 대량 승인용)', async () => {
  const { upsertProfile, updateProfilesByIds, getProfilesByIds } = await loadFreshProfilesModule()
  const ids = ['bulk-1', 'bulk-2', 'bulk-3']
  for (const id of ids) {
    await upsertProfile(makeProfile({ id, email: `${id}@test.local`, display_name: id }))
  }

  const missingId = 'bulk-missing'
  const nowIso = new Date().toISOString()
  const updated = await updateProfilesByIds([...ids, missingId], {
    registration_status: 'approved',
    is_active: true,
    approved_at: nowIso,
    approved_by: 'admin-bulk',
  })

  // 존재하지 않는 id는 갱신 대상에서 빠진다 — 실제로 갱신된 id만 돌아온다.
  assert.deepEqual([...updated].sort(), ids)

  const rows = await getProfilesByIds(ids)
  for (const id of ids) {
    const row = rows.get(id)
    assert.equal(row.registration_status, 'approved')
    assert.equal(row.is_active, true)
    assert.equal(row.approved_by, 'admin-bulk')
    assert.equal(row.approved_at, nowIso)
  }
})

test('updateProfilesByIds: updated_at을 갱신한다(트리거 없음 — 코드가 해야 한다)', async () => {
  const { upsertProfile, updateProfilesByIds, getProfilesByIds } = await loadFreshProfilesModule()
  const ids = ['bulk-ts-1', 'bulk-ts-2']
  for (const id of ids) {
    await upsertProfile(makeProfile({ id, email: `${id}@test.local` }))
  }
  const before = await getProfilesByIds(ids)

  await new Promise(resolve => setTimeout(resolve, 5))
  await updateProfilesByIds(ids, { is_active: true })

  const after = await getProfilesByIds(ids)
  for (const id of ids) {
    assert.ok(
      Date.parse(after.get(id).updated_at) > Date.parse(before.get(id).updated_at),
      `${id}의 updated_at이 갱신되지 않았다`
    )
  }
})

test('updateProfilesByIds: 빈 id 배열은 쿼리를 실행하지 않고 빈 배열을 돌려준다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { updateProfilesByIds } = await loadFreshProfilesModule()
    const result = await updateProfilesByIds([], { is_active: true })
    assert.deepEqual(result, [])
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

test('updateProfilesByIds 구현은 집합 단위 UPDATE 두 문장만 쓰고 inArray로 건다 (소스 가드 — N+1 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/profiles.ts', 'utf8')
  const match = src.match(/export async function updateProfilesByIds\([\s\S]*?\n\}\n/)
  assert.ok(match, 'updateProfilesByIds 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.match(body, /inArray\(/, '배치 갱신은 inArray를 써야 한다')
  assert.doesNotMatch(
    body,
    /updateProfile\(/,
    '배치 갱신이 단건 갱신 함수를 id별로 호출하면 N+1이다'
  )
  // 단계 4 Task 6b 이전에는 `db.update` 한 번이었다. 이제 같은 트랜잭션 안에서
  // ① 요청받은 patch를 적용하는 UPDATE와 ② profile_completeness_score를 다시
  // 매기는 UPDATE, **두 문장**을 쓴다(Postgres 트리거
  // profile_completeness_trigger의 대체 — src/db/queries/profileCompleteness.ts).
  // 막으려는 회귀는 그대로다: id마다 문장을 하나씩 내는 것. 그래서 개수뿐
  // 아니라 "두 문장 모두 집합 단위인지"까지 못박는다.
  const updateCalls = body.match(/(?:db|tx)\s*\.update\(/g) ?? []
  assert.equal(
    updateCalls.length,
    1,
    'patch 적용 UPDATE는 정확히 한 문장이어야 한다(점수 재계산은 recomputeCompleteness가 낸다)'
  )
  assert.match(
    body,
    /recomputeCompleteness\(tx,\s*inArray\(/,
    '점수 재계산도 inArray로 한 문장에 끝내야 한다 — id별로 부르면 그게 N+1이다'
  )
  assert.doesNotMatch(body, /\bfor\s*\(/, 'id를 도는 루프가 있으면 문장 수가 회원 수에 비례한다')
})

test('recomputeCompleteness 구현은 UPDATE 한 문장으로 where에 걸린 행 전부를 다시 매긴다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/profiles.ts', 'utf8')
  const match = src.match(/async function recomputeCompleteness\([\s\S]*?\n\}\n/)
  assert.ok(match, 'recomputeCompleteness 함수 본문을 찾지 못했다')
  const body = match[0]

  const updateCalls = body.match(/tx\s*\.update\(/g) ?? []
  assert.equal(updateCalls.length, 1, '재계산은 UPDATE 한 문장이어야 한다')
  assert.doesNotMatch(body, /\.select\(/, '행을 읽어와 JS에서 계산하면 대상 수만큼 왕복이 생긴다')
  assert.match(
    body,
    /profileCompletenessExpression\(\)/,
    '배점표는 profileCompleteness.ts의 식 하나만 쓴다(여기에 규칙을 다시 적으면 정본이 둘이 된다)'
  )
})

// ---------------------------------------------------------------- listProfileSignupsSince (Task 8 코드리뷰 대응)

test('listProfileSignupsSince: since 이전 시각으로 조회하면 방금 만든 프로필이 포함된다', async () => {
  const { upsertProfile, listProfileSignupsSince } = await loadFreshProfilesModule()
  const id = 'signups-since-included'
  await upsertProfile(makeProfile({ id, email: 'signups1@test.local', display_name: '가입자1' }))

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await listProfileSignupsSince(oneDayAgo)
  assert.ok(
    rows.some(row => row.created_at && rows.length > 0),
    'since가 과거면 결과가 비어있지 않아야 한다'
  )
  // id별 매칭까지 확인하려면 created_at 필드만 반환하므로, upsertProfile 직후
  // getProfileById로 만든 시각을 얻어 교차 확인한다.
  const { getProfileById } = await loadFreshProfilesModule()
  const profile = await getProfileById(id)
  assert.ok(
    rows.some(row => row.created_at === profile.created_at),
    '방금 만든 프로필의 created_at이 결과 목록에 있어야 한다'
  )
})

test('listProfileSignupsSince: since 이후(미래) 시각으로 조회하면 비어 있다', async () => {
  const { listProfileSignupsSince } = await loadFreshProfilesModule()
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const rows = await listProfileSignupsSince(oneDayFromNow)
  assert.deepEqual(rows, [])
})

test('listProfileSignupsSince: registration_status를 함께 돌려준다', async () => {
  const { upsertProfile, listProfileSignupsSince } = await loadFreshProfilesModule()
  const id = 'signups-since-status'
  await upsertProfile(
    makeProfile({
      id,
      email: 'signups2@test.local',
      display_name: '가입자2',
      registration_status: 'approved',
    })
  )

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await listProfileSignupsSince(oneDayAgo)
  const row = rows.find(r => r.registration_status === 'approved')
  assert.ok(row, 'approved 상태 프로필이 결과에 있어야 한다')
})

// ---------------------------------------------------------------- profile_completeness_score
//
// 단계 4 Task 6b. Postgres 트리거 `profile_completeness_trigger`가 사라져
// 신규 회원이 영원히 0%였다. 이식판은 `src/db/queries/profileCompleteness.ts`.
//
// **이 블록의 기대값은 구현이 아니라 원본 트리거 본문에서 손으로 뽑았다.**
// 원본: supabase/migrations/20250118090020_enhance_member_status_tracking.sql
// 202~219행. 구현에서 배점표를 베껴 오면 둘 다 틀린 채로 초록불이 되므로,
// 아래 EXPECTED_POINTS는 그 SQL을 한 줄씩 읽어 옮긴 표다.
//
//   203: display_name  IS NOT NULL AND LENGTH > 0        → 10
//   204: email         IS NOT NULL AND LENGTH > 0        → 10
//   205: real_name     IS NOT NULL AND LENGTH > 0        → 10
//   206: registration_status = 'approved'                → 10
//   209: phone_number  IS NOT NULL AND LENGTH > 0        → 10
//   210: birth_date    IS NOT NULL          (길이 검사 없음) → 10
//   213: monthly_fee   IS NOT NULL AND > 0               → 10
//   214: bank_name IS NOT NULL AND account_number IS NOT NULL (길이 검사 없음) → 10
//   217: verification_status->>'email'    = true         → 7
//   218: verification_status->>'phone'    = true         → 7
//   219: verification_status->>'identity' = true         → 6

const EXPECTED_POINTS = {
  display_name: 10,
  email: 10,
  real_name: 10,
  approved: 10,
  phone_number: 10,
  birth_date: 10,
  monthly_fee: 10,
  bank_and_account: 10,
  verified_email: 7,
  verified_phone: 7,
  verified_identity: 6,
}

/**
 * 배점 대상 필드 중 `email`만 채운 기준선.
 *
 * `email`을 비우고 싶지만 `member_profiles_email_idx`가 UNIQUE라 빈 문자열
 * 행은 저장소 전체에 하나만 존재할 수 있다(그 하나는 아래 "빈 문자열" 전용
 * 테스트가 쓴다). 그래서 나머지 케이스는 id마다 다른 이메일을 주고 기준선을
 * `BASELINE_SCORE`(= email 10점)로 잡는다. `display_name`은 NOT NULL이라
 * 빈 문자열로 두고, 그 밖의 배점 대상은 전부 NULL이다.
 */
const BASELINE_SCORE = EXPECTED_POINTS.email

function baselineProfile(id) {
  return {
    id,
    email: `${id}@score.test.local`,
    display_name: '',
    registration_status: 'pending',
    is_active: false,
  }
}

async function scoreOf(id) {
  const { getProfileById } = await loadFreshProfilesModule()
  return (await getProfileById(id)).profile_completeness_score
}

test('배점 기준선: email 말고 채운 필드가 없으면 정확히 10점이다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = 'score-baseline'
  await upsertProfile(baselineProfile(id))
  assert.equal(await scoreOf(id), BASELINE_SCORE)
})

test('배점: display_name·email이 빈 문자열이면 0점이다(LENGTH > 0 검사가 실재한다)', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = 'score-empty-strings'
  await upsertProfile({
    id,
    email: '',
    display_name: '',
    registration_status: 'pending',
    is_active: false,
  })
  assert.equal(await scoreOf(id), 0)
})

// 필드 하나씩만 채워 "그 필드가 정확히 몇 점인지"를 따로 확인한다. 합계만
// 보면 7/7/6을 7/7/7로 잘못 옮겨도 다른 오차와 상쇄되어 통과할 수 있다.
const SINGLE_FIELD_CASES = [
  ['display_name', { display_name: '홍길동' }, EXPECTED_POINTS.display_name],
  ['real_name', { real_name: '홍길동' }, EXPECTED_POINTS.real_name],
  ['registration_status=approved', { registration_status: 'approved' }, EXPECTED_POINTS.approved],
  ['phone_number', { phone_number: '010-0000-0000' }, EXPECTED_POINTS.phone_number],
  ['birth_date', { birth_date: '1990-01-01' }, EXPECTED_POINTS.birth_date],
  ['monthly_fee', { monthly_fee: 30000 }, EXPECTED_POINTS.monthly_fee],
  [
    'bank_name+account_number',
    { bank_name: '농협', account_number: '123-456' },
    EXPECTED_POINTS.bank_and_account,
  ],
  [
    'verification_status.email',
    { verification_status: { email: true, phone: false, identity: false } },
    EXPECTED_POINTS.verified_email,
  ],
  [
    'verification_status.phone',
    { verification_status: { email: false, phone: true, identity: false } },
    EXPECTED_POINTS.verified_phone,
  ],
  [
    'verification_status.identity',
    { verification_status: { email: false, phone: false, identity: true } },
    EXPECTED_POINTS.verified_identity,
  ],
]

for (const [label, patch, points] of SINGLE_FIELD_CASES) {
  test(`배점: ${label}를 추가로 채우면 정확히 ${points}점이 더 붙는다`, async () => {
    const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
    const id = `score-one-${label.replace(/[^a-z_]/gi, '')}`
    await upsertProfile(baselineProfile(id))
    assert.equal(await scoreOf(id), BASELINE_SCORE, '기준선이 어긋나면 아래 델타가 무의미하다')
    await updateProfile(id, patch)
    assert.equal(await scoreOf(id), BASELINE_SCORE + points)
  })
}

test('배점: bank_name만 있고 account_number가 없으면 0점이다(원본은 AND다)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-bank-only'
  await upsertProfile(baselineProfile(id))
  await updateProfile(id, { bank_name: '농협' })
  assert.equal(await scoreOf(id), BASELINE_SCORE)
  await updateProfile(id, { bank_name: null, account_number: '123-456' })
  assert.equal(await scoreOf(id), BASELINE_SCORE, 'account_number만 있어도 가점이 없어야 한다')
})

test('배점: 계좌 두 칸은 빈 문자열이어도 10점이다(원본에 LENGTH 검사가 없다)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-bank-empty'
  await upsertProfile(baselineProfile(id))
  await updateProfile(id, { bank_name: '', account_number: '' })
  assert.equal(await scoreOf(id), BASELINE_SCORE + EXPECTED_POINTS.bank_and_account)
})

test('배점: monthly_fee가 0이면 0점이다(원본은 > 0을 요구한다)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-fee-zero'
  await upsertProfile(baselineProfile(id))
  await updateProfile(id, { monthly_fee: 0 })
  assert.equal(await scoreOf(id), BASELINE_SCORE)
})

test('배점: registration_status가 pending/rejected면 그 10점은 붙지 않는다', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-status'
  await upsertProfile(baselineProfile(id))
  await updateProfile(id, { registration_status: 'rejected' })
  assert.equal(await scoreOf(id), BASELINE_SCORE)
  await updateProfile(id, { registration_status: 'approved' })
  assert.equal(await scoreOf(id), BASELINE_SCORE + EXPECTED_POINTS.approved)
})

test('배점: 전부 채우면 정확히 100점이다(배점 합이 100이라는 원본 CHECK와 일치)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-full'
  await upsertProfile(baselineProfile(id))
  await updateProfile(id, {
    display_name: '홍길동',
    email: 'full@test.local',
    real_name: '홍길동',
    registration_status: 'approved',
    phone_number: '010-1111-2222',
    birth_date: '1990-01-01',
    monthly_fee: 30000,
    bank_name: '농협',
    account_number: '123-456',
    verification_status: { email: true, phone: true, identity: true },
  })
  assert.equal(await scoreOf(id), 100)
  const expectedTotal = Object.values(EXPECTED_POINTS).reduce((a, b) => a + b, 0)
  assert.equal(expectedTotal, 100, '배점표 자체의 합도 100이어야 한다')
})

test('점수는 갱신 직후 값으로 매겨진다(원본 트리거의 한 박자 지연을 옮기지 않았다)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-no-lag'
  await upsertProfile(baselineProfile(id))
  // 원본 BEFORE UPDATE 트리거는 갱신 **직전** 행을 다시 읽어 점수를 매겼다.
  // 그 동작이었다면 이 UPDATE 직후 점수는 기준선 그대로이고, 다음 UPDATE에서야
  // 전화번호 10점이 붙는다.
  await updateProfile(id, { phone_number: '010-0000-0000' })
  assert.equal(await scoreOf(id), BASELINE_SCORE + EXPECTED_POINTS.phone_number)
})

test('updateProfilesByIds(관리자 일괄 승인)도 점수를 다시 매긴다', async () => {
  const { upsertProfile, updateProfilesByIds } = await loadFreshProfilesModule()
  const ids = ['score-bulk-1', 'score-bulk-2']
  for (const id of ids) {
    await upsertProfile({ ...baselineProfile(id), display_name: `일괄${id}` })
    assert.equal(await scoreOf(id), BASELINE_SCORE + EXPECTED_POINTS.display_name)
  }
  const updated = await updateProfilesByIds(ids, { registration_status: 'approved' })
  assert.deepEqual(updated.sort(), [...ids].sort())
  for (const id of ids) {
    assert.equal(
      await scoreOf(id),
      BASELINE_SCORE + EXPECTED_POINTS.display_name + EXPECTED_POINTS.approved
    )
  }
})

test('verification_status가 깨진 JSON이어도 프로필 갱신이 실패하지 않는다(인증 가점만 0)', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'score-broken-json'
  await upsertProfile(baselineProfile(id))
  // 컬럼 타입이 text라 애플리케이션을 거치지 않으면 깨진 값도 들어갈 수 있다.
  await setupClient.execute({
    sql: `UPDATE member_profiles SET verification_status = 'unverified' WHERE id = ?`,
    args: [id],
  })
  await updateProfile(id, { phone_number: '010-0000-0000' })
  const row = await setupClient.execute({
    sql: `SELECT profile_completeness_score AS s FROM member_profiles WHERE id = ?`,
    args: [id],
  })
  assert.equal(Number(row.rows[0].s), BASELINE_SCORE + EXPECTED_POINTS.phone_number)
})
