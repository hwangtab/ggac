import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pledgeRowState } from '../../src/lib/funding/pledgeRowState.ts'

test('결제가 살아 있는 후원만 전액 환불을 건다', () => {
  const paid = pledgeRowState({ status: 'paid', has_payment: true })
  assert.equal(paid.label, '결제 완료')
  assert.equal(paid.canRefund, true)
  assert.equal(paid.canRetryRefund, false)
})

test('취소는 결제 행이 붙어 있는지로 갈린다 — 한 덩어리로 그리지 않는다', () => {
  // 승인까지 갔다가 환불 결과를 확인하지 못한 채 끝난 건. 돈이 아직
  // 돌아가지 않았을 수 있으므로 사람이 봐야 한다.
  const uncertain = pledgeRowState({ status: 'canceled', has_payment: true })
  assert.equal(uncertain.label, '환불 확인 필요')
  assert.equal(uncertain.tone, 'warn')
  assert.equal(uncertain.canRetryRefund, true)
  assert.equal(uncertain.canRefund, false)
  assert.ok(uncertain.hint && uncertain.hint.length > 0, '왜 손이 필요한지 적혀야 한다')

  // 돈이 잡힌 적 없는 취소. 사무국이 할 일이 없다.
  const never = pledgeRowState({ status: 'canceled', has_payment: false })
  assert.equal(never.label, '결제 안 됨')
  assert.equal(never.canRetryRefund, false)
  assert.equal(never.canRefund, false)
  assert.equal(never.hint, null)

  assert.notEqual(uncertain.label, never.label)
})

test('환불이 끝난 건에는 아무 단추도 붙지 않는다', () => {
  const done = pledgeRowState({ status: 'refunded', has_payment: true })
  assert.equal(done.label, '환불됨')
  assert.equal(done.canRefund, false)
  assert.equal(done.canRetryRefund, false)
})

test('결제 전 상태는 돈을 건드릴 수 없다', () => {
  for (const status of ['pending', 'expired']) {
    const row = pledgeRowState({ status, has_payment: false })
    assert.equal(row.canRefund, false, status)
    assert.equal(row.canRetryRefund, false, status)
  }
})

test('모르는 값·빈 입력에도 던지지 않는다', () => {
  assert.equal(pledgeRowState(null).canRefund, false)
  assert.equal(pledgeRowState(undefined).canRetryRefund, false)
  assert.equal(pledgeRowState({ status: 'wat', has_payment: true }).label, 'wat')
})
