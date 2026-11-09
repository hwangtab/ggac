import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonObjectBody } from '../../src/utils/requestBody.ts'

const post = (body, headers = {}) =>
  new Request('http://localhost/x', { method: 'POST', body, headers })

test('작은 JSON 객체는 통과한다', async () => {
  assert.deepEqual(await parseJsonObjectBody(post('{"a":1}')), { a: 1 })
})

test('배열·깨진 JSON은 null', async () => {
  assert.equal(await parseJsonObjectBody(post('[1]')), null)
  assert.equal(await parseJsonObjectBody(post('{')), null)
})

test('기본 1MB 초과는 null', async () => {
  const big = JSON.stringify({ a: 'x'.repeat(1_100_000) })
  assert.equal(await parseJsonObjectBody(post(big)), null)
})

test('Content-Length 선언이 상한을 넘으면 읽지 않고 null', async () => {
  const req = post('{"a":1}', { 'content-length': '5000000' })
  assert.equal(await parseJsonObjectBody(req), null)
})

test('maxBytes 옵션으로 상한을 올릴 수 있다', async () => {
  const big = JSON.stringify({ a: 'x'.repeat(1_100_000) })
  const r = await parseJsonObjectBody(post(big), { maxBytes: 2_000_000 })
  assert.equal(r.a.length, 1_100_000)
})
