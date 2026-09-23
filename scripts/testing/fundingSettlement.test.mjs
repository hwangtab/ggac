import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 정산 셈 — 순수 함수만. DB도 네트워크도 쓰지 않는다.
 *
 * 돈이라서 숫자를 고약하게 고른다. 나누어떨어지지 않는 수수료율, 환불이 섞인
 * 모금액, 지급액이 0원이 되는 경계, 지급액을 음수로 만드는 입력.
 */

const {
  computeSettlementAmounts,
  isBasisStale,
  netAmount,
  platformFeeFor,
  SETTLEMENT_STATUS_LABEL,
} = await import('../../src/lib/funding/settlement.ts')

function amountsOf(basis, rate, pgFee) {
  const result = computeSettlementAmounts({
    basis,
    platform_fee_rate_bp: rate,
    pg_fee_amount: pgFee,
  })
  assert.equal(result.ok, true, result.ok === false ? result.message : '')
  return result.amounts
}

test('실 모금액은 총 모금액에서 환불을 뺀 값이다', () => {
  const basis = { gross_amount: 1_000_000, refund_amount: 250_000, backer_count: 15 }
  assert.equal(netAmount(basis), 750_000)
  const a = amountsOf(basis, 0, 0)
  assert.equal(a.gross_amount - a.refund_amount, 750_000)
  assert.equal(a.payout_amount, 750_000)
})

test('플랫폼 수수료가 0%면 조합은 한 푼도 가져가지 않는다 — 오늘의 기본값', () => {
  const a = amountsOf({ gross_amount: 333_333, refund_amount: 0, backer_count: 3 }, 0, 0)
  assert.equal(a.platform_fee_amount, 0)
  assert.equal(a.payout_amount, 333_333)
})

test('나누어떨어지지 않는 수수료는 버린다 — 1원은 창작자에게 간다', () => {
  // 실 모금액 333,333원 × 5%(500bp) = 16,666.65원.
  assert.equal(platformFeeFor(333_333, 500), 16_666)
  const a = amountsOf({ gross_amount: 333_333, refund_amount: 0, backer_count: 3 }, 500, 0)
  assert.equal(a.platform_fee_amount, 16_666)
  assert.equal(a.payout_amount, 333_333 - 16_666)
  // 올림이었다면 16,667원이 되어 조합이 1원을 더 가져간다.
  assert.notEqual(a.platform_fee_amount, 16_667)
})

test('환불과 수수료가 함께 있는 셈 — 화면의 뺄셈과 정확히 같다', () => {
  const basis = { gross_amount: 1_234_567, refund_amount: 234_567, backer_count: 21 }
  const a = amountsOf(basis, 700, 31_415)
  const net = 1_000_000
  const platform = Math.floor((net * 700) / 10_000) // 70,000
  assert.equal(a.platform_fee_amount, platform)
  assert.equal(a.payout_amount, net - 31_415 - platform)
  assert.equal(
    a.gross_amount - a.refund_amount - a.pg_fee_amount - a.platform_fee_amount,
    a.payout_amount
  )
})

test('지급액이 0원이 되는 경계는 정상이다 — 거부하지 않는다', () => {
  // 실 모금액 100,000원, 플랫폼 수수료 3,000원, 결제대행 수수료 97,000원.
  const a = amountsOf({ gross_amount: 100_000, refund_amount: 0, backer_count: 2 }, 300, 97_000)
  assert.equal(a.platform_fee_amount, 3_000)
  assert.equal(a.payout_amount, 0)
})

test('전액 환불된 캠페인은 실 모금액도 지급액도 0이다', () => {
  const a = amountsOf({ gross_amount: 500_000, refund_amount: 500_000, backer_count: 0 }, 1000, 0)
  assert.equal(a.platform_fee_amount, 0)
  assert.equal(a.payout_amount, 0)
})

test('지급액을 음수로 만드는 결제대행 수수료는 거부한다 — 조용히 0으로 깎지 않는다', () => {
  const result = computeSettlementAmounts({
    basis: { gross_amount: 100_000, refund_amount: 0, backer_count: 2 },
    platform_fee_rate_bp: 300,
    pg_fee_amount: 97_001,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'pg_fee_too_large')
  // 관리자가 얼마까지 넣을 수 있는지 문장이 알려 준다.
  assert.match(result.message, /97,000원까지/)
})

test('정수가 아니거나 음수인 결제대행 수수료는 거부한다', () => {
  for (const bad of [-1, 1.5, NaN, '1000', null, undefined]) {
    const result = computeSettlementAmounts({
      basis: { gross_amount: 100_000, refund_amount: 0, backer_count: 1 },
      platform_fee_rate_bp: 0,
      pg_fee_amount: bad,
    })
    assert.equal(result.ok, false, `${String(bad)}가 통과했다`)
    assert.equal(result.reason, 'pg_fee')
  }
})

test('환불액이 총 모금액보다 크면 합산이 잘못된 것이다 — 셈을 멈춘다', () => {
  const result = computeSettlementAmounts({
    basis: { gross_amount: 10_000, refund_amount: 20_000, backer_count: 0 },
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'basis')
})

test('수수료율은 승인 시점 스냅샷의 범위(0~3000bp) 안이어야 한다', () => {
  for (const bad of [-1, 3001, 2.5]) {
    const result = computeSettlementAmounts({
      basis: { gross_amount: 10_000, refund_amount: 0, backer_count: 1 },
      platform_fee_rate_bp: bad,
      pg_fee_amount: 0,
    })
    assert.equal(result.ok, false, `${bad}bp가 통과했다`)
    assert.equal(result.reason, 'rate')
  }
})

test('근거 세 값 중 하나라도 움직이면 낡은 정산서다', () => {
  const stored = { gross_amount: 100_000, refund_amount: 0, backer_count: 3 }
  assert.equal(isBasisStale(stored, { ...stored }), false)
  assert.equal(isBasisStale(stored, { ...stored, refund_amount: 30_000 }), true)
  assert.equal(isBasisStale(stored, { ...stored, gross_amount: 130_000 }), true)
  assert.equal(isBasisStale(stored, { ...stored, backer_count: 2 }), true)
})

test('상태 표기는 한국어다', () => {
  assert.equal(SETTLEMENT_STATUS_LABEL.pending, '지급 전')
  assert.equal(SETTLEMENT_STATUS_LABEL.paid, '지급 완료')
})
