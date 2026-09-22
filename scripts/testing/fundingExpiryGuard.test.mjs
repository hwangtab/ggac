import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runExpiryGuard } from '../../src/lib/funding/expiryGuard.ts'

/**
 * 만료 크론의 세 규칙: 토스가 DONE이면 만료 대신 확정, 조회를 못 하면 보류,
 * 그 밖에는 만료. 한 건이 던져도 나머지는 계속된다.
 */
function makeDeps(lookups) {
  const calls = { promoted: [], expired: [] }
  const deps = {
    listExpiredHolds: async () => Object.keys(lookups).map(id => ({ id, order_id: `funding_${id}` })),
    lookupPayment: async orderId => lookups[orderId.replace('funding_', '')],
    promote: async pledge => { calls.promoted.push(pledge.id); return true },
    expire: async id => { calls.expired.push(id); return true },
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
  assert.deepEqual(result, { promoted: 1, expired: 2, deferred: 1 })
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
  assert.deepEqual(result, { promoted: 0, expired: 1, deferred: 1 })
  assert.deepEqual(calls.expired, ['b'])
})

test('승격이 실패하면 만료하지 않는다(다음 실행이 다시 본다)', async () => {
  const { deps, calls } = makeDeps({ a: { status: 'DONE', paymentKey: 'pk' } })
  deps.promote = async () => false
  const result = await runExpiryGuard(deps)
  assert.deepEqual(result, { promoted: 0, expired: 0, deferred: 1 })
  assert.deepEqual(calls.expired, [])
})
