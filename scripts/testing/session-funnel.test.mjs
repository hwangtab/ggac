import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 이 테스트는 동작이 아니라 **구조**를 고정한다.
 * 단계 2b-5의 전환 비용은 "Supabase 인증에 닿는 지점이 몇 개인가"로 결정된다.
 * 그 수가 다시 늘어나면 여기서 실패해야 한다.
 *
 * 단계 2b-6부터는 세션 창구 자체가 Better Auth로 옮겨왔으므로, "Supabase로
 * 되돌아가면 실패하는" 음성 대조 지점도 여기서 고정한다(브리프 Step 7).
 */

const FUNNEL = 'src/lib/server/session.ts'
const MIDDLEWARE_FUNNEL = 'src/middleware/session.ts'

test('세션 창구 파일이 존재하고 readSessionUser를 내보낸다', () => {
  const src = readFileSync(FUNNEL, 'utf8')
  assert.match(src, /export async function readSessionUser\(/)
})

test('세션 창구는 프로필을 조회하지 않는다', () => {
  // member_profiles 조회가 들어오면 선택적 조회 경로에 불필요한 쿼리가 얹힌다
  // (/api/posts GET은 게시판 목록의 hot path다).
  const src = readFileSync(FUNNEL, 'utf8')
  assert.doesNotMatch(src, /member_profiles/)
})

test('세션 창구는 Better Auth의 getSession을 쓰고 Supabase auth로 되돌아가지 않는다', () => {
  // 음성 대조(브리프 Step 7): readSessionUser()가 Supabase로 되돌아가면 이
  // 테스트가 실패해야 한다 — auth.api.getSession 문자열이 사라지므로 첫 단정이
  // 걸린다.
  const src = readFileSync(FUNNEL, 'utf8')
  assert.match(src, /auth\.api\.getSession\(/)
  assert.doesNotMatch(src, /supabase\.auth\.getUser\(/)
})

test('authz.ts는 스스로 getUser를 부르지 않고 창구를 경유한다', () => {
  const src = readFileSync('src/lib/server/authz.ts', 'utf8')
  assert.doesNotMatch(src, /auth\.getUser\(/)
  assert.match(src, /readSessionUser/)
})

test('memberAuth가 getOptionalUser를 내보낸다', () => {
  const src = readFileSync('src/lib/server/memberAuth.ts', 'utf8')
  assert.match(src, /export .*getOptionalUser/)
})

test('미들웨어 세션 모듈이 존재하고 readMiddlewareSession을 내보낸다', () => {
  const src = readFileSync(MIDDLEWARE_FUNNEL, 'utf8')
  assert.match(src, /export async function readMiddlewareSession\(/)
})

test('middleware/auth.ts는 Supabase getClaims/getUser 대신 미들웨어 세션 모듈을 쓴다', () => {
  const src = readFileSync('src/middleware/auth.ts', 'utf8')
  assert.doesNotMatch(src, /supabase\.auth\.getClaims\(/)
  assert.doesNotMatch(src, /supabase\.auth\.getUser\(/)
  assert.match(src, /readMiddlewareSession/)
})
