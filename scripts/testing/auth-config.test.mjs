import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { stripComments } from './strip-comments.mjs'

// 주석·JSDoc은 걷어내고 본다. 이 파일의 단정 대부분이 "이 설정이 켜져 있다"
// 같은 존재 검사인데, 원본 문자열을 그대로 훑으면 **설정을 지우고 주석으로만
// 남겨도 통과한다.** 실제로 그런 일이 있었다: `disableSignUp: true`를 단계
// 2b-6에서 제거했는데, 그 사실을 설명하는 주석에 같은 리터럴이 남아 있어
// "공개 가입은 여전히 닫혀 있다"는 테스트가 초록불인 채로 계속 거짓을
// 주장했다(단계 4 Task 5에서 발견).
//
// 걷어내기는 정규식이 아니라 TypeScript 파서를 쓴다(`./strip-comments.mjs`).
// 여기 있던 정규식 판본은 문자열·정규식 리터럴 안의 `/*`·`//`를 주석 시작으로
// 오인해 실제 코드를 지웠다(Task 5 리뷰 1회차).
const code = stripComments(readFileSync('src/lib/auth/server.ts', 'utf8'))

test('공개 가입은 열려 있고, 그 대신 catch-all 라우트가 sign-up/email 직접 호출을 막는다', () => {
  // 단계 2b-6에서 `disableSignUp: true`를 제거해 회원가입 화면이 동작한다.
  // 그 순간 `POST /api/auth/sign-up/email`이 인증 없이 공개되므로, 봉쇄는
  // catch-all 라우트가 전담한다 — 둘 중 하나만 바뀌면 가입이 통째로
  // 막히거나(전자) 임의 이메일로 계정이 생긴다(후자).
  assert.doesNotMatch(code, /disableSignUp/)
  assert.match(code, /emailAndPassword:\s*\{[\s\S]*?enabled:\s*true/)

  // 이쪽도 주석을 걷어내고 본다. 원본을 그대로 훑으면 이 라우트의 JSDoc
  // (`\`sign-up/email\` 경로인지 판별한다` 등)만으로 두 단정이 만족돼,
  // **봉쇄 코드를 통째로 지워도 초록불**이 된다.
  const catchAll = stripComments(readFileSync('src/app/api/auth/[...all]/route.ts', 'utf8'))
  assert.match(catchAll, /endsWith\(['"]\/sign-up\/email['"]\)/)
  assert.match(catchAll, /if \(isSignUpEmailPath\(request\)\) \{\s*return ApiError\.forbidden\(/)
})

test('쿠키 캐시가 켜져 있다', () => {
  assert.match(code, /cookieCache:\s*\{[^}]*enabled:\s*true/s)
})

test('가입 훅이 프로필을 Turso에만 쓴다', () => {
  // 단계 2c(Task 3)부터 프로필 권위는 Turso이고, 단계 4 Task 5가 Supabase
  // 그림자 행 생성을 걷어냈다. 이 훅이 다시 Supabase를 만지면 두 DB에
  // 반쯤 쓰이는 상태로 되돌아간다.
  assert.match(code, /await upsertProfile\(/)
  assert.doesNotMatch(code, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|@supabase\//)
  assert.doesNotMatch(code, /ensureSupabase\w*ShadowUser|ensureSupabase\w*ShadowRow/)
})

test('재설정 메일이 token으로 우리 화면 URL을 만든다', () => {
  // BA 기본 URL은 /api/auth/reset-password/{token} 이라 우리 화면과 맞지 않는다.
  assert.match(code, /sendResetPassword:\s*async\s*\(\{[^}]*token/s)
  assert.match(code, /\/reset-password\?token=/)
})

test('인증 메일이 callbackURL을 넘긴다', () => {
  // 없으면 /verify-email이 리다이렉트 대신 JSON을 반환한다.
  assert.match(code, /callbackURL/)
})

test('가입 훅의 프로필 upsert 실패는 삼켜진다(가입 자체를 막지 않는다)', () => {
  // 던져도 계정은 남는다 — 이 훅은 `user` 행이 커밋된 뒤에 실행된다
  // (@better-auth/core dist/context/transaction.mjs의 pendingHooks). 다시
  // 던지면 계정은 그대로인데 응답만 500이 되어, 회원이 "가입 실패"로 읽고
  // 재가입을 시도했다가 이메일 중복에 막힌다.
  // 복구 경로는 아래 "유령 회원" 테스트들이 지킨다(단계 4 Task 6b).
  const hookMatch = code.match(
    /after:\s*async\s*user\s*=>\s*\{[\s\S]*?\n\s{6}\},\n\s{4}\},\n\s{2}\},/
  )
  assert.ok(hookMatch, '가입 훅(databaseHooks.user.create.after) 본문을 찾지 못했다')
  const hookBody = hookMatch[0]

  assert.match(hookBody, /await upsertProfile\(/)
  assert.match(hookBody, /catch\s*\(error\)\s*\{/)
  const catchAt = hookBody.indexOf('catch (error)')
  assert.doesNotMatch(
    hookBody.slice(catchAt),
    /throw error/,
    '가입 훅의 catch는 다시 던지면 안 된다'
  )
})

// ---------------------------------------------------------------- 유령 회원 복구 경로 (단계 4 Task 6b)
//
// 위 훅이 실패를 삼키는 것은 "계정을 되돌릴 수 없기 때문"이지 "괜찮기
// 때문"이 아니다. 그 판단이 성립하려면 프로필 없는 계정을 **발견하고 고치는**
// 경로가 실재해야 한다. 아래 세 단정이 그 경로가 지워지지 않았는지 본다.

test('관리자 복구 라우트가 프로필 없는 계정만 대상으로 삼고, 승인 대기 프로필만 만든다', () => {
  const route = stripComments(readFileSync('src/app/api/admin/members/orphans/route.ts', 'utf8'))

  // 관리자 전용이어야 한다 — GET(목록)과 POST(복구) 둘 다.
  assert.equal(
    (route.match(/auth:\s*'admin'/g) ?? []).length,
    2,
    'GET·POST 둘 다 admin 인증이어야 한다'
  )
  // 대상 좁히기: 프로필이 이미 있는 회원의 id로는 아무 일도 일어나지 않는다.
  assert.match(route, /getProfilelessUserById\(/)
  // 프로필 조립은 가입 훅과 같은 빌더로만 한다(승인 대기·비활성 하드코딩).
  assert.match(route, /buildMemberProfileRow\(/)
  // 이 라우트가 권한·승인 컬럼을 직접 적는 순간 "복구"가 "승인"이 된다.
  assert.doesNotMatch(route, /registration_status|is_admin|is_active|is_director|is_auditor/)
})

test('가입 훅과 복구 라우트가 쓰는 빌더는 승인 대기·무권한을 하드코딩한다', () => {
  const builder = stripComments(readFileSync('src/lib/auth/profileHook.ts', 'utf8'))
  assert.match(builder, /registration_status:\s*'pending'/)
  assert.match(builder, /is_active:\s*false/)
  assert.match(builder, /is_admin:\s*false/)
  assert.match(builder, /is_director:\s*false/)
  assert.match(builder, /is_auditor:\s*false/)
  // 클라이언트 입력을 읽을 수 있는 통로가 없어야 한다 — 인자는 id/email/name뿐이다.
  assert.doesNotMatch(builder, /input\.(registration_status|is_admin|is_active)/)
})

test('이메일 인증 콜백이 프로필 없는 세션 사용자에게 프로필을 다시 만든다', () => {
  const callback = stripComments(readFileSync('src/app/auth/callback/route.ts', 'utf8'))
  assert.match(callback, /getProfilelessUserById\(user\.id\)/)
  assert.match(callback, /buildMemberProfileRow\(/)
  assert.match(callback, /await upsertProfile\(/)
})
