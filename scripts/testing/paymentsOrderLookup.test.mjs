import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createOrderPaymentLookup } from '../../src/lib/payments/orderLookup.ts'
import { TossApiError, TossLookupError } from '../../src/lib/payments/toss/client.ts'

/**
 * 대사 스윕이 "이 주문의 승인이 실제로 있었는가"를 판정하는 자리.
 *
 * 여기서 답을 잘못 읽으면 잃는 것이 크다 — `not_found`로 오판하면 승인된 결제를
 * 못 본 채 선점을 만료시키고(돈은 나갔는데 표가 없다), 주문·금액을 대조하지
 * 않고 승격시키면 남의 결제를 내 주문으로 가로챈다.
 */
function makeLookup(overrides = {}) {
  const payments = {
    // 승인 요청이 나간 적 있는 주문(확정 라우트가 승인 **전에** 새긴다).
    tried: { order_id: 'tried', payment_key: 'pk_1', amount: 10000 },
    // 결제창을 열지도 않은 주문.
    untouched: { order_id: 'untouched', payment_key: null, amount: 10000 },
  }
  const calls = { errors: [] }
  const deps = {
    secretKey: 'sk_test',
    getPaymentByOrderId: async orderId => payments[orderId] ?? null,
    lookupPayment: async () => ({
      status: 'DONE',
      paymentKey: 'pk_1',
      orderId: 'tried',
      totalAmount: 10000,
      method: '카드',
      approvedAt: '2026-09-26T10:00:00+09:00',
    }),
    log: { error: (msg, meta) => calls.errors.push([msg, meta]) },
    ...overrides,
  }
  return { lookup: createOrderPaymentLookup(deps), calls }
}

test('결제 식별자가 없으면 승인 요청 자체가 나간 적이 없다 — not_found', async () => {
  const { lookup } = makeLookup()
  assert.equal(await lookup('untouched'), 'not_found')
})

test('원장에 주문이 없어도 not_found', async () => {
  const { lookup } = makeLookup()
  assert.equal(await lookup('없는주문'), 'not_found')
})

test('주문·금액이 맞는 DONE은 승격 가능한 값으로 돌려준다', async () => {
  const { lookup } = makeLookup()
  const result = await lookup('tried')
  assert.deepEqual(result, {
    status: 'DONE',
    paymentKey: 'pk_1',
    method: '카드',
    approvedAt: '2026-09-26T10:00:00+09:00',
  })
})

test('남의 주문번호가 실린 결제는 mismatch — 보류하지 않고 끝낸다', async () => {
  // 대기 행의 식별자는 클라이언트가 보낸 값을 검증 전에 새긴 것이다. 그대로
  // 승격시키면 남의 결제를 가로챈다. 다시 물어도 답이 같으므로 보류하면 이
  // 행이 다음 스윕의 창을 영영 먹는다.
  const { lookup, calls } = makeLookup({
    lookupPayment: async () => ({
      status: 'DONE',
      paymentKey: 'pk_1',
      orderId: '남의주문',
      totalAmount: 10000,
    }),
  })
  assert.equal(await lookup('tried'), 'mismatch')
  assert.equal(calls.errors.length, 1, '조용히 넘기지 않는다')
})

test('주문번호는 맞는데 금액이 어긋나면 unknown — 사람이 봐야 한다', async () => {
  const { lookup } = makeLookup({
    lookupPayment: async () => ({
      status: 'DONE',
      paymentKey: 'pk_1',
      orderId: 'tried',
      totalAmount: 1000,
    }),
  })
  assert.equal(await lookup('tried'), 'unknown')
})

test('토스가 없다고 답하면 not_found, 못 물었으면 unknown', async () => {
  const gone = makeLookup({ lookupPayment: async () => null })
  assert.equal(await gone.lookup('tried'), 'not_found')

  const down = makeLookup({
    lookupPayment: async () => {
      throw new TossLookupError('타임아웃', {})
    },
  })
  assert.equal(await down.lookup('tried'), 'unknown')

  const notFound = makeLookup({
    lookupPayment: async () => {
      throw new TossApiError('NOT_FOUND_PAYMENT', '없음', 404, {})
    },
  })
  assert.equal(await notFound.lookup('tried'), 'not_found')
})

test('그 밖의 오류는 삼키지 않는다 — 스윕이 보류로 받는다', async () => {
  const { lookup } = makeLookup({
    lookupPayment: async () => {
      throw new Error('알 수 없는 고장')
    },
  })
  await assert.rejects(() => lookup('tried'), /알 수 없는 고장/)
})
