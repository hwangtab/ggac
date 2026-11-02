import { test } from 'node:test'
import assert from 'node:assert/strict'

import { kstMonthKey, kstMonthRange } from '../../src/lib/timebank/month.ts'

test('kstMonthRange는 KST 월의 [시작, 끝)을 UTC 밀리초로 준다', () => {
  assert.deepEqual(kstMonthRange('2026-11'), {
    startMs: Date.UTC(2026, 9, 31, 15),
    endMs: Date.UTC(2026, 10, 30, 15),
  })
})

test('12월은 다음 해 1월 KST 자정에서 끝난다', () => {
  assert.deepEqual(kstMonthRange('2026-12'), {
    startMs: Date.UTC(2026, 10, 30, 15),
    endMs: Date.UTC(2026, 11, 31, 15),
  })
})

test('kstMonthKey는 KST 기준 월을 준다', () => {
  // KST 12/1 00:30
  assert.equal(kstMonthKey(new Date('2026-11-30T15:30:00Z')), '2026-12')
  // KST 11/30 23:59
  assert.equal(kstMonthKey(new Date('2026-11-30T14:59:00Z')), '2026-11')
  // KST 2027-01-01 00:00 — 해가 넘어간다
  assert.equal(kstMonthKey(new Date('2026-12-31T15:00:00Z')), '2027-01')
})

test('kstMonthKey와 kstMonthRange는 서로 맞물린다', () => {
  const { startMs, endMs } = kstMonthRange('2027-02')
  assert.equal(kstMonthKey(new Date(startMs)), '2027-02')
  assert.equal(kstMonthKey(new Date(endMs - 1)), '2027-02')
  assert.equal(kstMonthKey(new Date(endMs)), '2027-03')
})

test('형식이 틀린 월 키는 던진다', () => {
  for (const bad of ['2026-13', '2026-00', '2026-1', '202611', '', 'abcd-ef']) {
    assert.throws(() => kstMonthRange(bad), RangeError, bad)
  }
})
