import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 구조를 고정한다. 미들웨어의 프로필 조회가 RLS 적용 클라이언트로 되돌아가면
 * 전환 후 승인된 조합원 전원이 미승인 취급된다 — 그 회귀를 여기서 잡는다.
 */

test('미들웨어 프로필 모듈이 서비스롤 키를 쓴다', () => {
  const src = readFileSync('src/middleware/profile.ts', 'utf8')
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/)
})

test('미들웨어 프로필 모듈은 쿠키 기반 클라이언트를 쓰지 않는다', () => {
  const src = readFileSync('src/middleware/profile.ts', 'utf8')
  assert.doesNotMatch(src, /createServerClient|createSupabaseServer|ANON_KEY/)
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
