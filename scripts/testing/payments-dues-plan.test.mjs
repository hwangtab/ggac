import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planDuesPayment,
  DuesPlanError,
  resolveDuesBillingMonth,
  readDuesMonthState,
  canConfirmDuesPayment,
} from '../../src/lib/payments/dues.ts'

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

// ------------------------------------------------ 확정이 어느 달을 건드리는가

/**
 * 준비와 확정 사이에는 결제창을 여는 사람의 시간이 통째로 들어 있다. 그 사이에
 * 달이 바뀌거나 그 달이 이미 납부로 바뀔 수 있고, 확정이 "지금 달"을 다시
 * 계산하면 낸 달이 아닌 달이 납부로 표시된다.
 */

test('청구월은 주문을 만든 때로 정한다 — 한국 시간 기준', () => {
  // 9월 30일 23시 59분(KST)에 만든 주문. UTC로는 이미 9월 30일 14:59다.
  assert.equal(resolveDuesBillingMonth({ created_at: '2026-09-30T14:59:00.000Z' }), '2026-09')
  // 10월 1일 00시 01분(KST) = 9월 30일 15:01 UTC.
  assert.equal(resolveDuesBillingMonth({ created_at: '2026-09-30T15:01:00.000Z' }), '2026-10')
})

test('월말 자정을 넘겨 승인해도 산 달이 바뀌지 않는다', () => {
  // 이 판정이 "지금"을 보면 9월분을 낸 회원의 10월분이 납부로 표시되고,
  // 9월은 미납으로 남아 다음 청구가 또 나간다.
  const orderedInSeptember = { created_at: '2026-09-30T14:00:00.000Z' }
  assert.equal(resolveDuesBillingMonth(orderedInSeptember), '2026-09')
})

test('주문 생성 시각을 읽지 못하면 달을 지어내지 않는다', () => {
  for (const bad of [
    null,
    {},
    { created_at: null },
    { created_at: '' },
    { created_at: '언젠가' },
  ]) {
    assert.equal(resolveDuesBillingMonth(bad), null)
  }
  assert.equal(resolveDuesBillingMonth({ created_at: new Date('2026-09-30T14:00:00Z') }), '2026-09')
})

test('그 달의 상태는 이 결제의 눈으로 본다', () => {
  assert.equal(readDuesMonthState(null, 'pay1'), 'missing')
  assert.equal(readDuesMonthState({ status: 'unpaid' }, 'pay1'), 'open')
  assert.equal(readDuesMonthState({ status: 'canceled' }, 'pay1'), 'canceled')
  assert.equal(readDuesMonthState({ status: 'paid', payment_id: 'pay1' }, 'pay1'), 'paid-by-this')
  assert.equal(readDuesMonthState({ status: 'paid', payment_id: 'pay2' }, 'pay1'), 'paid-by-other')
  // 결제 식별자를 모르면 "내가 낸 것"이라고 단정하지 않는다.
  assert.equal(readDuesMonthState({ status: 'paid', payment_id: '' }, ''), 'paid-by-other')
})

test('미납과 재확정만 승인으로 간다', () => {
  assert.deepEqual(canConfirmDuesPayment('open', '2026-09'), { ok: true })
  assert.deepEqual(canConfirmDuesPayment('paid-by-this', '2026-09'), { ok: true })
})

test('다른 결제가 이미 낸 달이면 승인하지 않는다 — 카드가 긁히기 전이다', () => {
  // 승인 뒤에 알면 남는 일은 환불뿐이다. 여기서 멈추면 이중 결제 자체가 없다.
  const verdict = canConfirmDuesPayment('paid-by-other', '2026-09')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'paid-by-other')
  assert.match(verdict.message, /2026년 9월/)
  assert.match(verdict.message, /이미 납부/)
})

test('청구가 취소됐거나 행이 없으면 걷지 않는다', () => {
  for (const state of ['canceled', 'missing']) {
    const verdict = canConfirmDuesPayment(state, '2026-09')
    assert.equal(verdict.ok, false, `${state}이(가) 통과했다`)
    assert.equal(verdict.reason, state)
    assert.match(verdict.message, /사무국/)
  }
})
