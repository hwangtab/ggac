import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runExpiryGuard } from '../../src/lib/funding/expiryGuard.ts'

/**
 * 만료 크론의 규칙: 토스가 DONE이면 만료 대신 확정, 조회를 못 하면 보류,
 * 남의 결제 식별자가 실린 건은 보류하지 말고 만료, 그 밖에는 만료.
 * 한 건이 던져도 나머지는 계속된다. 하루 넘게 풀리지 않은 건은 사람에게 넘긴다.
 */
function makeDeps(lookups) {
  const calls = { promoted: [], expired: [] }
  const deps = {
    listExpiredHolds: async () =>
      Object.keys(lookups).map(id => ({ id, order_id: `funding_${id}` })),
    lookupPayment: async orderId => lookups[orderId.replace('funding_', '')],
    promote: async pledge => {
      calls.promoted.push(pledge.id)
      return true
    },
    expire: async id => {
      calls.expired.push(id)
      return true
    },
  }
  return { deps, calls }
}

test('DONE은 승격, 그 밖에는 만료, unknown은 보류', async () => {
  const { deps, calls } = makeDeps({
    a: { status: 'DONE', paymentKey: 'pk_a' },
    b: 'not_found',
    c: { status: 'CANCELED', paymentKey: 'pk_c' },
    d: 'unknown',
  })
  const result = await runExpiryGuard(deps)
  assert.deepEqual(result, {
    promoted: 1,
    expired: 2,
    deferred: 1,
    mismatched: 0,
    unresolvable: 0,
    stuck: 0,
  })
  assert.deepEqual(calls.promoted, ['a'])
  assert.deepEqual(calls.expired.sort(), ['b', 'c'])
})

test('한 건의 예외가 나머지를 막지 않는다(예외 건은 보류)', async () => {
  const { deps, calls } = makeDeps({ a: 'not_found', b: 'not_found' })
  deps.lookupPayment = async orderId => {
    if (orderId === 'funding_a') throw new Error('boom')
    return 'not_found'
  }
  const result = await runExpiryGuard(deps)
  assert.deepEqual(result, {
    promoted: 0,
    expired: 1,
    deferred: 1,
    mismatched: 0,
    unresolvable: 0,
    stuck: 0,
  })
  assert.deepEqual(calls.expired, ['b'])
})

test('승격이 실패하면 만료하지 않는다(다음 실행이 다시 본다)', async () => {
  const { deps, calls } = makeDeps({ a: { status: 'DONE', paymentKey: 'pk' } })
  deps.promote = async () => false
  const result = await runExpiryGuard(deps)
  assert.deepEqual(result, {
    promoted: 0,
    expired: 0,
    deferred: 1,
    mismatched: 0,
    unresolvable: 0,
    stuck: 0,
  })
  assert.deepEqual(calls.expired, [])
})

/**
 * 승인된 돈이 잡혀 있는데 확정할 후원이 없는 건. 그 후원은 이미 `pending`을
 * 벗어나 다음 스윕의 목록에도 오르지 않는다 — 보류로 세면 "다음에 다시
 * 본다"는 거짓말이 결과 숫자로 남고, 아무도 그 돈을 보지 않는다.
 */
test('다시 오지 않는 건은 보류로 세지 않는다', async () => {
  const { deps, calls } = makeDeps({ a: { status: 'DONE', paymentKey: 'pk' } })
  deps.promote = async () => 'unresolvable'
  const result = await runExpiryGuard(deps)
  assert.equal(result.unresolvable, 1)
  assert.equal(result.deferred, 0, '다음 스윕이 다시 보지 못하는 건을 보류로 세면 안 된다')
  assert.equal(result.promoted, 0)
  assert.deepEqual(calls.expired, [])
})

/**
 * 안전망이 눈을 감는 경로. 남의 결제 식별자가 실린 행은 다시 물어도 답이 같아
 * 보류가 영원히 이어졌다 — 그런 행 백 개면 창(최대 100건)이 통째로 막혀,
 * 유실된 승인을 구할 유일한 장치가 새 건을 아예 보지 못한다.
 */
test('mismatch는 보류하지 않고 만료시킨다 — 창을 영영 먹지 못하게', async () => {
  const { deps, calls } = makeDeps({ a: 'mismatch', b: 'not_found' })
  const result = await runExpiryGuard(deps)
  assert.equal(result.mismatched, 1)
  assert.equal(result.deferred, 0, 'mismatch를 보류로 세면 다음 스윕에 또 올라온다')
  assert.equal(result.expired, 2)
  assert.deepEqual(calls.expired.sort(), ['a', 'b'])
})

test('만료 쓰기가 0행이면 mismatch도 보류로 센다', async () => {
  const { deps } = makeDeps({ a: 'mismatch' })
  deps.expire = async () => false
  const result = await runExpiryGuard(deps)
  assert.equal(result.mismatched, 1)
  assert.equal(result.expired, 0)
  assert.equal(result.deferred, 1)
})

test('하루 넘게 풀리지 않은 선점은 세어서 사람에게 넘긴다', async () => {
  const { deps } = makeDeps({ a: 'unknown' })
  const reported = []
  deps.listStuckHolds = async () => [
    { id: 'old-1', order_id: 'funding_old_1' },
    { id: 'old-2', order_id: 'funding_old_2' },
  ]
  deps.reportStuck = pledges => {
    reported.push(...pledges.map(p => p.id))
  }
  const result = await runExpiryGuard(deps)
  assert.equal(result.stuck, 2)
  assert.deepEqual(reported, ['old-1', 'old-2'])
})

test('정체 건이 없으면 알리지 않는다', async () => {
  const { deps } = makeDeps({ a: 'not_found' })
  let called = 0
  deps.listStuckHolds = async () => []
  deps.reportStuck = () => {
    called += 1
  }
  const result = await runExpiryGuard(deps)
  assert.equal(result.stuck, 0)
  assert.equal(called, 0)
})

test('정체 점검이 실패해도 정리 결과는 그대로 돌려준다', async () => {
  const { deps } = makeDeps({ a: 'not_found' })
  deps.listStuckHolds = async () => {
    throw new Error('boom')
  }
  const result = await runExpiryGuard(deps)
  assert.equal(result.expired, 1)
  assert.equal(result.stuck, 0)
})

// ── 크론 라우트 배선 ───────────────────────────────────────────────────────

/**
 * 판단은 위에서 다 봤다. 여기서는 그 판단이 실제로 라우트에 **꽂혀 있는지**만
 * 본다 — 소스 문자열 검사라 동작을 증명하지는 않는다(쿼리 계층 테스트
 * `queriesFundingPledges.test.mjs`가 차례와 정체 목록을 실제 DB로 본다).
 */
const ROUTE = new URL('../../src/app/api/internal/funding/expire/route.ts', import.meta.url)

test('크론 라우트는 남의 결제를 mismatch로 가르고, 금액만 어긋나면 사람에게 남긴다', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(ROUTE, 'utf8')
  assert.match(
    src,
    /return tossOrderId !== orderId \? 'mismatch' : 'unknown'/,
    '두 갈래를 가르지 않으면 남의 결제가 실린 행이 창을 영영 먹는다'
  )
})

test('크론 라우트는 정체된 선점을 세어 사람에게 알린다', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(ROUTE, 'utf8')
  assert.match(src, /listStuckHolds/, '정체 목록을 보지 않는다')
  assert.match(src, /reportStuck/, '정체 건을 아무에게도 알리지 않는다')
  assert.match(
    src,
    /logSecurityEvent\([\s\S]{0,40}'FUNDING_STUCK_PENDING_HOLDS'[\s\S]{0,160}'high'\s*\)/,
    '로그에만 남기면 아무도 보지 않는다'
  )
})

test('크론 라우트의 환불 통지는 간격을 두고 나간다', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(ROUTE, 'utf8')
  assert.match(src, /sendNoticesPaced\(refundNotices/, '통지에 간격이 없다')
  assert.doesNotMatch(
    src,
    /Promise\.allSettled\(refundNotices/,
    '한꺼번에 띄우면 초당 2통 한도에 걸려 대부분이 429로 사라진다'
  )
  assert.match(src, /export const maxDuration = 300/, '간격이 생긴 만큼 수명이 덮어야 한다')
})
