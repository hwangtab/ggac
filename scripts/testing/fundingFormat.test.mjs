import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computePercent,
  computeDaysLeft,
  hasBackers,
  formatAmount,
} from '../../src/app/[locale]/funding/format.ts'

test('달성률은 0 이상 정수이고 목표가 없으면 0', () => {
  assert.equal(computePercent(500000, 1000000), 50)
  assert.equal(computePercent(1500000, 1000000), 150)
  assert.equal(computePercent(1, 3), 33)
  assert.equal(computePercent(0, 1000000), 0)
  assert.equal(computePercent(1000, 0), 0)
  assert.equal(computePercent(-5, 1000), 0)
})

test('남은 기간은 KST 기준이고 지났으면 null', () => {
  // 2026-10-19T23:59:59+09:00 마감, 현재 2026-10-17T10:00+09:00 → 2일 남음
  const now = new Date('2026-10-17T01:00:00Z')
  assert.equal(computeDaysLeft('2026-10-19T14:59:59.000Z', now), 2)
  // 마감 당일은 0이다. 화면이 그때 '오늘 마감'으로 바꿔 적는다
  assert.equal(computeDaysLeft('2026-10-17T14:59:59.000Z', now), 0)
  // 이미 지났으면 null(0일 남음을 보이지 않기 위해)
  assert.equal(computeDaysLeft('2026-10-16T14:59:59.000Z', now), null)
  assert.equal(computeDaysLeft(null, now), null)
  assert.equal(computeDaysLeft('말도 안 되는 값', now), null)
})

test('후원자가 없으면 진행 수치를 감춘다', () => {
  assert.equal(hasBackers({ backer_count: 0 }), false)
  assert.equal(hasBackers({ backer_count: 1 }), true)
})

test('금액은 천 단위로 끊고 음수·소수를 받지 않는다', () => {
  assert.equal(formatAmount(1234567, 'ko'), '1,234,567')
  assert.equal(formatAmount(-5, 'ko'), '0')
  assert.equal(formatAmount(1000.7, 'ko'), '1,000')
})
