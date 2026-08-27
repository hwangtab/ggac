import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planDuesPayment, DuesPlanError } from '../../src/lib/payments/dues.ts'

/**
 * "이 회원이 이번 달 회비를 결제할 수 있는가"를 판정하는 순수 함수.
 *
 * 라우트에서 이 판단을 인라인으로 하면 테스트가 요청 스코프를 필요로 하게 되고,
 * 결국 아무도 테스트하지 않는다. 그래서 판단만 떼어 낸다.
 */

function profile(overrides = {}) {
  return { monthly_fee: 30000, display_name: '홍길동', ...overrides }
}

test('미납이면 결제 계획을 돌려준다', () => {
  const plan = planDuesPayment({
    profile: profile(),
    billingMonth: '2026-09',
    existingDues: null,
  })

  assert.equal(plan.amount, 30000)
  assert.match(plan.orderName, /2026년 9월/)
})

test('주문명에 조합비임이 드러난다', () => {
  // 카드 명세서와 영수증에 그대로 찍히는 문구다.
  const plan = planDuesPayment({ profile: profile(), billingMonth: '2026-09', existingDues: null })
  assert.match(plan.orderName, /조합비/)
})

test('미납 상태의 기존 청구 행이 있으면 그 금액을 따른다', () => {
  // 청구서를 이미 보낸 뒤 회원이 회비 설정을 바꿔도, 그 달 청구액은 고지한 값이다.
  const plan = planDuesPayment({
    profile: profile({ monthly_fee: 50000 }),
    billingMonth: '2026-09',
    existingDues: { status: 'unpaid', amount: 30000 },
  })

  assert.equal(plan.amount, 30000)
})

test('이미 납부한 달은 거부한다', () => {
  assert.throws(
    () =>
      planDuesPayment({
        profile: profile(),
        billingMonth: '2026-09',
        existingDues: { status: 'paid', amount: 30000 },
      }),
    error => {
      assert.ok(error instanceof DuesPlanError)
      assert.equal(error.reason, 'already-paid')
      return true
    }
  )
})

test('회비 금액이 없는 회원은 거부한다', () => {
  // 가입 때 회비를 안 정한 회원이다. 임의로 금액을 정하면 안 된다.
  assert.throws(
    () =>
      planDuesPayment({
        profile: profile({ monthly_fee: null }),
        billingMonth: '2026-09',
        existingDues: null,
      }),
    error => {
      assert.ok(error instanceof DuesPlanError)
      assert.equal(error.reason, 'no-fee-set')
      return true
    }
  )
})

test('허용 범위를 벗어난 회비는 거부한다', () => {
  // 데이터가 어떤 경로로든 오염됐을 때 그 금액으로 결제창을 띄우지 않는다.
  assert.throws(
    () =>
      planDuesPayment({
        profile: profile({ monthly_fee: 1_000_000 }),
        billingMonth: '2026-09',
        existingDues: null,
      }),
    DuesPlanError
  )
})

test('거부 사유에 사람이 읽을 안내 문구가 들어 있다', () => {
  try {
    planDuesPayment({
      profile: profile(),
      billingMonth: '2026-09',
      existingDues: { status: 'paid', amount: 30000 },
    })
    assert.fail('던졌어야 한다')
  } catch (error) {
    assert.match(error.message, /납부/)
  }
})
