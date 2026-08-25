import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 결함 재현 + 수정 검증 (Task 8, src/middleware/session.ts).
 *
 * 실측(오케스트레이터, 2026-08-24): `getCookieCache`가 "requires a secret to
 * be provided"로 던지면(BETTER_AUTH_SECRET 미설정 + 캐시 쿠키 존재), 옛
 * `readMiddlewareSession`은 함수 전체를 감싼 try/catch가 이 예외를 삼켜 폴백
 * (fetchVerifiedSession — 세션 쿠키만 있으면 200으로 정상 세션을 돌려주는
 * 경로)에 아예 도달하지 못하고 곧장 null을 반환했다. 실제로는 세션 쿠키가
 * 멀쩡히 있고 폴백도 정상 동작하는데(로그에 `fetchVerifiedSession
 * status=200`) 미들웨어가 비로그인으로 오판한 것이다.
 *
 * 이 테스트는 better-auth의 실제 `getCookieCache` 구현
 * (node_modules/better-auth/dist/cookies/index.mjs)이 캐시 쿠키가 있는데
 * `BETTER_AUTH_SECRET`이 없으면 `BetterAuthError`를 던진다는 사실을 그대로
 * 이용해 결함을 재현한다(모킹으로 흉내 낸 가짜 예외가 아니라 실제 라이브러리
 * 코드 경로).
 */

const originalSecret = process.env.BETTER_AUTH_SECRET
const originalNodeEnv = process.env.NODE_ENV

function buildRequestWithStaleCache() {
  // session_data(캐시) 쿠키와 session_token(세션) 쿠키를 둘 다 심는다 —
  // getCookieCache는 session_data가 있어야만 디코드를 시도해 secret 누락으로
  // 던지고, session_token은 getSessionCookie가 "쿠키 자체는 있다"고 판단해
  // 폴백(fetchVerifiedSession)으로 넘어가게 한다.
  const headers = new Headers({
    cookie: 'better-auth.session_data=stale-cache-value; better-auth.session_token=real-token',
  })
  return {
    headers,
    nextUrl: new URL('http://localhost:3000/board'),
  }
}

test.beforeEach(() => {
  delete process.env.BETTER_AUTH_SECRET
  process.env.NODE_ENV = 'test'
})

test.afterEach(() => {
  if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = originalSecret
  process.env.NODE_ENV = originalNodeEnv
  mock.restoreAll()
})

test('getCookieCache가 secret 누락으로 던져도 세션 쿠키가 있으면 fetchVerifiedSession 폴백이 세션을 돌려준다', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ user: { id: 'user-from-fallback' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )

  const { readMiddlewareSession } = await import(
    `../../src/middleware/session.ts?t=${Date.now()}-${Math.random()}`
  )

  const result = await readMiddlewareSession(buildRequestWithStaleCache())

  assert.deepEqual(
    result,
    { id: 'user-from-fallback' },
    'getCookieCache가 던져도 fetchVerifiedSession 폴백에 도달해 세션을 돌려줘야 한다(fail-closed로 null이 되면 안 됨)'
  )
  assert.equal(fetchMock.mock.callCount(), 1, 'fetchVerifiedSession이 정확히 한 번 호출돼야 한다')
})

test('세션 쿠키 자체가 없으면(캐시도 없음) 왕복 없이 null이다', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('호출되면 안 된다')
  })

  const { readMiddlewareSession } = await import(
    `../../src/middleware/session.ts?t=${Date.now()}-${Math.random()}`
  )

  const result = await readMiddlewareSession({
    headers: new Headers(),
    nextUrl: new URL('http://localhost:3000/board'),
  })

  assert.equal(result, null)
  assert.equal(
    fetchMock.mock.callCount(),
    0,
    '익명 방문자는 fetchVerifiedSession을 호출하지 않아야 한다'
  )
})

test('fetchVerifiedSession 자체가 실패해도(네트워크 오류) fail-closed로 null을 반환하고 던지지 않는다', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('네트워크 오류(시뮬레이션)')
  })

  const { readMiddlewareSession } = await import(
    `../../src/middleware/session.ts?t=${Date.now()}-${Math.random()}`
  )

  const result = await readMiddlewareSession(buildRequestWithStaleCache())
  assert.equal(
    result,
    null,
    '폴백 자체의 실패는 여전히 null이어야 한다(fail-closed) — throw하면 미들웨어가 500을 낸다'
  )
})
