import test from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 계좌 열람 빈도 제한이 **실제로 센다**는 것과, 두 라우트가 **같은 카운터를
 * 나눠 쓴다**는 것을 확인한다.
 *
 * 이 두 가지가 이 변경의 전부다. 상수만 읽어 숫자를 대조하면, 제한기가 그
 * 설정을 실제로 적용하는지도, 한쪽을 다 쓴 뒤 다른 쪽으로 이어 걸을 수
 * 있는지도 아무 말을 하지 않는다.
 *
 * Upstash 환경변수가 없으므로 제한기는 인스턴스 메모리 폴백으로 센다 —
 * 운영(Vercel)에서는 Redis가 같은 일을 분산으로 한다.
 */

delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

registerAliasResolveHook(import.meta.url)

const { ACCOUNT_REVEAL_RATE_LIMIT, accountRevealRateLimitKey } = await import(
  '../../src/lib/server/accountRevealLimit.ts'
)
const { applyRateLimit } = await import('../../src/lib/server/rateLimit.ts')

/** 라우트가 넘기는 것과 같은 모양. 키는 요청이 아니라 관리자 id가 정한다. */
function limiterFor(adminUserId) {
  return applyRateLimit({
    ...ACCOUNT_REVEAL_RATE_LIMIT,
    keyGenerator: () => accountRevealRateLimitKey(adminUserId),
  })
}

function fakeRequest(url) {
  return {
    url,
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    nextUrl: new URL(url),
  }
}

test('한 관리자가 30번까지는 통과하고 31번째에 막힌다', async () => {
  const limiter = await limiterFor('admin-counting')
  for (let i = 1; i <= ACCOUNT_REVEAL_RATE_LIMIT.maxRequests; i++) {
    const res = await limiter(fakeRequest('https://ggac.kr/api/admin/members/x/account'))
    assert.equal(res.success, true, `${i}번째 요청이 막혔다 — 사무국의 정상 업무가 막힌다`)
  }
  const over = await limiter(fakeRequest('https://ggac.kr/api/admin/members/x/account'))
  assert.equal(over.success, false)
  assert.equal(over.response?.status, 429)
})

test('조합원 계좌와 정산 계좌가 카운터를 나눠 쓴다 — 한쪽을 다 쓰면 다른 쪽도 막힌다', async () => {
  const admin = 'admin-shared-counter'
  // 조합원 계좌 라우트 쪽에서 한도를 소진한다.
  const members = await limiterFor(admin)
  for (let i = 0; i < ACCOUNT_REVEAL_RATE_LIMIT.maxRequests; i++) {
    await members(fakeRequest('https://ggac.kr/api/admin/members/x/account'))
  }
  // 정산 패널 쪽은 다른 라우트·다른 주소지만 같은 키를 만든다.
  const settlement = await limiterFor(admin)
  const res = await settlement(
    fakeRequest('https://ggac.kr/api/admin/funding/campaigns/c1/settlement?account=1')
  )
  assert.equal(res.success, false, '따로 세면 한쪽을 다 쓴 뒤 다른 쪽으로 이어 걸을 수 있다')
})

test('다른 관리자는 서로의 한도를 깎지 않는다', async () => {
  const a = await limiterFor('admin-a')
  for (let i = 0; i < ACCOUNT_REVEAL_RATE_LIMIT.maxRequests; i++) {
    await a(fakeRequest('https://ggac.kr/api/admin/members/x/account'))
  }
  const b = await limiterFor('admin-b')
  const res = await b(fakeRequest('https://ggac.kr/api/admin/members/x/account'))
  assert.equal(res.success, true, '사무실 IP가 아니라 사람을 세야 한다')
})

test('막힐 때 무엇을 하면 되는지 말해 준다', () => {
  assert.match(ACCOUNT_REVEAL_RATE_LIMIT.message, /30번/)
  assert.match(ACCOUNT_REVEAL_RATE_LIMIT.message, /다시 시도/)
  assert.equal(ACCOUNT_REVEAL_RATE_LIMIT.windowMs, 60 * 60 * 1000)
})
