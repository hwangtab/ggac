import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ADMIN_RESERVATION_STATUSES,
  RESERVATION_LIST_DEFAULT_LIMIT,
  RESERVATION_LIST_MAX_LIMIT,
  RESERVATION_SEARCH_MAX,
  parseReservationListQuery,
  refundableWon,
  reservationRowState,
} from '../../src/lib/payments/ticketReservationList.ts'
import { RESERVATION_STATUS } from '../../src/db/schema/ticketing.ts'

/** `URLSearchParams`가 아니어도 된다 — 이 모듈이 쓰는 것은 `get` 하나다. */
function params(obj) {
  return { get: name => (name in obj ? String(obj[name]) : null) }
}

// ------------------------------------------------------------ 질의 해석

test('아무것도 주지 않으면 필터 없이 첫 쪽을 본다', () => {
  const q = parseReservationListQuery(params({}))
  assert.equal(q.performanceId, null)
  assert.equal(q.status, null)
  assert.equal(q.search, null)
  assert.equal(q.limit, RESERVATION_LIST_DEFAULT_LIMIT)
  assert.equal(q.offset, 0)
})

test('상태 목록은 스키마와 같아야 한다 — 갈라지면 필터가 조용히 빈다', () => {
  assert.deepEqual([...ADMIN_RESERVATION_STATUSES].sort(), [...RESERVATION_STATUS].sort())
})

test('모르는 상태는 400이 아니라 "필터 없음"이다', () => {
  // 드롭다운 값 하나의 오타로 화면이 통째로 빈칸이 되면 안 된다.
  assert.equal(parseReservationListQuery(params({ status: 'refunded' })).status, null)
  assert.equal(parseReservationListQuery(params({ status: '' })).status, null)
  assert.equal(parseReservationListQuery(params({ status: 'confirmed' })).status, 'confirmed')
})

test('페이지 크기는 상한을 넘지 못하고, 이상한 값은 기본값으로 떨어진다', () => {
  assert.equal(parseReservationListQuery(params({ limit: '10' })).limit, 10)
  assert.equal(
    parseReservationListQuery(params({ limit: '99999' })).limit,
    RESERVATION_LIST_MAX_LIMIT
  )
  for (const bad of ['0', '-5', 'abc', '1.5', '']) {
    assert.equal(
      parseReservationListQuery(params({ limit: bad })).limit,
      RESERVATION_LIST_DEFAULT_LIMIT,
      bad
    )
  }
})

test('음수 offset은 0으로 접는다', () => {
  assert.equal(parseReservationListQuery(params({ offset: '60' })).offset, 60)
  assert.equal(parseReservationListQuery(params({ offset: '-1' })).offset, 0)
  assert.equal(parseReservationListQuery(params({ offset: 'x' })).offset, 0)
})

test('검색어는 앞뒤 공백을 떼고 길이를 자른다', () => {
  assert.equal(parseReservationListQuery(params({ q: '  홍길동  ' })).search, '홍길동')
  assert.equal(parseReservationListQuery(params({ q: '   ' })).search, null)
  const long = 'ㄱ'.repeat(RESERVATION_SEARCH_MAX + 50)
  assert.equal(parseReservationListQuery(params({ q: long })).search.length, RESERVATION_SEARCH_MAX)
})

// ------------------------------------------------------------ 남은 금액

test('남은 금액은 결제액에서 이미 취소된 금액을 뺀 값이고, 음수가 되지 않는다', () => {
  assert.equal(refundableWon(20000, 0), 20000)
  assert.equal(refundableWon(20000, 5000), 15000)
  assert.equal(refundableWon(20000, 20000), 0)
  // 원장이 어긋나 취소액이 결제액을 넘어도 "마이너스 환불"을 제안하지 않는다.
  assert.equal(refundableWon(20000, 30000), 0)
  // 결제 행이 없는 줄(LEFT JOIN의 null)은 0이다.
  assert.equal(refundableWon(null, null), 0)
  assert.equal(refundableWon(undefined, undefined), 0)
  assert.equal(refundableWon('20000', '1000'), 19000)
})

// ------------------------------------------------------------ 한 줄의 판정

test('좌석을 쥔 예매에 돌려줄 돈이 있으면 환불 단추를 그린다', () => {
  const row = reservationRowState({
    status: 'confirmed',
    has_payment: true,
    refundable_amount: 20000,
  })
  assert.equal(row.label, '예매 확정')
  assert.equal(row.canRefund, true)
  assert.equal(row.hint, null)
})

test('이미 전액이 환불된 건에는 단추 대신 이유가 붙는다', () => {
  const row = reservationRowState({ status: 'confirmed', has_payment: true, refundable_amount: 0 })
  assert.equal(row.canRefund, false)
  assert.equal(row.tone, 'done')
  assert.ok(row.hint && row.hint.length > 0, '왜 못 누르는지 적혀야 한다')
})

test('확정인데 결제가 없는 줄은 눈에 띄어야 한다', () => {
  // 돈이 실제로 잡혔다면 토스 콘솔에서 환불된 뒤 원장만 남은 것일 수 있다.
  const row = reservationRowState({
    status: 'confirmed',
    has_payment: false,
    refundable_amount: 0,
  })
  assert.equal(row.canRefund, false)
  assert.equal(row.tone, 'warn')
  assert.ok(row.hint)
})

test('결제가 잡힌 채로 확정되지 않은 선점은 환불할 수 있되 경고를 붙인다', () => {
  const row = reservationRowState({
    status: 'pending',
    has_payment: true,
    refundable_amount: 20000,
  })
  assert.equal(row.canRefund, true)
  assert.equal(row.tone, 'warn')
  assert.ok(row.hint, '돈만 나간 채 좌석이 뜬 상태일 수 있다고 말해야 한다')

  // 결제가 붙지 않은 평범한 선점은 그냥 대기다.
  const plain = reservationRowState({ status: 'pending', has_payment: false, refundable_amount: 0 })
  assert.equal(plain.canRefund, false)
  assert.equal(plain.tone, 'neutral')
  assert.equal(plain.hint, null)
})

test('좌석을 놓은 예매에는 단추가 붙지 않는다', () => {
  for (const status of ['canceled', 'expired']) {
    const row = reservationRowState({ status, has_payment: true, refundable_amount: 20000 })
    assert.equal(row.canRefund, false, status)
  }
})

test('알 수 없는 값·빈 줄에도 터지지 않는다', () => {
  assert.equal(reservationRowState(null).canRefund, false)
  assert.equal(reservationRowState(undefined).label, '알 수 없음')
  assert.equal(
    reservationRowState({ status: 'wat', has_payment: true, refundable_amount: 1 }).canRefund,
    false
  )
})
