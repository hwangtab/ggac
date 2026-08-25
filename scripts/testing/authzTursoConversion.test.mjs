import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { register } from 'node:module'
import { createClient } from '@libsql/client'

/**
 * 단계 2c 남은 권한 판정 원천 3개(`authz.ts`/`adminAuth.ts`/`boardRoomAuth.ts`)의
 * `member_profiles` 조회를 Turso 쿼리 계층(`src/db/queries/profiles.ts`)으로
 * 옮긴 것을 실제 SQLite 파일 DB로 검증한다. `verify-session`/`auth/callback`
 * 라우트는 `next/headers` 요청 스코프에 묶여 있어 여기서는 직접 호출하지
 * 않고(별도 소스 가드 테스트로 다룬다), 이 파일은 라우트가 실제로 의존하는
 * DB 조회 로직(`resolveSessionProfile`/`checkAdminPermission`/
 * `getDirectorRoster`/`getAuditorRoster`)만 검증한다.
 *
 * `@/*` 별칭과 `next/server`(exports 필드 없는 서브패스)는 플레인
 * `node --test`의 기본 ESM 리졸버가 풀지 못한다 — `scripts/testing/memberAuth.test.mjs`가
 * 먼저 만든 리졸브 훅을 그대로 재사용한다(각 테스트 파일은 `node --test`가
 * 프로세스를 격리해 돌리므로 이 훅이 다른 파일에 영향을 주지 않는다).
 */
const projectRootUrl = new URL('../../', import.meta.url).href
const resolveHookSource = `
const ROOT = ${JSON.stringify(projectRootUrl)}
const FALLBACK_SUFFIXES = ['.ts', '.js', '/index.ts']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL('src/' + specifier.slice(2) + '.ts', ROOT).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isResolutionError =
      err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (isResolutionError && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      for (const suffix of FALLBACK_SUFFIXES) {
        try {
          return await nextResolve(specifier + suffix, context)
        } catch {
          // 다음 후보 확장자로 계속 시도한다.
        }
      }
    }
    throw err
  }
}
`
register('data:text/javascript,' + encodeURIComponent(resolveHookSource), import.meta.url)

// ---------------------------------------------------------------- 소스 가드: member_profiles 직접 조회가 남아있지 않다

test('authz.ts/adminAuth.ts/boardRoomAuth.ts는 더 이상 member_profiles를 직접 조회하지 않는다', () => {
  for (const file of [
    'src/lib/server/authz.ts',
    'src/lib/server/adminAuth.ts',
    'src/lib/server/boardRoomAuth.ts',
  ]) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      src,
      /from\(['"]member_profiles['"]\)/,
      `${file}에 member_profiles 직접 조회가 남아있다`
    )
  }
})

test('세 파일 모두 프로필 조회를 src/db/queries/profiles.ts로 위임한다', () => {
  const authz = readFileSync('src/lib/server/authz.ts', 'utf8')
  const adminAuth = readFileSync('src/lib/server/adminAuth.ts', 'utf8')
  const boardRoomAuth = readFileSync('src/lib/server/boardRoomAuth.ts', 'utf8')
  assert.match(authz, /from\s+['"]@\/db\/queries\/profiles['"]/)
  assert.match(authz, /getProfileById/)
  assert.match(adminAuth, /from\s+['"]@\/db\/queries\/profiles['"]/)
  assert.match(adminAuth, /getProfileById/)
  assert.match(boardRoomAuth, /from\s+['"]@\/db\/queries\/profiles['"]/)
  assert.match(boardRoomAuth, /listProfiles/)
})

// ---------------------------------------------------------------- 실제 SQLite 대상 테스트

const DB_PATH = 'scripts/testing/.authz-turso-conversion-test.db'
const PROFILES_QUERY_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshProfilesModule() {
  return import(`${PROFILES_QUERY_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

// ---------------------------------------------------------------- 부정 대조 기반: 깨진 경로
//
// `src/db/client.ts`의 `db`는 지연 생성 Proxy이고 한 번 접속하면 프로세스
// 안에서 연결을 재사용한다(`queriesProfiles.test.mjs` 상단 설명과 동일한
// 함정). 그래서 "깨진 경로" 대조 테스트는 이 파일에서 실제 DB에 처음
// 접속하기 전에, 즉 아래 `process.env.TURSO_DATABASE_URL = file:${DB_PATH}`
// 줄보다 먼저 실행돼야 한다 — 늦게 실행하면 이미 캐시된 정상 연결을 써서
// "깨진 경로에서도 던진다"를 증명하지 못하고 "존재하지 않는 id라서 던진다"는
// 별개의 이유로 우연히 통과해버린다.
test('checkAdminPermission: 조회 자체가 실패하면(깨진 DB 경로) 조회 실패 에러로 던진다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
    await assert.rejects(() => checkAdminPermission('any-id'), /프로필 정보를 조회할 수 없습니다/)
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

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

// ================================================================== authz.ts: resolveSessionProfile

test('resolveSessionProfile: 프로필이 있으면 profile을 채우고 profileError는 없다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { resolveSessionProfile } = await import('../../src/lib/server/authz.ts')
  const id = 'authz-ok-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'authz-ok-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_admin: true,
    })
  )

  const result = await resolveSessionProfile(id)
  assert.equal(result.profile?.registration_status, 'approved')
  assert.equal(result.profile?.is_active, true)
  assert.equal(result.profile?.is_admin, true)
  assert.equal(result.profileError, undefined)
})

test('resolveSessionProfile: 행이 없으면 profile: null이고 profileError는 세팅하지 않는다', async () => {
  const { resolveSessionProfile } = await import('../../src/lib/server/authz.ts')
  const result = await resolveSessionProfile('authz-missing-does-not-exist')
  assert.equal(result.profile, null)
  assert.equal(result.profileError, undefined)
  // adminAuth/boardRoomAuth/memberAuth는 `profileError || !profile`을 함께
  // 검사하므로, profileError가 없어도 !profile 하나만으로 차단된다 — 이전
  // Supabase `.single()`이 "행 없음"에도 error를 채우던 것과 최종 결과(차단)는
  // 같다.
  assert.ok(!result.profile, '!profile 분기가 차단으로 이어져야 한다')
})

test('resolveSessionProfile: 조회 자체가 실패하면(throw) profile: null + profileError를 채운다 (fail-closed, 삼키지 않고 던지지도 않는다)', async () => {
  const { resolveSessionProfile } = await import('../../src/lib/server/authz.ts')
  const boom = new Error('DB 연결 실패')
  const throwingFetch = async () => {
    throw boom
  }

  const result = await resolveSessionProfile('any-id', throwingFetch)
  assert.equal(result.profile, null)
  assert.equal(result.profileError, boom)
})

test('resolveSessionProfile: 33개 컬럼 중 5개만 남기고 계좌번호·실명 등 민감 컬럼은 투영에서 빠진다 (리뷰 라운드 1 Important)', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { resolveSessionProfile } = await import('../../src/lib/server/authz.ts')
  const id = 'authz-sensitive-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'authz-sensitive-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_admin: true,
      real_name: '홍길동',
      account_number: '110-123-456789',
      bank_name: '국민은행',
      phone_number: '010-1234-5678',
      birth_date: '1990-01-01',
    })
  )

  const result = await resolveSessionProfile(id)
  assert.ok(result.profile)
  assert.deepEqual(Object.keys(result.profile).sort(), [
    'is_active',
    'is_admin',
    'is_auditor',
    'is_director',
    'registration_status',
  ])
  // 존재 확인이 아니라 부재 확인이 핵심이다 — 다섯 개 화이트리스트 밖의
  // 어떤 키도(특히 계좌번호·실명) 세션 프로필에 실리면 안 된다.
  for (const sensitiveKey of [
    'account_number',
    'bank_name',
    'real_name',
    'phone_number',
    'birth_date',
    'email',
    'monthly_fee',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.profile, sensitiveKey),
      false,
      `${sensitiveKey}가 세션 프로필에 남아있으면 안 된다`
    )
  }
})

test('resolveSessionProfile 구현에 try/catch(fail-closed) 가드가 있다 (소스 가드)', () => {
  // 이 가드를 실제로 걷어냈을 때 바로 위 fail-closed 런타임 테스트가
  // 실패하는지는 부정 대조로 별도 확인했다(작업 보고서 참고) — try/catch를
  // 지우면 resolveSessionProfile이 throw를 그대로 던져 그 테스트의
  // `assert.equal(result.profile, null)`이 도달 전에 예외로 죽는다.
  const src = readFileSync('src/lib/server/authz.ts', 'utf8')
  const match = src.match(/export async function resolveSessionProfile\([\s\S]*?\n\}\n/)
  assert.ok(match, 'resolveSessionProfile 함수 본문을 찾지 못했다')
  const body = match[0]
  assert.match(body, /try\s*\{/, 'try 블록이 있어야 한다')
  assert.match(body, /catch\s*\(profileError\)/, 'catch(profileError)가 있어야 한다')
})

/**
 * 리뷰 라운드 1 Minor 4: `getSessionContext()`는 인증된 거의 모든 API
 * 요청에서 실행되고, 게시글·좋아요·댓글 라우트는 `maxDuration = 30`이라
 * Turso가 멎으면 요청 하나가 최대 30초 함수를 붙잡는다.
 * `middleware/profile.ts`의 `withTimeout`/`FETCH_TIMEOUT_MS`(3초)를 재사용해
 * 감쌌다 — 실제로 3초를 기다리지 않기 위해 `mock.timers`로 가짜 시계를 쓰고,
 * 절대 resolve하지 않는 `fetchProfile`을 주입한다(운영 호출부는 이 인자를
 * 넘기지 않고 기본값 `getProfileById`를 쓴다 — 프로덕션 동작은 바뀌지 않는다).
 *
 * 타임아웃은 `profileError`로 떨어져야 한다(예외를 삼켜 `profile: null`만
 * 만들면 "조회 실패"라는 사실 자체가 사라진다 — memberAuth.ts/
 * boardRoomAuth.ts/adminAuth.ts가 `profileError`를 차단 조건으로 함께 본다).
 */
test('resolveSessionProfile: 타임아웃(FETCH_TIMEOUT_MS=3000ms) 안에 응답하지 않으면 profileError로 떨어진다 (삼켜서 이유 없이 profile:null만 만들지 않는다)', async () => {
  const { resolveSessionProfile } = await import('../../src/lib/server/authz.ts')
  const neverResolves = () => new Promise(() => {})

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const promise = resolveSessionProfile('any-id', neverResolves)
    mock.timers.tick(3000)
    const result = await promise
    assert.equal(result.profile, null)
    assert.ok(result.profileError, 'profileError가 채워져야 한다(삼키면 안 된다)')
    assert.match(String(result.profileError.message), /3000ms/)
  } finally {
    mock.timers.reset()
  }
})

test('resolveSessionProfile 구현이 middleware/profile.ts의 withTimeout/FETCH_TIMEOUT_MS를 재사용한다 (소스 가드)', () => {
  const src = readFileSync('src/lib/server/authz.ts', 'utf8')
  assert.match(src, /from\s+['"]@\/middleware\/profile['"]/)
  assert.match(src, /withTimeout/)
  assert.match(src, /FETCH_TIMEOUT_MS/)
})

// ================================================================== adminAuth.ts: checkAdminPermission

test('checkAdminPermission: is_admin+approved+active면 통과하고 3개 필드를 돌려준다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
  const id = 'admin-ok-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'admin-ok-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_admin: true,
    })
  )

  const profile = await checkAdminPermission(id)
  assert.deepEqual(profile, {
    is_admin: true,
    registration_status: 'approved',
    is_active: true,
  })
})

test('checkAdminPermission: is_admin=false면 관리자 권한 에러로 던진다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
  const id = 'admin-not-admin-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'admin-not-admin-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_admin: false,
    })
  )

  await assert.rejects(() => checkAdminPermission(id), /관리자 권한이 필요합니다/)
})

test('checkAdminPermission: registration_status가 approved가 아니면(관리자여도) 던진다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
  const id = 'admin-pending-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'admin-pending-1@test.local',
      registration_status: 'pending',
      is_active: true,
      is_admin: true,
    })
  )

  await assert.rejects(() => checkAdminPermission(id), /관리자 권한이 필요합니다/)
})

test('checkAdminPermission: is_active=false면(관리자·승인이어도) 던진다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
  const id = 'admin-inactive-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'admin-inactive-1@test.local',
      registration_status: 'approved',
      is_active: false,
      is_admin: true,
    })
  )

  await assert.rejects(() => checkAdminPermission(id), /관리자 권한이 필요합니다/)
})

test('checkAdminPermission: 프로필이 없으면(행 없음) 조회 실패 에러로 던진다', async () => {
  const { checkAdminPermission } = await import('../../src/lib/server/adminAuth.ts')
  await assert.rejects(
    () => checkAdminPermission('admin-missing-does-not-exist'),
    /프로필 정보를 조회할 수 없습니다/
  )
})

// (조회 자체가 실패하는 경우의 부정 대조는 위쪽 "부정 대조 기반: 깨진 경로"
// 섹션에서 이미 실행했다 — 이 시점에는 정상 DB 연결이 캐시돼 있어 여기서
// 다시 깨진 경로를 대입해도 실제로는 검증되지 않는다.)

// ================================================================== boardRoomAuth.ts: getDirectorRoster/getAuditorRoster

test('getDirectorRoster: 승인·활성·is_director인 회원만 담는다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { getDirectorRoster } = await import('../../src/lib/server/boardRoomAuth.ts')

  await upsertProfile(
    makeProfile({
      id: 'director-ok-1',
      email: 'director-ok-1@test.local',
      display_name: '이사1',
      registration_status: 'approved',
      is_active: true,
      is_director: true,
      director_title: '이사장',
    })
  )
  // 비활성 이사 — 제외돼야 한다.
  await upsertProfile(
    makeProfile({
      id: 'director-inactive-1',
      email: 'director-inactive-1@test.local',
      display_name: '비활성이사',
      registration_status: 'approved',
      is_active: false,
      is_director: true,
    })
  )
  // 미승인 이사 — 제외돼야 한다.
  await upsertProfile(
    makeProfile({
      id: 'director-pending-1',
      email: 'director-pending-1@test.local',
      display_name: '대기이사',
      registration_status: 'pending',
      is_active: true,
      is_director: true,
    })
  )
  // 이사가 아닌 승인·활성 회원 — 제외돼야 한다.
  await upsertProfile(
    makeProfile({
      id: 'not-director-1',
      email: 'not-director-1@test.local',
      display_name: '일반회원',
      registration_status: 'approved',
      is_active: true,
      is_director: false,
    })
  )

  const roster = await getDirectorRoster({})
  const ids = roster.map(row => row.id).sort()
  assert.deepEqual(ids, ['director-ok-1'])
  assert.equal(roster[0].display_name, '이사1')
  assert.equal(roster[0].director_title, '이사장')
})

/**
 * 리뷰 라운드 1 Minor 3: 전환 전 Supabase 쿼리에는 `ORDER BY`가 없었지만,
 * 지금 `listProfiles`는 `created_at DESC`를 강제한다. 아무 정렬도 안 하면
 * 이사회 명단이 "가입 최신순"(입력 순서의 역순)으로 보이게 되므로,
 * `getDirectorRoster`/`getAuditorRoster`가 이름 오름차순으로 다시 정렬하는지
 * 확인한다 — 일부러 이름의 가나다 순서와 삽입 순서를 어긋나게 심는다
 * ('다이사' → '가이사' → '나이사' 순으로 삽입하면 `created_at DESC`로는
 * 나이사·가이사·다이사 순으로 나온다 — 이름순도 아니고 삽입 역순도 우연히
 * 일치하지 않는 배열이라 정렬이 실제로 동작해야만 기대값이 맞는다).
 */
test('getDirectorRoster: 이름(display_name) 오름차순으로 정렬된다 — 가입순(created_at DESC)이 아니다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { getDirectorRoster } = await import('../../src/lib/server/boardRoomAuth.ts')

  for (const [id, name] of [
    ['sort-director-da', '다이사'],
    ['sort-director-ga', '가이사'],
    ['sort-director-na', '나이사'],
  ]) {
    await upsertProfile(
      makeProfile({
        id,
        email: `${id}@test.local`,
        display_name: name,
        registration_status: 'approved',
        is_active: true,
        is_director: true,
      })
    )
  }

  const roster = await getDirectorRoster({})
  const sortTargetNames = roster
    .map(row => row.display_name)
    .filter(name => name.endsWith('이사') && ['가이사', '나이사', '다이사'].includes(name))
  assert.deepEqual(sortTargetNames, ['가이사', '나이사', '다이사'])
})

test('getDirectorRoster/getAuditorRoster는 sortByDisplayNameAsc로 명시적으로 정렬한다 (소스 가드)', () => {
  const src = readFileSync('src/lib/server/boardRoomAuth.ts', 'utf8')
  const directorMatch = src.match(/export async function getDirectorRoster\([\s\S]*?\n\}\n/)
  const auditorMatch = src.match(/export async function getAuditorRoster\([\s\S]*?\n\}\n/)
  assert.ok(directorMatch, 'getDirectorRoster 함수 본문을 찾지 못했다')
  assert.ok(auditorMatch, 'getAuditorRoster 함수 본문을 찾지 못했다')
  for (const body of [directorMatch[0], auditorMatch[0]]) {
    assert.match(body, /sortByDisplayNameAsc\(/)
  }
})

test('getAuditorRoster: 승인·활성·is_auditor인 회원만 담는다', async () => {
  const { upsertProfile } = await loadFreshProfilesModule()
  const { getAuditorRoster } = await import('../../src/lib/server/boardRoomAuth.ts')

  await upsertProfile(
    makeProfile({
      id: 'auditor-ok-1',
      email: 'auditor-ok-1@test.local',
      display_name: '감사1',
      registration_status: 'approved',
      is_active: true,
      is_auditor: true,
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'auditor-inactive-1',
      email: 'auditor-inactive-1@test.local',
      display_name: '비활성감사',
      registration_status: 'approved',
      is_active: false,
      is_auditor: true,
    })
  )

  const roster = await getAuditorRoster({})
  const ids = roster.map(row => row.id)
  assert.deepEqual(ids, ['auditor-ok-1'])
})

test('getDirectorRoster/getAuditorRoster 구현은 listProfiles를 쓰고 회원별 개별 쿼리(N+1)를 하지 않는다 (소스 가드)', () => {
  const src = readFileSync('src/lib/server/boardRoomAuth.ts', 'utf8')
  const directorMatch = src.match(/export async function getDirectorRoster\([\s\S]*?\n\}\n/)
  const auditorMatch = src.match(/export async function getAuditorRoster\([\s\S]*?\n\}\n/)
  assert.ok(directorMatch, 'getDirectorRoster 함수 본문을 찾지 못했다')
  assert.ok(auditorMatch, 'getAuditorRoster 함수 본문을 찾지 못했다')
  for (const body of [directorMatch[0], auditorMatch[0]]) {
    assert.match(body, /listProfiles\(/)
    assert.doesNotMatch(body, /\.from\(['"]member_profiles['"]\)/)
  }
})
