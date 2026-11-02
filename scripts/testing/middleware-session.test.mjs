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

/**
 * 캐시 쿠키의 이름(`__Secure-` 접두사 유무)을 **요청의 프로토콜로** 고른다.
 *
 * better-auth의 `getCookieCache`는 `isSecure`를 주지 않으면 `NODE_ENV`만 보고
 * 운영에서 `__Secure-better-auth.session_data`를 찾는다. 그런데 Better Auth
 * 서버는 http 요청에는 접두사 없이 쿠키를 쓴다 — 운영 빌드를 http로 띄운 권한
 * E2E에서 캐시가 한 번도 맞지 않아 모든 요청이 왕복으로 떨어졌다.
 *
 * 어느 이름을 읽었는지는 secret 누락 예외로 관찰한다: 이름이 맞으면 디코드를
 * 시도하다 던지고(→ 경고 로그), 이름이 틀리면 쿠키를 못 찾아 조용히 넘어간다.
 */
async function cacheCookieWasRead(url, cookie) {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ user: { id: 'user-from-fallback' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )
  const warn = mock.method(console, 'warn', () => {})
  const { readMiddlewareSession } = await import(
    `../../src/middleware/session.ts?t=${Date.now()}-${Math.random()}`
  )
  await readMiddlewareSession({
    headers: new Headers({ cookie: `${cookie}; better-auth.session_token=real-token` }),
    nextUrl: new URL(url),
  })
  return warn.mock.calls.some(call => String(call.arguments[0]).includes('getCookieCache 실패'))
}

// better-auth의 `isProduction`은 모듈을 읽을 때 한 번 정해져 테스트 안에서 NODE_ENV를
// 바꿔도 따라오지 않는다. 그래서 "운영인데 http"는 직접 재현하지 못하고, 아래 https
// 테스트가 "이름을 NODE_ENV가 아니라 프로토콜로 고른다"는 것을 잡는다(수정 전에는
// 테스트 환경에서 https여도 접두사 없는 이름을 찾아 실패한다 — 실측).
test('http 요청에서는 접두사 없는 캐시 쿠키를 읽는다', async () => {
  assert.equal(
    await cacheCookieWasRead('http://127.0.0.1:3104/board', 'better-auth.session_data=x'),
    true
  )
  assert.equal(
    await cacheCookieWasRead('http://127.0.0.1:3104/board', '__Secure-better-auth.session_data=x'),
    false
  )
})

test('https 요청에서는 __Secure- 캐시 쿠키를 읽는다(운영 배포의 모양)', async () => {
  assert.equal(
    await cacheCookieWasRead('https://ggac.kr/board', '__Secure-better-auth.session_data=x'),
    true
  )
  assert.equal(
    await cacheCookieWasRead('https://ggac.kr/board', 'better-auth.session_data=x'),
    false
  )
})
