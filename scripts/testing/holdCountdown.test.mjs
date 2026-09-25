import { test } from 'node:test'
import assert from 'node:assert/strict'

import { minutesUntil } from '../../src/lib/funding/holdCountdown.ts'

const NOW = new Date('2026-09-26T12:00:00.000Z')

test('정확히 10분 남았으면 10을 돌려준다', () => {
  assert.equal(minutesUntil('2026-09-26T12:10:00.000Z', NOW), 10)
})

test('9분 30초처럼 딱 안 떨어지면 올림한다', () => {
  assert.equal(minutesUntil('2026-09-26T12:09:30.000Z', NOW), 10)
})

test('이미 지난 시각이면 0이다', () => {
  assert.equal(minutesUntil('2026-09-26T11:59:00.000Z', NOW), 0)
})

test('지금 이 순간이면 0이다', () => {
  assert.equal(minutesUntil('2026-09-26T12:00:00.000Z', NOW), 0)
})

test('읽을 수 없는 값이면 0이다', () => {
  assert.equal(minutesUntil('not-a-date', NOW), 0)
})
