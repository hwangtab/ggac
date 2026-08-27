import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runBillingCharges } from '../../src/lib/payments/billingRun.ts'

/**
 * 매월 자동 청구의 **판단 로직**을 검증한다. DB도 토스도 주입받으므로
 * 네트워크 없이 돈다.
 *
 * 이중 청구가 나기 가장 쉬운 자리라 여기 규칙을 전부 고정한다:
 * 이미 낸 사람은 건너뛰고, 판단할 수 없는 실패는 실패로 확정하지 않으며,
 * 한 사람이 실패해도 나머지 청구는 계속된다.
 */

function makeDeps(overrides = {}) {
  const calls = { charged: [], done: [], failed: [], duesPaid: [], ensured: [] }

  const deps = {
    billingMonth: '2026-09',
    listTargets: async () => [
      {
        user_id: 'u1',
        billing_key: 'bk1',
        customer_key: 'ck1',
        monthly_fee: 30000,
        display_name: '가',
        email: 'a@x.kr',
      },
    ],
    getDues: async () => null,
    ensureDues: async input => {
      calls.ensured.push(input)
      return { status: 'unpaid', amount: input.amount }
    },
    createPendingPayment: async input => ({ id: `p_${input.orderId}`, ...input }),
    charge: async (billingKey, input) => {
      calls.charged.push({ billingKey, ...input })
      return {
        status: 'DONE',
        paymentKey: 'pk1',
        method: '카드',
        approvedAt: '2026-09-01T10:00:00+09:00',
      }
    },
    markPaymentDone: async (orderId, patch) => {
      calls.done.push({ orderId, ...patch })
      return { id: `p_${orderId}` }
    },
    markPaymentFailed: async (orderId, patch) => {
      calls.failed.push({ orderId, ...patch })
    },
    markDuesPaid: async input => {
      calls.duesPaid.push(input)
    },
    getPaymentByOrderId: async orderId => ({ id: `p_${orderId}` }),
    notifyFailure: async () => {},
    ...overrides,
  }
  return { deps, calls }
}

test('대상자에게 청구하고 납부 처리한다', async () => {
  const { deps, calls } = makeDeps()

  const result = await runBillingCharges(deps)

  assert.equal(calls.charged.length, 1)
  assert.equal(calls.charged[0].billingKey, 'bk1')
  assert.equal(calls.charged[0].amount, 30000)
  assert.equal(calls.charged[0].customerKey, 'ck1')
  assert.equal(calls.duesPaid.length, 1)
  assert.equal(result.charged, 1)
  assert.equal(result.failed, 0)
})

test('이미 납부한 달은 건너뛴다', async () => {
  // 크론이 두 번 돌거나, 회원이 직접 결제한 뒤 크론이 도는 경우.
  const { deps, calls } = makeDeps({ getDues: async () => ({ status: 'paid', amount: 30000 }) })

  const result = await runBillingCharges(deps)

  assert.equal(calls.charged.length, 0, '이미 낸 사람에게 또 청구하면 안 된다')
  assert.equal(result.skipped, 1)
})

test('회비가 설정되지 않은 회원은 건너뛴다', async () => {
  const { deps, calls } = makeDeps({
    listTargets: async () => [
      { user_id: 'u1', billing_key: 'bk1', customer_key: 'ck1', monthly_fee: null },
    ],
  })

  const result = await runBillingCharges(deps)

  assert.equal(calls.charged.length, 0)
  assert.equal(result.skipped, 1)
})

test('허용 범위를 벗어난 회비는 청구하지 않는다', async () => {
  const { deps, calls } = makeDeps({
    listTargets: async () => [
      { user_id: 'u1', billing_key: 'bk1', customer_key: 'ck1', monthly_fee: 900000 },
    ],
  })

  const result = await runBillingCharges(deps)

  assert.equal(calls.charged.length, 0)
  assert.equal(result.skipped, 1)
})

test('카드가 거절되면 실패로 남기고 안내한다', async () => {
  const err = Object.assign(new Error('한도초과'), {
    name: 'TossApiError',
    code: 'REJECT_CARD_PAYMENT',
  })
  const notified = []
  const { deps, calls } = makeDeps({
    charge: async () => {
      throw err
    },
    notifyFailure: async input => notified.push(input),
  })

  const result = await runBillingCharges(deps)

  assert.equal(calls.failed.length, 1)
  assert.equal(calls.failed[0].code, 'REJECT_CARD_PAYMENT')
  assert.equal(calls.duesPaid.length, 0)
  assert.equal(result.failed, 1)
  assert.equal(notified.length, 1, '회원이 카드를 바꿔 끼울 수 있게 알려야 한다')
})

test('판단할 수 없는 실패는 실패로 확정하지 않는다', async () => {
  // 청구가 나갔는지 모르는 상태다. 실패로 적어 두면 다음 크론이 다시 청구해
  // 이중 결제가 된다.
  const err = Object.assign(new Error('네트워크'), { name: 'TossLookupError' })
  const { deps, calls } = makeDeps({
    charge: async () => {
      throw err
    },
  })

  const result = await runBillingCharges(deps)

  assert.equal(calls.failed.length, 0, '실패로 확정하면 안 된다')
  assert.equal(calls.duesPaid.length, 0, '납부로 처리해서도 안 된다')
  assert.equal(result.undecided, 1)
})

test('한 사람이 실패해도 나머지는 계속 청구한다', async () => {
  const { deps, calls } = makeDeps({
    listTargets: async () => [
      { user_id: 'u1', billing_key: 'bk1', customer_key: 'ck1', monthly_fee: 30000 },
      { user_id: 'u2', billing_key: 'bk2', customer_key: 'ck2', monthly_fee: 20000 },
      { user_id: 'u3', billing_key: 'bk3', customer_key: 'ck3', monthly_fee: 10000 },
    ],
    charge: async billingKey => {
      if (billingKey === 'bk2')
        throw Object.assign(new Error('거절'), { name: 'TossApiError', code: 'X' })
      return { status: 'DONE', paymentKey: 'pk', approvedAt: '2026-09-01T10:00:00+09:00' }
    },
  })

  const result = await runBillingCharges(deps)

  assert.equal(result.charged, 2)
  assert.equal(result.failed, 1)
  assert.equal(calls.duesPaid.length, 2)
})

test('주문번호는 회원마다 다르다', async () => {
  const { deps, calls } = makeDeps({
    listTargets: async () => [
      { user_id: 'u1', billing_key: 'bk1', customer_key: 'ck1', monthly_fee: 30000 },
      { user_id: 'u2', billing_key: 'bk2', customer_key: 'ck2', monthly_fee: 30000 },
    ],
  })

  await runBillingCharges(deps)

  assert.notEqual(calls.charged[0].orderId, calls.charged[1].orderId)
})

test('청구 전에 그 달 청구 행을 만든다', async () => {
  // 청구 행이 없으면 "이 달에 얼마를 청구했는가"가 남지 않는다.
  const { deps, calls } = makeDeps()
  await runBillingCharges(deps)
  assert.equal(calls.ensured[0].billingMonth, '2026-09')
  assert.equal(calls.ensured[0].amount, 30000)
})

test('대상이 없으면 아무것도 하지 않는다', async () => {
  const { deps, calls } = makeDeps({ listTargets: async () => [] })
  const result = await runBillingCharges(deps)
  assert.equal(calls.charged.length, 0)
  assert.equal(result.charged, 0)
})
