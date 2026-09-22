import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computePledgeTotal, PledgeAmountError, MAX_QUANTITY } from '../../src/lib/funding/amounts.ts'
import { generatePledgeCode, isPledgeCode } from '../../src/lib/funding/pledgeCode.ts'

test('합계 = 단가×수량 + 추가금', () => {
  assert.equal(computePledgeTotal({ unitAmount: 30000, quantity: 2, additionalAmount: 5000 }), 65000)
})

test('수량 0·소수·상한 초과는 거절', () => {
  for (const quantity of [0, 1.5, MAX_QUANTITY + 1, -1]) {
    assert.throws(
      () => computePledgeTotal({ unitAmount: 1000, quantity, additionalAmount: 0 }),
      e => e instanceof PledgeAmountError && e.reason === 'quantity'
    )
  }
})

test('추가금은 1000원 단위, 0 이상, 500만 원 이하', () => {
  for (const additionalAmount of [500, -1000, 5_001_000]) {
    assert.throws(
      () => computePledgeTotal({ unitAmount: 1000, quantity: 1, additionalAmount }),
      e => e instanceof PledgeAmountError && e.reason === 'additional'
    )
  }
  assert.equal(computePledgeTotal({ unitAmount: 1000, quantity: 1, additionalAmount: 0 }), 1000)
})

test('단가는 양의 정수', () => {
  assert.throws(
    () => computePledgeTotal({ unitAmount: 0, quantity: 1, additionalAmount: 0 }),
    e => e instanceof PledgeAmountError && e.reason === 'unit'
  )
})

test('후원번호 형식과 KST 날짜', () => {
  // UTC 2026-09-21 16:00 = KST 2026-09-22 01:00
  const code = generatePledgeCode(new Date('2026-09-21T16:00:00Z'))
  assert.match(code, /^FND-20260922-[A-HJ-NP-Z2-9]{8}$/)
  assert.ok(isPledgeCode(code))
  assert.equal(isPledgeCode('FND-2026-XX'), false)
})
