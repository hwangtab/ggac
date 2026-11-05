import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseSeoulDay, DAY_MS } from '../../src/lib/mail/seoulDay.ts'

test('날짜는 서울 기준 그날 0시다 — UTC로 읽으면 오전 9시 전 메일이 하루 어긋난다', () => {
  assert.equal(parseSeoulDay('2026-11-05')?.toISOString(), '2026-11-04T15:00:00.000Z')
})

test('없는 날짜는 거부한다 — Date가 다음 달로 넘겨 버리는 값', () => {
  assert.equal(parseSeoulDay('2026-02-29'), null)
  assert.equal(parseSeoulDay('2026-02-31'), null)
  assert.equal(parseSeoulDay('2026-13-01'), null)
  assert.ok(parseSeoulDay('2028-02-29'))
})

test('형식이 아니면 거부한다', () => {
  for (const value of [
    '',
    '2026-1-5',
    '26-01-05',
    '2026-01-05T00:00',
    '2026/01/05',
    ' 2026-01-05',
  ]) {
    assert.equal(parseSeoulDay(value), null, JSON.stringify(value))
  }
})

test('하루는 86,400,000ms다 — 서울은 서머타임이 없다', () => {
  assert.equal(DAY_MS, 86_400_000)
})
