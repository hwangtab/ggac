import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 이 테스트는 동작이 아니라 **구조**를 고정한다.
 * 단계 2b-5의 전환 비용은 "Supabase 인증에 닿는 지점이 몇 개인가"로 결정된다.
 * 그 수가 다시 늘어나면 여기서 실패해야 한다.
 */

const FUNNEL = 'src/lib/server/session.ts'

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

test('authz.ts는 스스로 getUser를 부르지 않고 창구를 경유한다', () => {
  const src = readFileSync('src/lib/server/authz.ts', 'utf8')
  assert.doesNotMatch(src, /auth\.getUser\(/)
  assert.match(src, /readSessionUser/)
})

test('memberAuth가 getOptionalUser를 내보낸다', () => {
  const src = readFileSync('src/lib/server/memberAuth.ts', 'utf8')
  assert.match(src, /export .*getOptionalUser/)
})
