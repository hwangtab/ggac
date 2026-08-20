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

/**
 * 수정 라운드 1: "행이 없다"와 "조회를 못 했다"는 다른 사실이고, auth.ts는 그 둘을
 * 다르게 다룬다(전자는 /register/pending, 후자의 catch는 보호 페이지를 /login으로
 * 보낸다). 이 계약이 조용히 무너지면(=실패를 다시 삼켜 null로 뭉개면) 두 실패
 * 사이의 구분이 사라진다 — 아래 테스트는 실제로 함수를 호출해서 그 구분이
 * 살아있는지 검증한다(소스 텍스트 패턴 매칭이 아니라 런타임 동작 자체를 본다).
 */

const PROFILE_MODULE_URL = new URL('../../src/middleware/profile.ts', import.meta.url)

async function loadFreshProfileModule() {
  // 매 테스트마다 새로 로드해서 모듈 캐시나 이전 env 값이 섞이지 않게 한다.
  return import(`${PROFILE_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

test('일치하는 행이 없으면(정상 응답, 빈 배열) null을 반환하고 던지지 않는다', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => [],
  })
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    const result = await fetchMemberProfileForMiddleware('11111111-1111-1111-1111-111111111111')
    assert.equal(result, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('조회 실패(non-OK 응답)는 null로 삼키지 않고 던진다', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ message: 'boom' }),
  })
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    await assert.rejects(() =>
      fetchMemberProfileForMiddleware('11111111-1111-1111-1111-111111111111')
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('조회 실패(네트워크 오류)는 null로 삼키지 않고 던진다', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network unreachable')
  }
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    await assert.rejects(() =>
      fetchMemberProfileForMiddleware('11111111-1111-1111-1111-111111111111')
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('SUPABASE_SERVICE_ROLE_KEY가 없으면 요청을 시도하지 않고 던진다', async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid'
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  const originalFetch = globalThis.fetch
  let fetchCalled = false
  globalThis.fetch = async () => {
    fetchCalled = true
    throw new Error('should not be called')
  }
  try {
    const { fetchMemberProfileForMiddleware } = await loadFreshProfileModule()
    await assert.rejects(() =>
      fetchMemberProfileForMiddleware('11111111-1111-1111-1111-111111111111')
    )
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    }
  }
})
