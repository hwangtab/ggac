import { test } from 'node:test'
import assert from 'node:assert/strict'

import { verifyTurnstileToken } from '../../src/lib/auth/turnstile.ts'

const ORIGINAL_FETCH = global.fetch

function stubFetch(implementation) {
  global.fetch = implementation
}

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

test('비밀 키가 없으면 검증을 건너뛴다(통과) — 기능이 아직 켜지지 않은 환경', async () => {
  stubFetch(() => {
    throw new Error('호출되면 안 된다')
  })
  const result = await verifyTurnstileToken('아무-토큰', '1.2.3.4', undefined)
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'not-configured')
})

test('토큰이 없으면 즉시 거절한다 — Cloudflare에 물어보지 않는다', async () => {
  let called = false
  stubFetch(() => {
    called = true
    throw new Error('호출되면 안 된다')
  })
  const result = await verifyTurnstileToken(undefined, '1.2.3.4', 'sk_test')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing-token')
  assert.equal(called, false)
})

test('Cloudflare가 성공을 답하면 통과한다', async () => {
  stubFetch(async (url, init) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const body = new URLSearchParams(init.body)
    assert.equal(body.get('secret'), 'sk_test')
    assert.equal(body.get('response'), 'tok_ok')
    assert.equal(body.get('remoteip'), '1.2.3.4')
    return { json: async () => ({ success: true }) }
  })
  const result = await verifyTurnstileToken('tok_ok', '1.2.3.4', 'sk_test')
  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
})

test('Cloudflare가 거절을 답하면 거절한다', async () => {
  stubFetch(async () => ({
    json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  }))
  const result = await verifyTurnstileToken('tok_bad', undefined, 'sk_test')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'rejected')
})

test('Cloudflare 조회 자체가 실패하면 거절하지 않고 통과시킨다(가입을 막지 않는다)', async () => {
  stubFetch(async () => {
    throw new Error('네트워크 오류')
  })
  const result = await verifyTurnstileToken('tok_any', undefined, 'sk_test')
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'lookup-failed')
})

test('remoteip 없이도 정상 동작한다 — IP를 못 읽는 요청도 있다', async () => {
  stubFetch(async (url, init) => {
    const body = new URLSearchParams(init.body)
    assert.equal(body.has('remoteip'), false)
    return { json: async () => ({ success: true }) }
  })
  const result = await verifyTurnstileToken('tok_ok', undefined, 'sk_test')
  assert.equal(result.ok, true)
})
