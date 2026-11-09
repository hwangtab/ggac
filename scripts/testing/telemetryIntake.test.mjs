import test from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

const {
  capReports,
  capSeverityAtMedium,
  maskIp,
  boundedString,
  readBoundedText,
  BodyTooLargeError,
} = await import('../../src/lib/server/telemetryIntake.ts')

test('capReports는 한 요청당 20건으로 자른다', () => {
  assert.equal(capReports(Array.from({ length: 100 }, (_, i) => i)).length, 20)
  assert.equal(capReports([1, 2]).length, 2)
})

test('capSeverityAtMedium은 high를 medium으로 낮춘다', () => {
  assert.equal(capSeverityAtMedium('high'), 'medium')
  assert.equal(capSeverityAtMedium('medium'), 'medium')
  assert.equal(capSeverityAtMedium('low'), 'low')
})

test('maskIp는 앞 두 옥텟만 남긴다', () => {
  assert.equal(maskIp('203.0.113.77, 10.0.0.1'), '203.0.*.*')
  assert.equal(maskIp('2001:db8:1:2::1'), '2001:db8:*')
  assert.equal(maskIp(null), 'unknown')
})

test('boundedString은 객체를 찍지 않고 길이를 자른다', () => {
  assert.equal(boundedString({ a: 1 }, 10), '[object]')
  assert.equal(boundedString('x'.repeat(100), 5), 'xxxxx')
  assert.equal(boundedString(undefined, 5), '')
})

test('readBoundedText는 큰 본문을 거절한다', async () => {
  const big = new Request('http://x/', { method: 'POST', body: 'a'.repeat(100) })
  await assert.rejects(readBoundedText(big, 50), BodyTooLargeError)
  const ok = new Request('http://x/', { method: 'POST', body: 'hi' })
  assert.equal(await readBoundedText(ok, 50), 'hi')
})
