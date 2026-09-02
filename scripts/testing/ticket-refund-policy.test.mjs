import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calculateTicketRefund } from '../../src/lib/payments/refundPolicy.ts'

/**
 * 공연 예매 취소 시 돌려줄 금액을 정한다.
 *
 * 근거는 공정거래위원회 소비자분쟁해결기준의 공연 관람 항목이고, 토스에
 * 회신한 환불 규정과 같은 값이어야 한다 — 회신과 화면과 코드가 어긋나면
 * 그게 그대로 분쟁이 된다.
 *
 * 기준일은 **한국 날짜**다. 시각으로 계산하면 같은 날 오전과 오후의 공제율이
 * 달라져 안내와 어긋난다.
 */

const KST = '+09:00'
/** 공연은 2026년 11월 15일 저녁 7시(KST)에 시작한다. */
const SHOW = `2026-11-15T19:00:00${KST}`

/**
 * 한국 날짜 기준으로 D-day를 만든다.
 *
 * KST 자정에서 일수를 빼면 UTC로는 전날 15시라, `getUTCDate()`로 날짜를 뽑는
 * 순간 하루가 밀린다. **정오를 기준으로 빼고 KST 날짜를 그대로 읽어야** 한다.
 */
function daysBefore(days, hour = '12:00:00') {
  const base = new Date(`2026-11-15T12:00:00${KST}`)
  const target = new Date(base.getTime() - days * 86400_000)
  const kstDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target)
  return new Date(`${kstDate}T${hour}${KST}`)
}

function refund(days, hour) {
  return calculateTicketRefund({
    totalAmount: 100000,
    showStartsAt: SHOW,
    now: daysBefore(days, hour),
  })
}

test('공연 10일 전까지는 전액 환불한다', () => {
  const result = refund(10)
  assert.equal(result.refundable, true)
  assert.equal(result.refundAmount, 100000)
  assert.equal(result.deductionRate, 0)
})

test('훨씬 이른 취소도 전액 환불한다', () => {
  assert.equal(refund(30).refundAmount, 100000)
})

test('공연 9일~7일 전은 10%를 공제한다', () => {
  for (const days of [9, 8, 7]) {
    const result = refund(days)
    assert.equal(result.refundable, true, `D-${days}`)
    assert.equal(result.deductionRate, 0.1, `D-${days}`)
    assert.equal(result.refundAmount, 90000, `D-${days}`)
  }
})

test('공연 6일~3일 전은 20%를 공제한다', () => {
  for (const days of [6, 5, 4, 3]) {
    const result = refund(days)
    assert.equal(result.deductionRate, 0.2, `D-${days}`)
    assert.equal(result.refundAmount, 80000, `D-${days}`)
  }
})

test('공연 2일~1일 전은 30%를 공제한다', () => {
  for (const days of [2, 1]) {
    const result = refund(days)
    assert.equal(result.deductionRate, 0.3, `D-${days}`)
    assert.equal(result.refundAmount, 70000, `D-${days}`)
  }
})

test('공연 당일은 취소할 수 없다', () => {
  const result = refund(0, '09:00:00')
  assert.equal(result.refundable, false)
  assert.match(result.reason, /당일/)
})

test('공연이 시작된 뒤에도 취소할 수 없다', () => {
  const result = calculateTicketRefund({
    totalAmount: 100000,
    showStartsAt: SHOW,
    now: new Date(`2026-11-16T10:00:00${KST}`),
  })
  assert.equal(result.refundable, false)
})

test('같은 날 오전과 오후의 공제율이 같다', () => {
  // 시각으로 계산하면 오전에 취소한 사람과 오후에 취소한 사람의 공제율이
  // 달라진다. 안내에는 "며칠 전"이라고만 적혀 있으므로 날짜로 판정해야 한다.
  assert.equal(refund(7, '00:30:00').deductionRate, refund(7, '23:30:00').deductionRate)
})

test('경계 하루 차이로 공제율이 바뀐다', () => {
  // 10일 전(전액)과 9일 전(10% 공제)의 경계.
  assert.equal(refund(10).deductionRate, 0)
  assert.equal(refund(9).deductionRate, 0.1)
  // 7일 전(10%)과 6일 전(20%)의 경계.
  assert.equal(refund(7).deductionRate, 0.1)
  assert.equal(refund(6).deductionRate, 0.2)
  // 3일 전(20%)과 2일 전(30%)의 경계.
  assert.equal(refund(3).deductionRate, 0.2)
  assert.equal(refund(2).deductionRate, 0.3)
})

test('환불액은 원 단위 정수로 떨어진다', () => {
  // 25,000원의 10% = 2,500원. 나누어떨어지지 않는 금액도 소수점이 남으면 안 된다.
  const result = calculateTicketRefund({
    totalAmount: 25000,
    showStartsAt: SHOW,
    now: daysBefore(8),
  })
  assert.equal(Number.isInteger(result.refundAmount), true)
  assert.equal(result.refundAmount, 22500)
})

test('공제액에 소수가 생기면 관객에게 유리하게 올림한다', () => {
  // 33,333원의 10% = 3,333.3원. 공제액을 내림하면 환불액이 커진다 —
  // 사업자가 조금 손해 보는 방향이 분쟁을 줄인다.
  const result = calculateTicketRefund({
    totalAmount: 33333,
    showStartsAt: SHOW,
    now: daysBefore(8),
  })
  assert.equal(result.refundAmount, 33333 - 3333)
})

test('전액 환불이면 부분취소 금액을 따로 넘기지 않도록 표시한다', () => {
  // 토스는 cancelAmount가 없으면 전액 취소로 처리한다. 전액인데 금액을
  // 실어 보내면 반올림 차이로 거절될 수 있다.
  assert.equal(refund(20).isFullRefund, true)
  assert.equal(refund(8).isFullRefund, false)
})

test('금액이 0이면 환불할 것이 없다', () => {
  const result = calculateTicketRefund({
    totalAmount: 0,
    showStartsAt: SHOW,
    now: daysBefore(20),
  })
  assert.equal(result.refundAmount, 0)
})
