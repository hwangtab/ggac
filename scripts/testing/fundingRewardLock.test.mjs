import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluateRewardPatch, canDeleteReward } from '../../src/lib/funding/rewardLock.ts'

const unlocked = { amount: 10000, requires_shipping: false, total_quantity: 10, locked_at: null }
const locked = { ...unlocked, locked_at: '2026-09-21T00:00:00.000Z' }

test('잠기지 않은 리워드는 무엇이든 바꾼다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 500, total_quantity: 1 }), { ok: true })
  assert.equal(canDeleteReward(unlocked), true)
})

test('잠긴 리워드는 금액·배송 여부를 못 바꾸고 삭제도 안 된다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 20000 }), { ok: false, reason: 'locked_amount' })
  assert.deepEqual(evaluateRewardPatch(locked, { requires_shipping: true }), { ok: false, reason: 'locked_shipping' })
  assert.equal(canDeleteReward(locked), false)
})

test('잠긴 리워드의 수량은 늘리기만 된다(무제한→한정도 감소)', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 20 }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 5 }), { ok: false, reason: 'quantity_decrease' })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: null }), { ok: true })
  assert.deepEqual(
    evaluateRewardPatch({ ...locked, total_quantity: null }, { total_quantity: 100 }),
    { ok: false, reason: 'quantity_decrease' }
  )
})

test('같은 값으로 덮는 것은 변경이 아니다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 10000, requires_shipping: false }), { ok: true })
})
