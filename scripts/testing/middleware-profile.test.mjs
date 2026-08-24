import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * 구조를 고정한다. 미들웨어의 프로필 조회가 다시 RLS 적용 클라이언트로
 * 되돌아가거나, `getProfileById`의 null/throw 계약을 흡수해버리면 승인된
 * 조합원이 미승인 취급되거나(전자) 조회 실패가 조용히 통과로 둔갑한다(후자).
 *
 * 단계 2c: 프로필의 권위는 Turso다. `src/middleware/profile.ts`는 이제
 * `src/db/queries/profiles.ts`의 `getProfileById`를 그대로 통과시킨다.
 */

test('미들웨어 프로필 모듈이 getProfileById를 쓴다', () => {
  const src = readFileSync('src/middleware/profile.ts', 'utf8')
  assert.match(src, /getProfileById/)
})

test('미들웨어 프로필 모듈은 Supabase 클라이언트를 쓰지 않는다', () => {
  const src = readFileSync('src/middleware/profile.ts', 'utf8')
  assert.doesNotMatch(
    src,
    /createServerClient|createSupabaseServer|ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/
  )
})

test('auth.ts가 member_profiles를 직접 조회하지 않는다', () => {
  const src = readFileSync('src/middleware/auth.ts', 'utf8')
  assert.doesNotMatch(src, /from\(['"]member_profiles['"]\)/)
  assert.match(src, /fetchMemberProfileForMiddleware/)
})

test('조회 컬럼 6개가 그대로 유지된다', () => {
  const src = readFileSync('src/middleware/profile.ts', 'utf8')
  for (const col of [
    'registration_status',
    'is_active',
    'is_admin',
    'is_director',
    'is_auditor',
    'display_name',
  ]) {
    assert.match(src, new RegExp(col), `${col}이 빠졌다`)
  }
})

/**
 * "행이 없다"와 "조회를 못 했다"는 다른 사실이고, auth.ts는 그 둘을
 * 다르게 다룬다(전자는 /register/pending, 후자의 catch는 보호 페이지를 /login으로
 * 보낸다). 이 계약이 조용히 무너지면(=실패를 다시 삼켜 null로 뭉개면) 두 실패
 * 사이의 구분이 사라진다 — 아래 테스트는 실제 SQLite 파일 DB로 함수를 직접
 * 호출해서 그 구분이 살아있는지 검증한다(소스 텍스트 패턴 매칭이 아니라 런타임
 * 동작 자체를 본다).
 *
 * `src/db/client.ts`의 `db`는 한 번 접속하면 프로세스 안에서 연결을 재사용한다
 * (`scripts/testing/queriesProfiles.test.mjs` 상단 설명 참고) — 그래서 "깨진
 * 경로" 대조 테스트를 먼저 두고, 올바른 경로(`DB_PATH`)로 바꾸는 줄을 그 다음에
 * 둔다.
 */

const DB_PATH = 'scripts/testing/.middleware-profile-test.db'
const PROFILE_MODULE_URL = new URL('../../src/middleware/profile.ts', import.meta.url)
const PROFILES_QUERY_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshProfileModule() {
  // 매 테스트마다 새로 로드해서 모듈 캐시나 이전 env 값이 섞이지 않게 한다.
  return import(`${PROFILE_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

test('부정 대조 근거: 깨진 DB 경로로 실제 조회를 시도하면 던진다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    await assert.rejects(() =>
      fetchMemberProfileForMiddleware('11111111-1111-1111-1111-111111111111')
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

test('userId가 없으면 조회를 시도하지 않고 던진다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    await assert.rejects(() => fetchMemberProfileForMiddleware(''))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

test('일치하는 행이 없으면 null을 반환하고 던지지 않는다', async () => {
  const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
  const result = await fetchMemberProfileForMiddleware('22222222-2222-2222-2222-222222222222')
  assert.equal(result, null)
})

test('행이 있으면 6개 컬럼만 담아 반환한다', async () => {
  const { upsertProfile } = await import(
    `${PROFILES_QUERY_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`
  )
  const id = 'mw-profile-1'
  await upsertProfile({
    id,
    email: 'mw1@test.local',
    display_name: '미들웨어테스트',
    registration_status: 'approved',
    is_active: true,
    is_admin: false,
    is_director: true,
    is_auditor: false,
  })

  const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
  const result = await fetchMemberProfileForMiddleware(id)
  assert.deepEqual(result, {
    registration_status: 'approved',
    is_active: true,
    is_admin: false,
    is_director: true,
    is_auditor: false,
    display_name: '미들웨어테스트',
  })
})
