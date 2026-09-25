import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 사무국 대리 예매 환불 — 무엇을 받아들이고, 어떤 순서로 부르는가.
 *
 * 이 길이 생기기 전 사무국에게 남은 수단은 토스 콘솔뿐이었고, 콘솔 환불은
 * `reservations.status`에 닿지 않는다. 돈은 나갔는데 좌석은 팔린 채로 남는다.
 * 그래서 여기서 지키는 성질은 둘로 갈린다.
 *
 * ① **판정**(`planTicketOfficeRefund`) — 돈이 잡힌 적 없는 예매는 토스를 부르기
 *    전에 막는다. 금액 상한은 원장의 남은 금액이지 브라우저가 보낸 값이 아니다.
 * ② **순서**(`refundReservationAsOffice`) — 토스가 먼저, 좌석·원장이 나중.
 *    뒤집으면 좌석은 풀렸는데 돈은 안 돌아간 상태가 생기고, 그건 화면에
 *    "취소됨"으로 보인다.
 *
 * DB·토스 없이 전부 대역이다 — 실행기가 의존성을 주입받기 때문이다.
 */

const PLAN_URL = new URL('../../src/lib/payments/ticketOfficeRefund.ts', import.meta.url)
const { planTicketOfficeRefund, normalizeTicketRefundReason } = await import(PLAN_URL.href)

const EXEC_URL = new URL('../../src/lib/server/ticketOfficeRefund.ts', import.meta.url)
const { refundReservationAsOffice } = await import(EXEC_URL.href)

const TOSS_URL = new URL('../../src/lib/payments/toss/client.ts', import.meta.url)
const { TossApiError, TossLookupError } = await import(TOSS_URL.href)

const confirmed = {
  id: 'r1',
  status: 'confirmed',
  payment_id: 'pay1',
  total_amount: 30000,
  reservation_code: 'ABCD-2345',
}
const paid = { id: 'pay1', payment_key: 'key1', order_id: 'ticket_1', amount: 30000 }

// ---------------------------------------------------------------- 판정

test('기본은 남은 전액이고, 토스에 금액을 싣지 않는다', () => {
  const plan = planTicketOfficeRefund(confirmed, paid)
  assert.equal(plan.ok, true)
  assert.equal(plan.refundAmount, 30000)
  assert.equal(plan.isFullRefund, true)
  assert.equal(plan.canceledAmountTotal, 30000)
})

test('이미 일부를 돌려준 결제는 남은 금액만 본다 — 누적 총액으로 적는다', () => {
  // `finalizeTicketRefund`는 `canceled_amount`가 **누적**일 때만 두 번째 부분
  // 환불을 반영한다. 이번 회차 금액만 적으면 `lt` 조건에 걸려 조용히 무시된다.
  const plan = planTicketOfficeRefund(confirmed, { ...paid, canceled_amount: 10000 })
  assert.equal(plan.ok, true)
  assert.equal(plan.remaining, 20000)
  assert.equal(plan.refundAmount, 20000)
  assert.equal(plan.canceledAmountTotal, 30000)
})

test('사무국이 적은 금액이 남은 금액을 넘으면 토스를 부르기 전에 막는다', () => {
  const plan = planTicketOfficeRefund(
    confirmed,
    { ...paid, canceled_amount: 10000 },
    {
      requestedAmount: 25000,
    }
  )
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'amount_invalid')
  assert.match(plan.message, /20,000원/)
})

test('부분 환불은 전액이 아니므로 토스에 금액을 싣는다', () => {
  const plan = planTicketOfficeRefund(confirmed, paid, { requestedAmount: 21000 })
  assert.equal(plan.ok, true)
  assert.equal(plan.isFullRefund, false)
  assert.equal(plan.canceledAmountTotal, 21000)
})

test('정수 원이 아닌 금액은 받지 않는다', () => {
  for (const bad of [0, -1, 1000.5, '만원', Number.NaN]) {
    const plan = planTicketOfficeRefund(confirmed, paid, { requestedAmount: bad })
    assert.equal(plan.ok, false, `${bad}이(가) 통과했다`)
    assert.equal(plan.reason, 'amount_invalid')
  }
})

test('공연일을 보지 않는다 — 사무국이 이 길을 쓰는 때가 바로 그 자리다', () => {
  // 본인 취소는 공연 당일이면 닫힌다(`refundPolicy.ts`). 판정에 회차가 아예
  // 들어가지 않으므로, 예매·결제 두 행만으로 답이 나온다.
  const plan = planTicketOfficeRefund(confirmed, paid)
  assert.equal(plan.ok, true)
})

test('이미 취소된 예매와 전액 환불된 결제는 막는다', () => {
  const canceled = planTicketOfficeRefund({ ...confirmed, status: 'canceled' }, paid)
  assert.equal(canceled.ok, false)
  assert.equal(canceled.reason, 'already_refunded')

  const drained = planTicketOfficeRefund(confirmed, { ...paid, canceled_amount: 30000 })
  assert.equal(drained.ok, false)
  assert.equal(drained.reason, 'already_refunded')
})

test('결제가 붙어 있지 않으면 토스에 없는 결제의 취소를 요청하지 않는다', () => {
  const none = planTicketOfficeRefund(confirmed, null)
  assert.equal(none.ok, false)
  assert.equal(none.reason, 'no_payment')

  const keyless = planTicketOfficeRefund(confirmed, { ...paid, payment_key: '' })
  assert.equal(keyless.ok, false)
  assert.equal(keyless.reason, 'no_payment')
})

test('만료된 선점은 환불할 돈이 없다', () => {
  const plan = planTicketOfficeRefund({ ...confirmed, status: 'expired' }, paid)
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'not_captured')
})

test('사유는 열 자 미만이면 통과하지 않는다', () => {
  assert.equal(normalizeTicketRefundReason('짧다'), null)
  assert.equal(normalizeTicketRefundReason(''), null)
  assert.equal(normalizeTicketRefundReason(42), null)
  assert.equal(
    normalizeTicketRefundReason('  공연이 취소되어 전액 환불합니다.  '),
    '공연이 취소되어 전액 환불합니다.'
  )
  assert.equal(normalizeTicketRefundReason('가'.repeat(600)).length, 500)
})

// ---------------------------------------------------------------- 순서

function harness(overrides = {}) {
  const calls = []
  const deps = {
    cancelPayment: async (key, body) => {
      calls.push({ step: 'toss', body })
      return { status: 'CANCELED' }
    },
    finalizeTicketRefund: async input => {
      calls.push({ step: 'ledger', input })
      return { id: 'r1', status: 'canceled', reservation_code: 'ABCD-2345' }
    },
    ...overrides,
  }
  return { deps, calls }
}

const base = {
  reservationId: 'r1',
  paymentId: 'pay1',
  paymentKey: 'key1',
  orderId: 'ticket_1',
  refundAmount: 30000,
  isFullRefund: true,
  canceledAmountTotal: 30000,
  secretKey: 'sk_test',
  actorId: 'admin1',
}

test('토스가 먼저, 좌석·원장이 나중이다', async () => {
  const { deps, calls } = harness()
  const outcome = await refundReservationAsOffice(base, deps)

  assert.equal(outcome.ok, true)
  assert.deepEqual(
    calls.map(c => c.step),
    ['toss', 'ledger']
  )
  // 전액이면 금액을 싣지 않는다 — 토스가 잔액 전부를 취소한다.
  assert.equal(calls[0].body.cancelAmount, undefined)
  assert.equal(calls[1].input.canceledAmount, 30000)
  assert.deepEqual(calls[1].input.raw, { canceledBy: 'office', actorId: 'admin1' })
})

test('부분 환불이면 토스에 금액을 싣고, 원장에는 누적 총액을 적는다', async () => {
  const { deps, calls } = harness()
  await refundReservationAsOffice(
    { ...base, refundAmount: 20000, isFullRefund: false, canceledAmountTotal: 30000 },
    deps
  )
  assert.equal(calls[0].body.cancelAmount, 20000)
  assert.equal(calls[1].input.canceledAmount, 30000)
})

test('토스 응답을 판단하지 못하면 좌석을 풀지 않는다', async () => {
  // 풀어 버리면 돈은 그대로인 채 표만 사라진다 — 관객이 알아채기 어렵다.
  const { deps, calls } = harness({
    cancelPayment: async () => {
      throw new TossLookupError('타임아웃')
    },
  })
  const outcome = await refundReservationAsOffice(base, deps)

  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'lookup')
  assert.deepEqual(
    calls.map(c => c.step),
    []
  )
})

test('토스가 거절하면 좌석도 원장도 건드리지 않는다', async () => {
  const { deps, calls } = harness({
    cancelPayment: async () => {
      throw new TossApiError('NOT_CANCELABLE_AMOUNT', '취소 가능 금액이 아닙니다', 400, {})
    },
  })
  const outcome = await refundReservationAsOffice(base, deps)

  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'rejected')
  assert.equal(outcome.message, '취소 가능 금액이 아닙니다')
  assert.deepEqual(
    calls.map(c => c.step),
    []
  )
})

test('원장이 0행이면 실패로 답한다 — 돈은 이미 나갔으므로 사람이 봐야 한다', async () => {
  const { deps } = harness({ finalizeTicketRefund: async () => null })
  const outcome = await refundReservationAsOffice(base, deps)

  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'record_failed')
})

test('콘솔에서 이미 환불한 건도 같은 버튼으로 정리된다', async () => {
  // 토스 클라이언트가 `ALREADY_CANCELED_PAYMENT`를 성공으로 바꿔 주므로
  // (`toss/client.ts`) 실행기는 평소처럼 좌석을 풀고 원장을 맞춘다.
  const { deps, calls } = harness()
  deps.cancelPayment = async (key, body) => {
    calls.push({ step: 'toss', body })
    return { code: 'ALREADY_CANCELED_PAYMENT', alreadyCanceled: true }
  }
  const outcome = await refundReservationAsOffice(base, deps)

  assert.equal(outcome.ok, true)
  assert.equal(outcome.reservation.status, 'canceled')
  assert.deepEqual(
    calls.map(c => c.step),
    ['toss', 'ledger']
  )
})
