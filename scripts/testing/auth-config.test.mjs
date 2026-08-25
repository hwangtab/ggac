import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const src = readFileSync('src/lib/auth/server.ts', 'utf8')

test('공개 가입은 여전히 닫혀 있다', () => {
  // 단계 2b-6 전에 열리면 임의 이메일로 계정이 생기고 실제 메일이 나간다.
  assert.match(src, /disableSignUp:\s*true/)
})

test('쿠키 캐시가 켜져 있다', () => {
  assert.match(src, /cookieCache:\s*\{[^}]*enabled:\s*true/s)
})

test('가입 훅이 Turso가 아니라 Supabase에 프로필을 쓴다', () => {
  // 승인 화면(admin/members)이 Supabase를 읽는다. Turso에 쓰면 새 가입자가
  // 관리자에게 보이지 않는다.
  assert.doesNotMatch(src, /db\.insert\(memberProfiles\)/)
  assert.match(src, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/)
})

test('재설정 메일이 token으로 우리 화면 URL을 만든다', () => {
  // BA 기본 URL은 /api/auth/reset-password/{token} 이라 우리 화면과 맞지 않는다.
  assert.match(src, /sendResetPassword:\s*async\s*\(\{[^}]*token/s)
  assert.match(src, /\/reset-password\?token=/)
})

test('인증 메일이 callbackURL을 넘긴다', () => {
  // 없으면 /verify-email이 리다이렉트 대신 JSON을 반환한다.
  assert.match(src, /callbackURL/)
})

// ---------------------------------------------------------------- 9pre 수정 2: member_profiles 그림자 행

test('가입 훅이 auth.users 껍데기 직후, Turso 프로필 upsert보다 먼저 member_profiles 그림자 행을 만든다', () => {
  const authShadowAt = src.indexOf('await ensureSupabaseAuthShadowUser(')
  const profileShadowAt = src.indexOf('await ensureSupabaseMemberProfileShadowRow(')
  const tursoUpsertAt = src.indexOf('await upsertProfile(')

  assert.ok(authShadowAt !== -1, 'ensureSupabaseAuthShadowUser 호출을 찾지 못했다')
  assert.ok(profileShadowAt !== -1, 'ensureSupabaseMemberProfileShadowRow 호출을 찾지 못했다')
  assert.ok(tursoUpsertAt !== -1, 'upsertProfile 호출을 찾지 못했다')
  assert.ok(
    authShadowAt < profileShadowAt,
    'member_profiles 그림자 행은 auth.users 껍데기 다음에 만들어야 한다'
  )
  assert.ok(
    profileShadowAt < tursoUpsertAt,
    'member_profiles 그림자 행은 Turso 프로필 upsert보다 먼저 만들어야 한다'
  )
})

test('member_profiles 그림자 행은 id·email·display_name만 채운다(권한·상태 컬럼을 직접 쓰지 않는다)', () => {
  const match = src.match(/async function ensureSupabaseMemberProfileShadowRow\([\s\S]*?\n\}\n/)
  assert.ok(match, 'ensureSupabaseMemberProfileShadowRow 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.match(body, /\.insert\(\{ id, email, display_name/)
  // registration_status·is_active·is_admin·is_director·is_auditor를 이
  // 함수가 직접 쓰면 "또 다른 진실 출처"가 된다 — DB 기본값에만 맡겨야 한다.
  for (const forbidden of [
    'registration_status',
    'is_active',
    'is_admin',
    'is_director',
    'is_auditor',
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden),
      `${forbidden}을 그림자 행 함수가 직접 채우면 안 된다`
    )
  }
  // 이 껍데기 행을 어디서도 읽지 않는다 — .select(가 있으면 읽는 코드다.
  assert.doesNotMatch(body, /\.select\(/, '그림자 행 함수가 스스로 읽으면 이중 권위가 된다')
})

test('server.ts 안에서는(함수 정의부 밖에서도) 이 그림자 행 호출 결과를 읽지 않는다', () => {
  // 이 테스트의 검증 범위는 server.ts 하나뿐이다(위 `src`가 이 파일
  // 내용으로만 좁혀져 있다) — 함수 정의부(위 테스트가 이미 .select( 없음을
  // 확인) 밖에서도 이 함수의 호출 결과를 select에 연결하는 코드가 없어야
  // 한다. 저장소 전체에 대한 "아무도 안 읽는다" 보장은 아래
  // '저장소 전체에서 참조되지 않는다' 테스트가 별도로 맡는다.
  assert.doesNotMatch(src, /ensureSupabaseMemberProfileShadowRow\([^)]*\)\s*\.select\(/)
})

test('member_profiles 그림자 행 함수는 저장소 전체에서 정의부·호출부(server.ts)와 테스트 파일 밖에서 참조되지 않는다', () => {
  // 코드리뷰 9pre-2 대응: 위 두 테스트는 server.ts 소스 문자열(`src`)만
  // 본다 — "저장소 어디도 읽지 않는다"고 주장하려면 실제로 저장소 전체를
  // 훑어야 한다. 이 함수는 export되지 않은 비공개 함수라 다른 파일이
  // import할 수 없고, 따라서 이 이름이 나타나는 위치는 구조적으로
  // (1) server.ts의 정의부, (2) server.ts의 호출부, (3) 이 이름을 언급하는
  // 테스트 파일들뿐이어야 한다 — 그 밖의 파일에 나타나면 누군가 이름을
  // 복사해 별도 조회 경로를 만들었다는 뜻이므로 실패로 잡는다.
  //
  // `git grep`을 쓴다 — node_modules·.next 등은 .gitignore로 이미
  // 빠지므로 별도 제외 목록이 필요 없다.
  const output = execFileSync(
    'git',
    ['grep', '-n', '--fixed-strings', 'ensureSupabaseMemberProfileShadowRow'],
    { encoding: 'utf8' }
  )
  const lines = output.trim().split('\n').filter(Boolean)
  const unexpectedFiles = new Set(
    lines
      .map(line => line.split(':')[0])
      .filter(file => file !== 'src/lib/auth/server.ts' && !file.startsWith('scripts/testing/'))
  )
  assert.deepEqual(
    [...unexpectedFiles],
    [],
    `ensureSupabaseMemberProfileShadowRow가 예상 밖 파일에서 참조된다: ${[...unexpectedFiles].join(', ')}`
  )
})

test('member_profiles 그림자 행 실패는 가입 훅의 기존 catch로 삼켜진다(가입 자체를 막지 않는다)', () => {
  const hookMatch = src.match(
    /after:\s*async\s*user\s*=>\s*\{[\s\S]*?\n\s{6}\},\n\s{4}\},\n\s{2}\},/
  )
  assert.ok(hookMatch, '가입 훅(databaseHooks.user.create.after) 본문을 찾지 못했다')
  const hookBody = hookMatch[0]

  assert.match(hookBody, /ensureSupabaseMemberProfileShadowRow/)
  assert.match(hookBody, /catch\s*\(error\)\s*\{/)
  // catch 블록이 로그만 남기고 다시 던지지 않는지: catch 이후에 throw가
  // 없어야 한다(로그 함수 호출로 끝나야 한다).
  const catchAt = hookBody.indexOf('catch (error)')
  const afterCatch = hookBody.slice(catchAt)
  assert.doesNotMatch(afterCatch, /throw error/, '가입 훅의 catch는 다시 던지면 안 된다')
})
