import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 단계 2c: 회원 관리·마이페이지 라우트 15개를 `src/db/queries/profiles.ts`
 * (Turso)로 전환한 것을 검증한다.
 *
 * 라우트는 전부 `defineApiRoute({ auth: 'admin', ... })` 또는
 * `requireActiveMember()`/`requireUser()`를 거치는데, 둘 다 결국
 * `next/headers`(`readSessionUser`) 요청 스코프에 묶여 있어 플레인
 * `node --test`에서 GET/POST 핸들러를 직접 호출할 수 없다 — task-3b가
 * `verify-session`/`auth/callback`에서 마주친 것과 같은 제약이다. 그래서
 * 이 파일도 그 선례를 따른다:
 *   1) 소스 패턴 가드 — 15개 파일이 더 이상 member_profiles를 직접
 *      조회/갱신하지 않고 쿼리 계층 함수를 쓰는지.
 *   2) 라우트 안의 변환 로직(자격 필터링·배치 갱신·응답 투영)을 실제
 *      SQLite로 그대로 재현해 검증 — 라우트 파일에서 그 로직을 그대로
 *      가져와 실행한다(핸들러 함수 자체를 호출하는 게 아니라 동일한
 *      쿼리 계층 호출 시퀀스를 재현한다).
 */

const DB_PATH = 'scripts/testing/.stage2c-member-routes-test.db'
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

const ROUTE_FILES = {
  boardWrite: 'src/app/[locale]/board/write/page.tsx',
  adminArtists: 'src/app/api/admin/artists/route.ts',
  adminArtistsMembers: 'src/app/api/admin/artists/members/route.ts',
  adminArtistUnassign: 'src/app/api/admin/artists/[id]/members/[memberId]/route.ts',
  adminArtistAssign: 'src/app/api/admin/artists/[id]/members/route.ts',
  adminMemberAction: 'src/app/api/admin/member-action/route.ts',
  adminMembersList: 'src/app/api/admin/members/route.ts',
  adminMembersStats: 'src/app/api/admin/members/stats/route.ts',
  adminMembersFlags: 'src/app/api/admin/members/flags/route.ts',
  adminMembersBulk: 'src/app/api/admin/members/bulk/route.ts',
  mypageProfile: 'src/app/api/mypage/profile/route.ts',
  mypageArtist: 'src/app/api/mypage/artist/route.ts',
  mypageArtistPhoto: 'src/app/api/mypage/artist/photo/route.ts',
  profiles: 'src/app/api/profiles/route.ts',
  notificationsBulk: 'src/app/api/notifications/bulk/route.ts',
}

// ---------------------------------------------------------------- 소스 가드: member_profiles 직접 접근이 남아있지 않다

test('15개 라우트 모두 member_profiles를 직접 조회/갱신하지 않는다 (주석 제외)', () => {
  for (const file of Object.values(ROUTE_FILES)) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      src,
      /\.from\(\s*['"]member_profiles['"]\s*\)/,
      `${file}에 member_profiles 직접 접근이 남아있다`
    )
  }
})

test('15개 라우트 모두 src/db/queries/profiles(쿼리 계층)를 임포트한다', () => {
  for (const file of Object.values(ROUTE_FILES)) {
    const src = readFileSync(file, 'utf8')
    assert.match(
      src,
      /from\s+['"]@\/db\/queries\/profiles['"]/,
      `${file}이 쿼리 계층을 임포트하지 않는다`
    )
  }
})

// 단계 4(Task 4)에서 member_bulk_operations 권위도 Turso로 옮겨갔다 — 이
// 테스트는 원래 "이 테이블은 그대로 Supabase에 남는다"를 고정했지만, 이제는
// 그 반대(쿼리 계층 함수를 쓰고 Supabase 직접 접근이 남아있지 않다)를
// 검증한다.
test('admin/members/bulk는 member_bulk_operations를 쿼리 계층(src/db/queries/misc.ts)으로 접근한다(Task 4에서 Turso로 전환)', () => {
  const bulkSrc = readFileSync(ROUTE_FILES.adminMembersBulk, 'utf8')
  assert.doesNotMatch(bulkSrc, /\.from\(\s*['"]member_bulk_operations['"]\s*\)/)
  assert.match(bulkSrc, /from\s+['"]@\/db\/queries\/misc['"]/)
  assert.match(bulkSrc, /createBulkOperation\(/)
  assert.match(bulkSrc, /markBulkOperationInProgress\(/)
  assert.match(bulkSrc, /completeBulkOperation\(/)
  assert.match(bulkSrc, /failBulkOperation\(/)
  assert.match(bulkSrc, /listBulkOperations\(/)
})

// 단계 2c Task 7: notifications/bulk는 이 스위트가 처음 작성됐을 때(회원
// 라우트 전환 라운드)는 create_bulk_notification RPC + createSupabaseServer를
// 그대로 유지하는 게 범위 밖이었다. Task 7이 알림을 Turso로 전환하면서
// notifications/bulk도 함께 전환됐다 — 이제는 그 반대(RPC/Supabase 클라이언트가
// 남아있지 않다)를 검증한다.
test('notifications/bulk는 더 이상 create_bulk_notification RPC나 createSupabaseServer를 쓰지 않는다(Task 7에서 Turso로 전환)', () => {
  const notifSrc = readFileSync(ROUTE_FILES.notificationsBulk, 'utf8')
  assert.doesNotMatch(notifSrc, /rpc\(\s*['"]create_bulk_notification['"]/)
  assert.doesNotMatch(notifSrc, /createSupabaseServer/)
  assert.match(notifSrc, /from\s+['"]@\/db\/queries\/notifications['"]/)
  assert.match(notifSrc, /createBulkNotifications\(/)
  assert.match(notifSrc, /markAllNotificationsRead\(/)
})

// ---------------------------------------------------------------- 아티스트 배정(POST)의 범위 정정: member_profiles만 Turso로, artists는 Supabase 그대로
//
// 이 파일은 애초 12개 목록에서 "artists 테이블과 조인한다"는 이유로 빠졌지만,
// 그 판단이 놓친 사실이 있었다 — 이 파일이 member_profiles에 **쓴다**는
// 것. 해제(DELETE, [memberId]/route.ts)는 이미 Turso로 전환됐는데 배정
// (POST, 이 파일)이 계속 Supabase에 쓰면 배정은 무효, 해제만 유효한
// 반쪽짜리 상태가 된다 — 그래서 이 파일도 member_profiles만 전환했었다
// (단계 2c). artists 테이블 조회(존재 확인)는 그때 Supabase에 남겨뒀지만,
// 단계 4(Task 4)에서 artists 권위 자체가 Turso로 옮겨가며 이 존재 확인도
// 함께 전환됐다 — 이제는 그 반대(Supabase 직접 접근이 남아있지 않다)를
// 검증한다.

test('admin/artists/[id]/members(배정 POST)는 artists 존재 확인을 getArtistByLegacyId(Turso)로 한다(Task 4에서 전환)', () => {
  const src = readFileSync(ROUTE_FILES.adminArtistAssign, 'utf8')
  assert.doesNotMatch(
    src,
    /\.from\(\s*['"]artists['"]\s*\)/,
    'artists 조회는 더 이상 Supabase가 아니어야 한다'
  )
  assert.match(src, /from\s+['"]@\/db\/queries\/artists['"]/)
  assert.match(src, /getArtistByLegacyId\(artistId\)/)
  assert.match(src, /getProfileById\(memberId\)/)
  assert.match(src, /updateProfile\(memberId,/)
})

// ---------------------------------------------------------------- 소스 가드(필수 부정 대조 대상): 배정(POST)이 updateProfile 호출을 잃으면 안 된다

test('admin/artists/[id]/members POST는 member_profiles 갱신을 updateProfile(Turso)로 실제로 수행한다(단순 조회만 하고 끝나지 않는다)', () => {
  const src = readFileSync(ROUTE_FILES.adminArtistAssign, 'utf8')
  assert.match(
    src,
    /await updateProfile\(memberId,\s*\{[\s\S]*?artist_id:\s*artistId[\s\S]*?\}\)/,
    'updateProfile(memberId, { artist_id: artistId, ... }) 호출이 있어야 한다'
  )
})

// ---------------------------------------------------------------- 소스 가드 1(필수 부정 대조 대상): admin/members/bulk는 배치를 쓴다
//
// 이 가드가 실제로 회귀를 잡는지는 테스트 파일 자체가 소스를 고쳐가며
// 증명하지 않는다(상시 실행되는 테스트 스위트가 실제 라우트 파일을 매번
// 수정했다 복원하는 것은 취약하다 — task-3b 선례도 이 방식을 쓰지 않았다).
// 대신 개발 중 수동으로 1회 재현했다: `updateProfilesByIds(eligibleIds,
// updateData)` 호출을 `for (const id of eligibleIds) { await
// updateProfile(id, updateData) }` 루프로 바꾼 뒤 이 테스트를 실행하면
// 아래 두 단언이 즉시 실패한다(배치 함수 부재 매치 실패 + 단건 호출 매치
// 성공하지 않음). 원복 후 재실행하면 통과한다 — 결과는 보고서에 기록.
test('admin/members/bulk POST는 updateProfilesByIds(배치)를 쓰고 id별 순차 updateProfile 호출은 쓰지 않는다', () => {
  const src = readFileSync(ROUTE_FILES.adminMembersBulk, 'utf8')
  assert.match(src, /updatedIds = await updateProfilesByIds\(eligibleIds, updateData\)/)
  assert.doesNotMatch(
    src,
    /\bawait updateProfile\(/,
    '단건 updateProfile 호출이 있으면 안 된다 — updateProfilesByIds만 써야 한다'
  )
})

// ---------------------------------------------------------------- 소스 가드 2(필수 부정 대조 대상): admin/members 목록 필터/정렬 보존
//
// 마찬가지로 개발 중 수동으로 1회 재현했다: `status: filter === 'all' ?
// undefined : (filter as RegistrationStatus)`와 `search: search ||
// undefined` 두 줄을 지운 뒤 이 테스트를 실행하면 아래 단언이 즉시
// 실패한다. 원복 후 재실행하면 통과한다 — 결과는 보고서에 기록.
test('admin/members 목록은 filter/search를 listProfiles 인자로 그대로 전달한다(하드코딩하지 않는다)', () => {
  const src = readFileSync(ROUTE_FILES.adminMembersList, 'utf8')
  assert.match(src, /status: filter === 'all' \? undefined : \(filter as RegistrationStatus\)/)
  assert.match(src, /search: search \|\| undefined/)
  assert.match(src, /limit,\s*\n\s*offset,/)
})

test('admin/members 목록 라우트는 listProfiles가 고정하는 created_at 내림차순 정렬을 스스로 뒤집지 않는다 (별도 .sort()/.reverse() 없음)', () => {
  const src = readFileSync(ROUTE_FILES.adminMembersList, 'utf8')
  assert.doesNotMatch(src, /\.sort\(/, 'listProfiles의 정렬을 재정의하는 코드가 없어야 한다')
  assert.doesNotMatch(src, /\.reverse\(/)
})

test('admin/artists/members 목록 라우트는 이름 오름차순으로 명시적으로 재정렬한다 (listProfiles 기본 정렬을 그대로 노출하지 않음)', () => {
  const src = readFileSync(ROUTE_FILES.adminArtistsMembers, 'utf8')
  assert.match(src, /localeCompare\(b\.display_name, 'ko'\)/)
})

// ---------------------------------------------------------------- 응답 키 집합 고정 (리뷰 라운드 2 Minor 4)
//
// strict: false라 키가 하나 빠져도 타입 검사가 못 잡고 관리자 화면이
// 조용히 빈다 — 이 두 곳(29키/5키 응답 투영)이 그 위험의 핵심이라고
// 리뷰에서 지목됐다. 소스에서 실제 객체 리터럴을 추출해 키 "집합"을
// 고정한다(문자열 매치가 아니라 Object.keys 비교라 순서 무관·누락/추가
// 둘 다 잡는다).
//
// 개발 중 수동으로 부정 대조했다: 각 파일에서 키 한 줄(admin/members는
// `rejected_by: row.rejected_by,`, flags는 `updated_at:
// updatedProfile.updated_at,`)을 지운 뒤 재실행 → 아래 두 단언이 즉시
// 실패함을 확인. 원복 후 재실행하면 통과 — 결과는 보고서에 기록.

function extractObjectLiteralKeys(source, startMarker) {
  const startIndex = source.indexOf(startMarker)
  if (startIndex === -1) {
    throw new Error(`시작 마커를 찾지 못했다: ${startMarker}`)
  }
  // startMarker 뒤 첫 '{'부터 괄호 깊이를 세어 대응하는 '}'까지를 잘라낸다.
  const braceStart = source.indexOf('{', startIndex)
  let depth = 0
  let endIndex = -1
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        endIndex = i
        break
      }
    }
  }
  if (endIndex === -1) {
    throw new Error(`객체 리터럴의 닫는 괄호를 찾지 못했다: ${startMarker}`)
  }
  const body = source.slice(braceStart + 1, endIndex)
  // `key: expr,` 형태의 최상위 키만 뽑는다(중첩 객체는 없는 두 대상 파일
  // 기준으로 충분 — 값 표현식(row.xxx / updatedProfile.xxx)까지는 안 본다).
  const keys = [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gm)].map(m => m[1])
  if (keys.length === 0) {
    throw new Error(`객체 리터럴에서 키를 하나도 못 뽑았다: ${startMarker}`)
  }
  return keys
}

test('admin/members 목록 응답은 정확히 29개 필드로 좁힌다 (Member 인터페이스와 1:1, 키 하나라도 빠지면 실패)', () => {
  const src = readFileSync(ROUTE_FILES.adminMembersList, 'utf8')
  const keys = extractObjectLiteralKeys(src, 'const members = rows.map(row => (')

  const expected = [
    'id',
    'display_name',
    'email',
    'phone_number',
    'real_name',
    'created_at',
    'updated_at',
    'registration_status',
    'is_active',
    'is_admin',
    'is_director',
    'director_title',
    'is_auditor',
    'is_artist',
    'artist_id',
    'monthly_fee',
    'bank_name',
    'account_number',
    'account_holder',
    'last_login_at',
    'is_suspended',
    'suspension_reason',
    'suspension_until',
    'profile_completeness_score',
    'verification_status',
    'membership_type',
    'engagement_score',
    'approved_by',
    'rejected_by',
  ]

  assert.equal(expected.length, 29, '기대 키 목록 자체가 29개여야 한다(오타 방지)')
  assert.deepEqual(
    keys.sort(),
    [...expected].sort(),
    'admin/members 응답 키 집합이 admin/members/page.tsx의 Member 인터페이스(29개)와 어긋난다'
  )
})

test('admin/members/flags 응답은 정확히 5개 필드로 좁힌다 (id, is_director, director_title, is_auditor, updated_at)', () => {
  const src = readFileSync(ROUTE_FILES.adminMembersFlags, 'utf8')
  const keys = extractObjectLiteralKeys(src, 'const updatedMember = updatedProfile && ')

  const expected = ['id', 'is_director', 'director_title', 'is_auditor', 'updated_at']

  assert.equal(expected.length, 5, '기대 키 목록 자체가 5개여야 한다(오타 방지)')
  assert.deepEqual(
    keys.sort(),
    [...expected].sort(),
    "admin/members/flags 응답 키 집합이 이전 select('id, is_director, director_title, is_auditor, updated_at')와 어긋난다"
  )
})

// ---------------------------------------------------------------- 실제 SQLite: admin/members 목록 필터·정렬 동작

test('admin/members 목록 로직 재현: status=approved + search로 필터링하고 created_at 내림차순을 유지한다', async () => {
  const { upsertProfile, listProfiles } = await loadFreshProfilesModule()
  await upsertProfile(
    makeProfile({
      id: 'list-1',
      email: 'list-1@test.local',
      display_name: '김철수',
      registration_status: 'approved',
    })
  )
  await new Promise(r => setTimeout(r, 5))
  await upsertProfile(
    makeProfile({
      id: 'list-2',
      email: 'list-2@test.local',
      display_name: '김영희',
      registration_status: 'approved',
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'list-3',
      email: 'list-3@test.local',
      display_name: '박민수',
      registration_status: 'pending',
    })
  )

  // 라우트가 filter='approved', search='김'일 때 넘기는 것과 동일한 인자.
  const { rows, total } = await listProfiles({
    status: 'approved',
    search: '김',
    limit: 50,
    offset: 0,
  })

  assert.equal(total, 2)
  assert.deepEqual(
    rows.map(r => r.id),
    ['list-2', 'list-1'],
    'created_at 내림차순(최신 가입 먼저)이어야 한다'
  )
})

// ---------------------------------------------------------------- 실제 SQLite: 아티스트 배정 해제(artist_role NOT NULL 회피)

test('아티스트 배정 해제 로직 재현: artist_role을 null로 쓰지 않고도 배정 해제가 성공한다 (Turso 스키마 NOT NULL 회피)', async () => {
  const { upsertProfile, getProfileById, updateProfile } = await loadFreshProfilesModule()
  const id = 'unassign-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'unassign-1@test.local',
      registration_status: 'approved',
      is_active: true,
      artist_id: 'artist-014',
      is_artist: true,
      artist_role: 'manager',
    })
  )

  // DELETE 라우트가 실제로 호출하는 것과 동일 — artist_role은 patch에 넣지 않는다.
  await assert.doesNotReject(() =>
    updateProfile(id, {
      artist_id: null,
      is_artist: false,
    })
  )

  const updated = await getProfileById(id)
  assert.equal(updated.artist_id, null)
  assert.equal(updated.is_artist, false)
  // artist_role은 이전 값을 그대로 보존한다(스키마가 NOT NULL이라 null로
  // 못 쓴다 — is_artist/artist_id만으로 "미배정"을 판정하는 모든 소비자에
  // 영향 없음, 재배정 시 새 role을 명시적으로 덮어씀).
  assert.equal(updated.artist_role, 'manager')
})

test('대조: 배정 해제 시 artist_role까지 null로 쓰면(원래 Supabase 동작을 그대로 재현하면) NOT NULL 제약으로 던진다', async () => {
  const { upsertProfile, updateProfile } = await loadFreshProfilesModule()
  const id = 'unassign-2'
  await upsertProfile(
    makeProfile({
      id,
      email: 'unassign-2@test.local',
      registration_status: 'approved',
      is_active: true,
      artist_id: 'artist-015',
      is_artist: true,
      artist_role: 'owner',
    })
  )

  // profiles.ts의 ProfilePatch 타입은 artist_role을 non-null string으로
  // 선언해 이 호출 자체를 컴파일 타임에도 막지만(TS), 이 파일은 plain
  // node --test(.mjs)라 타입 검사를 거치지 않는다 — 런타임으로 실제
  // SQLite NOT NULL 제약이 막는지 직접 확인한다.
  await assert.rejects(
    () =>
      updateProfile(id, {
        artist_id: null,
        is_artist: false,
        artist_role: null,
      }),
    'artist_role은 NOT NULL이라 null을 쓰면 제약 위반으로 던져야 한다 — 이게 바로 라우트가 artist_role을 patch에서 뺀 이유다'
  )
})

// ---------------------------------------------------------------- 실제 SQLite: admin/artists 목록의 메모리 필터 로직 재현

test('admin/artists 목록 로직 재현: artist_id/is_artist/is_active 조합으로 아티스트별 배정 멤버를 정확히 나눈다', async () => {
  const { upsertProfile, listProfiles } = await loadFreshProfilesModule()
  await upsertProfile(
    makeProfile({
      id: 'artist-member-1',
      email: 'am1@test.local',
      registration_status: 'approved',
      is_active: true,
      artist_id: 'artist-020',
      is_artist: true,
      artist_role: 'owner',
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'artist-member-2-inactive',
      email: 'am2@test.local',
      registration_status: 'approved',
      is_active: false, // 비활성 — assignedMembers에서 빠져야 한다
      artist_id: 'artist-020',
      is_artist: true,
      artist_role: 'manager',
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'artist-member-3-not-artist',
      email: 'am3@test.local',
      registration_status: 'approved',
      is_active: true,
      artist_id: 'artist-020',
      is_artist: false, // is_artist=false — assignedMembers에서 빠져야 한다
      artist_role: 'owner',
    })
  )
  await upsertProfile(
    makeProfile({
      id: 'artist-member-4-other-artist',
      email: 'am4@test.local',
      registration_status: 'approved',
      is_active: true,
      artist_id: 'artist-021', // 다른 아티스트 — artist-020 목록에서 빠져야 한다
      is_artist: true,
      artist_role: 'collaborator',
    })
  )

  const { rows: allProfiles } = await listProfiles({ limit: 10000, offset: 0 })

  // admin/artists/route.ts GET 핸들러와 동일한 필터.
  const assignedMembers = allProfiles.filter(
    p => p.artist_id === 'artist-020' && p.is_artist && p.is_active
  )

  assert.deepEqual(
    assignedMembers.map(m => m.id),
    ['artist-member-1']
  )
})

// ---------------------------------------------------------------- 실제 SQLite: notifications/bulk 관리자 체크 fail-closed

test('notifications/bulk 관리자 체크 로직 재현: is_admin/approved/is_active 세 조건 중 하나만 어긋나도 거부된다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()

  const cases = [
    {
      id: 'nb-admin-ok',
      is_admin: true,
      registration_status: 'approved',
      is_active: true,
      expect: true,
    },
    {
      id: 'nb-not-admin',
      is_admin: false,
      registration_status: 'approved',
      is_active: true,
      expect: false,
    },
    {
      id: 'nb-pending',
      is_admin: true,
      registration_status: 'pending',
      is_active: true,
      expect: false,
    },
    {
      id: 'nb-inactive',
      is_admin: true,
      registration_status: 'approved',
      is_active: false,
      expect: false,
    },
  ]

  for (const c of cases) {
    await upsertProfile(
      makeProfile({
        id: c.id,
        email: `${c.id}@test.local`,
        registration_status: c.registration_status,
        is_active: c.is_active,
        is_admin: c.is_admin,
      })
    )
  }

  for (const c of cases) {
    const profile = await getProfileById(c.id)
    const allowed = Boolean(
      profile?.is_admin && profile.registration_status === 'approved' && profile.is_active
    )
    assert.equal(allowed, c.expect, `${c.id}의 판정이 기대와 다르다`)
  }

  // 프로필이 아예 없는 경우(조회 실패로 취급) — forbidden으로 fail-closed.
  const missing = await getProfileById('nb-does-not-exist')
  const allowedForMissing = Boolean(
    missing?.is_admin && missing?.registration_status === 'approved' && missing?.is_active
  )
  assert.equal(allowedForMissing, false)
})

// ---------------------------------------------------------------- 실제 SQLite: admin/members/bulk 자격 필터링 + 배치 갱신 + 부분 실패 매핑

test('admin/members/bulk POST 로직 재현: 자격 없는 대상은 건너뛰고 자격 있는 대상만 배치 갱신한다', async () => {
  const { upsertProfile, getProfileById, getProfilesByIds, updateProfilesByIds } =
    await loadFreshProfilesModule()
  await upsertProfile(
    makeProfile({ id: 'bulk-pending-1', email: 'bp1@test.local', registration_status: 'pending' })
  )
  await upsertProfile(
    makeProfile({ id: 'bulk-pending-2', email: 'bp2@test.local', registration_status: 'pending' })
  )
  await upsertProfile(
    makeProfile({
      id: 'bulk-already-approved',
      email: 'bp3@test.local',
      registration_status: 'approved', // bulk_approve 대상 아님(자격 없음)
    })
  )

  const targetIds = ['bulk-pending-1', 'bulk-pending-2', 'bulk-already-approved', 'bulk-missing']

  // admin/members/bulk/route.ts POST와 동일한 시퀀스.
  const memberById = await getProfilesByIds(targetIds)
  const requiredStatus = 'pending'
  const nowIso = new Date().toISOString()
  const updateData = {
    registration_status: 'approved',
    is_active: true,
    approved_by: 'admin-1',
    approved_at: nowIso,
  }

  const eligibleIds = []
  const results = []
  for (const memberId of targetIds) {
    const targetMember = memberById.get(memberId)
    if (!targetMember) {
      results.push({ member_id: memberId, success: false, error: 'not_found' })
      continue
    }
    if (targetMember.registration_status !== requiredStatus) {
      results.push({ member_id: memberId, success: false, error: 'ineligible' })
      continue
    }
    eligibleIds.push(memberId)
  }

  assert.deepEqual(eligibleIds, ['bulk-pending-1', 'bulk-pending-2'])
  assert.deepEqual(
    results.map(r => r.member_id),
    ['bulk-already-approved', 'bulk-missing']
  )

  const updatedIds = await updateProfilesByIds(eligibleIds, updateData)
  assert.deepEqual(updatedIds.sort(), ['bulk-pending-1', 'bulk-pending-2'])

  for (const id of eligibleIds) {
    const row = await getProfileById(id)
    assert.equal(row.registration_status, 'approved')
    assert.equal(row.is_active, true)
    assert.equal(row.approved_by, 'admin-1')
  }
})

// ---------------------------------------------------------------- 실제 SQLite: /api/profiles 배치 조회 (표시명만)

test('/api/profiles 로직 재현: 존재하는 id만 {id, display_name}으로 돌려주고 순서/누락은 에러가 아니다', async () => {
  const { upsertProfile, getProfilesByIds } = await loadFreshProfilesModule()
  await upsertProfile(makeProfile({ id: 'pub-1', email: 'pub1@test.local', display_name: '공개1' }))
  await upsertProfile(makeProfile({ id: 'pub-2', email: 'pub2@test.local', display_name: '공개2' }))

  const profiles = await getProfilesByIds(['pub-1', 'pub-does-not-exist', 'pub-2'])
  const data = Array.from(profiles.values()).map(p => ({ id: p.id, display_name: p.display_name }))

  assert.equal(data.length, 2)
  assert.deepEqual(new Set(data.map(d => d.id)), new Set(['pub-1', 'pub-2']))
})

// ---------------------------------------------------------------- 실제 SQLite: 아티스트 배정(POST) — 조정 지시 대응
//
// 코디네이터가 지목한 문제: 해제(DELETE)는 Turso에 쓰는데 배정(POST)이
// Supabase에 계속 쓰면 배정은 무효, 해제만 유효한 반쪽짜리 상태가 된다.
// 아래 두 테스트는 (a) 배정이 실제로 Turso에 반영되는지, (b) 배정과
// 해제가 정말로 같은 저장소를 공유하는지(한쪽이 쓴 걸 다른 쪽이 읽고 또
// 쓸 수 있는지)를 실제 파일 DB로 검증한다.

test('아티스트 배정 로직 재현: updateProfile(memberId, {...})이 Turso에 실제로 반영된다', async () => {
  const { upsertProfile, getProfileById, updateProfile } = await loadFreshProfilesModule()
  const id = 'assign-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'assign-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: false,
      artist_id: null,
    })
  )

  // POST 핸들러와 동일한 시퀀스: 조회 → 자격/중복배정 검사 → 갱신 → 재조회.
  const before = await getProfileById(id)
  assert.equal(before.registration_status, 'approved')
  assert.equal(before.is_active, true)
  assert.ok(!before.artist_id || before.artist_id === 'artist-030', '중복 배정 아님')

  await updateProfile(id, {
    artist_id: 'artist-030',
    artist_role: 'manager',
    is_artist: true,
  })

  const after = await getProfileById(id)
  assert.equal(after.artist_id, 'artist-030')
  assert.equal(after.artist_role, 'manager')
  assert.equal(after.is_artist, true)
})

test('부정 대조: updateProfile 호출을 건너뛰면(조회만 하고 갱신 없이 끝나면) 배정이 반영되지 않는다', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'assign-2-noop'
  await upsertProfile(
    makeProfile({
      id,
      email: 'assign-2-noop@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: false,
      artist_id: null,
    })
  )

  // updateProfile을 호출하지 않고 조회만 하면(예전 회귀를 흉내낸 것) —
  // 배정이 반영되지 않았음을 확인해, 위 테스트의 assert가 "무조건
  // 통과"하는 공허한 단언이 아님을 증명한다.
  const after = await getProfileById(id)
  assert.notEqual(after.artist_id, 'artist-030')
  assert.equal(after.is_artist, false)
})

test('배정(POST)과 해제(DELETE)는 같은 저장소(Turso)에 쓴다 — 배정 → 해제 왕복이 매번 반영된다', async () => {
  const { upsertProfile, getProfileById, updateProfile } = await loadFreshProfilesModule()
  const id = 'assign-roundtrip-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'assign-roundtrip-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: false,
      artist_id: null,
    })
  )

  // 1) 배정(POST 로직) — admin/artists/[id]/members/route.ts.
  await updateProfile(id, {
    artist_id: 'artist-031',
    artist_role: 'owner',
    is_artist: true,
  })
  const afterAssign = await getProfileById(id)
  assert.equal(afterAssign.artist_id, 'artist-031')
  assert.equal(afterAssign.is_artist, true)

  // 2) 해제(DELETE 로직) — admin/artists/[id]/members/[memberId]/route.ts.
  // artist_role은 patch에서 뺀다(Turso NOT NULL 회피, 앞선 커밋과 동일 이유).
  await updateProfile(id, {
    artist_id: null,
    is_artist: false,
  })
  const afterUnassign = await getProfileById(id)
  assert.equal(afterUnassign.artist_id, null)
  assert.equal(afterUnassign.is_artist, false)

  // 3) 재배정도 같은 저장소에서 계속 반영되는지(왕복이 한 번으로 끝나는
  // 우연이 아님을 확인).
  await updateProfile(id, {
    artist_id: 'artist-032',
    artist_role: 'collaborator',
    is_artist: true,
  })
  const afterReassign = await getProfileById(id)
  assert.equal(afterReassign.artist_id, 'artist-032')
  assert.equal(afterReassign.artist_role, 'collaborator')
  assert.equal(afterReassign.is_artist, true)
})

test('아티스트 배정 로직 재현: 이미 다른 아티스트에 배정된 멤버는 재배정 자격 검사에서 걸린다(코드가 아니라 값으로 확인)', async () => {
  const { upsertProfile, getProfileById } = await loadFreshProfilesModule()
  const id = 'assign-conflict-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'assign-conflict-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: true,
      artist_id: 'artist-040',
      artist_role: 'owner',
    })
  )

  const targetMember = await getProfileById(id)
  const newArtistId = 'artist-041'
  // POST 핸들러의 조건과 동일: artist_id가 있고 새 artistId와 다르면 충돌.
  const isConflict = Boolean(targetMember.artist_id && targetMember.artist_id !== newArtistId)
  assert.equal(isConflict, true)

  // 같은 아티스트로 "재배정"(멱등)은 충돌이 아니어야 한다.
  const isConflictSameArtist = Boolean(
    targetMember.artist_id && targetMember.artist_id !== 'artist-040'
  )
  assert.equal(isConflictSameArtist, false)
})

// ---------------------------------------------------------------- 마이페이지 아티스트 읽기 범위 정정 (리뷰 라운드 2 최우선)
//
// 원래 12개 목록에 mypage/artist 두 파일이 빠졌던 것도 배정(POST)과 같은
// 유형의 범위 설정 실수였다 — 이 두 파일은 member_profiles를 **읽기만**
// 하지만(쓰기 없음), 그 낡은 Supabase 값으로 "이 회원이 아티스트인가"를
// 판정한다. 배정은 이미 Turso에 쓰는데 이 두 파일이 계속 Supabase를 읽으면
// 관리자가 방금 배정한 회원이 마이페이지에서 자기 아티스트 페이지를
// 못 본다. artists 테이블 자체는 그때(단계 2c) Supabase에 남겨뒀지만,
// 단계 4(Task 4)에서 artists 권위 자체가 Turso로 옮겨가며 이 두 파일의
// artists 조회도 함께 전환됐다.

test('mypage/artist, mypage/artist/photo는 artists 조회를 쿼리 계층(src/db/queries/artists.ts)으로 한다(Task 4에서 전환)', () => {
  for (const file of [ROUTE_FILES.mypageArtist, ROUTE_FILES.mypageArtistPhoto]) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      src,
      /\.from\(\s*['"]artists['"]\s*\)/,
      `${file}: artists 조회는 더 이상 Supabase가 아니어야 한다`
    )
    assert.match(
      src,
      /from\s+['"]@\/db\/queries\/artists['"]/,
      `${file}: artists 쿼리 계층을 임포트해야 한다`
    )
    assert.match(
      src,
      /getProfileById\(user\.id\)/,
      `${file}: 프로필 조회는 getProfileById(user.id)여야 한다`
    )
  }
})

// ---------------------------------------------------------------- 소스 가드(필수 부정 대조 대상): 마이페이지가 getProfileById로 판정해야 한다
//
// 개발 중 수동으로 1회 재현했다: mypage/artist/route.ts GET의
// `profile = await getProfileById(user.id)` 호출을 옛 Supabase
// `.from('member_profiles')...` 조회로 되돌린 뒤 이 테스트를 실행하면
// 아래 단언이 즉시 실패한다(정규식이 더 이상 매치되지 않음). 원복 후
// 재실행하면 통과 — 결과는 보고서에 기록.

test('mypage/artist GET/PATCH, mypage/artist/photo PUT/DELETE/GET 전부 getProfileById로 아티스트 권한을 판정한다', () => {
  const artistSrc = readFileSync(ROUTE_FILES.mypageArtist, 'utf8')
  // GET + PATCH 두 번 + PATCH 안의 ownerCheck까지 총 3회.
  const artistCalls = [...artistSrc.matchAll(/getProfileById\(user\.id\)/g)]
  assert.ok(
    artistCalls.length >= 3,
    `mypage/artist에 getProfileById(user.id) 호출이 3번 이상 있어야 한다(실제 ${artistCalls.length}번)`
  )

  const photoSrc = readFileSync(ROUTE_FILES.mypageArtistPhoto, 'utf8')
  // PUT + DELETE + GET 세 핸들러 각각 한 번씩.
  const photoCalls = [...photoSrc.matchAll(/getProfileById\(user\.id\)/g)]
  assert.ok(
    photoCalls.length >= 3,
    `mypage/artist/photo에 getProfileById(user.id) 호출이 3번 이상 있어야 한다(실제 ${photoCalls.length}번)`
  )
})

// ---------------------------------------------------------------- 실제 SQLite: 배정 직후 마이페이지가 아티스트를 인식하는지

test('마이페이지 아티스트 권한 판정 로직 재현: 관리자가 배정하면 같은 조회로 곧바로 인식된다', async () => {
  const { upsertProfile, getProfileById, updateProfile } = await loadFreshProfilesModule()
  const id = 'mypage-artist-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'mypage-artist-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: false,
      artist_id: null,
    })
  )

  // 배정 전: mypage/artist GET과 동일한 조건 — 아직 아티스트가 아니다.
  const before = await getProfileById(id)
  const beforeForbidden = !before.is_artist || !before.artist_id
  assert.equal(beforeForbidden, true, '배정 전에는 마이페이지 접근이 막혀야 한다')

  // 관리자 배정 라우트와 동일한 시퀀스(updateProfile).
  await updateProfile(id, {
    artist_id: 'artist-050',
    artist_role: 'owner',
    is_artist: true,
  })

  // 배정 직후: 같은 프로필 조회 함수(getProfileById)로 곧바로 인식돼야
  // 한다 — 마이페이지와 관리자 배정이 같은 저장소를 보기 때문이다.
  const after = await getProfileById(id)
  const afterForbidden = !after.is_artist || !after.artist_id
  assert.equal(afterForbidden, false, '배정 직후에는 마이페이지가 아티스트를 인식해야 한다')
  assert.equal(after.artist_id, 'artist-050')
})

test('부정 대조: 마이페이지가 Turso 대신 낡은 값(배정 전 스냅샷)을 계속 보면 배정 후에도 계속 막힌다', async () => {
  const { upsertProfile, getProfileById, updateProfile } = await loadFreshProfilesModule()
  const id = 'mypage-artist-stale-1'
  await upsertProfile(
    makeProfile({
      id,
      email: 'mypage-artist-stale-1@test.local',
      registration_status: 'approved',
      is_active: true,
      is_artist: false,
      artist_id: null,
    })
  )

  // "Supabase에서 읽는" 옛 라우트를 흉내낸다 — 배정 전에 한 번 조회해
  // 스냅샷을 캐시해 둔 뒤, Turso 쪽에 배정이 반영돼도 그 스냅샷만 계속
  // 참조한다(리뷰가 지목한 정확히 그 버그 재현).
  const staleSnapshot = await getProfileById(id)

  await updateProfile(id, {
    artist_id: 'artist-051',
    artist_role: 'owner',
    is_artist: true,
  })

  // 낡은 스냅샷 기준 판정 — 여전히 막혀 있다(버그 재현).
  const staleForbidden = !staleSnapshot.is_artist || !staleSnapshot.artist_id
  assert.equal(
    staleForbidden,
    true,
    '낡은 스냅샷을 계속 보면 배정 후에도 계속 막혀야 한다(회귀 재현)'
  )

  // 실제 라우트가 매 요청마다 새로 조회하는지(getProfileById(id) 재호출)로
  // 위 회귀와 대조한다 — 새로 조회하면 통과해야 한다.
  const fresh = await getProfileById(id)
  const freshForbidden = !fresh.is_artist || !fresh.artist_id
  assert.equal(freshForbidden, false, '매 요청마다 새로 조회하면 배정이 곧바로 반영돼야 한다')
})
