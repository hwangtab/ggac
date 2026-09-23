import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluateRewardPatch, canDeleteReward } from '../../src/lib/funding/rewardLock.ts'

const unlocked = {
  title: '리워드',
  description: '설명',
  amount: 10000,
  requires_shipping: false,
  total_quantity: 10,
  locked_at: null,
}
const locked = { ...unlocked, locked_at: '2026-09-21T00:00:00.000Z' }

test('잠기지 않은 리워드는 무엇이든 바꾼다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 500, total_quantity: 1 }), { ok: true })
  assert.equal(canDeleteReward(unlocked), true)
})

test('잠긴 리워드는 금액·배송 여부를 못 바꾸고 삭제도 안 된다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 20000 }), {
    ok: false,
    reason: 'locked_amount',
  })
  assert.deepEqual(evaluateRewardPatch(locked, { requires_shipping: true }), {
    ok: false,
    reason: 'locked_shipping',
  })
  assert.equal(canDeleteReward(locked), false)
})

test('잠긴 리워드의 수량은 늘리기만 된다(무제한→한정도 감소)', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 20 }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 5 }), {
    ok: false,
    reason: 'quantity_decrease',
  })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: null }), { ok: true })
  assert.deepEqual(
    evaluateRewardPatch({ ...locked, total_quantity: null }, { total_quantity: 100 }),
    { ok: false, reason: 'quantity_decrease' }
  )
})

test('같은 값으로 덮는 것은 변경이 아니다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 10000, requires_shipping: false }), {
    ok: true,
  })
})

test('공개 중(contentOnly)인 기존 리워드는 결제 여부와 무관하게 이름·설명·금액·배송이 잠긴다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { requires_shipping: true }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { title: '새 이름' }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { description: '새 설명' }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
})

test('공개 중이어도 수량 증가·같은 값 유지는 막지 않는다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: 20 }, 'contentOnly'), {
    ok: true,
  })
  assert.deepEqual(
    evaluateRewardPatch(
      unlocked,
      { amount: 10000, requires_shipping: false, title: '리워드' },
      'contentOnly'
    ),
    { ok: true }
  )
})

test('scope를 안 주거나 all이면 공개 중 잠금이 걸리지 않는다(초안 등)', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }, 'all'), { ok: true })
})
