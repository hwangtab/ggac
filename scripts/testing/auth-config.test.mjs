import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
