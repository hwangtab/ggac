import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { verifySvixSignature } from '../../src/lib/mail/svixSignature.ts'

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const BODY = '{"type":"email.received","data":{"email_id":"abc"}}'
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek'

/** 구현과 독립적으로 서명을 만든다 — 헤더 조립·파싱 쪽 버그를 잡는 것이 목적이다. */
function sign(id, timestamp, body, secret = SECRET) {
  const key = Buffer.from(secret.split('_')[1], 'base64')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headersFor(timestampSec, signature) {
  return { id: ID, timestamp: String(timestampSec), signature: `v1,${signature}` }
}

test('유효한 서명을 통과시킨다', () => {
  const ts = 1788800000
  const r = verifySvixSignature(BODY, headersFor(ts, sign(ID, ts, BODY)), SECRET, ts * 1000)
  assert.equal(r.ok, true)
})

test('본문이 한 글자라도 바뀌면 거부한다', () => {
  const ts = 1788800000
  const sig = sign(ID, ts, BODY)
  const r = verifySvixSignature(BODY + ' ', headersFor(ts, sig), SECRET, ts * 1000)
  assert.equal(r.ok, false)
})

test('서명이 다른 시크릿으로 만들어졌으면 거부한다', () => {
  const ts = 1788800000
  const other = 'whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=='
  const r = verifySvixSignature(BODY, headersFor(ts, sign(ID, ts, BODY, other)), SECRET, ts * 1000)
  assert.equal(r.ok, false)
})

test('여러 서명 중 하나만 맞아도 통과시킨다', () => {
  const ts = 1788800000
  const good = sign(ID, ts, BODY)
  const headers = { id: ID, timestamp: String(ts), signature: `v1,bogus v1,${good}` }
  assert.equal(verifySvixSignature(BODY, headers, SECRET, ts * 1000).ok, true)
})

test('v1이 아닌 버전만 있으면 거부한다', () => {
  const ts = 1788800000
  const headers = { id: ID, timestamp: String(ts), signature: `v2,${sign(ID, ts, BODY)}` }
  assert.equal(verifySvixSignature(BODY, headers, SECRET, ts * 1000).ok, false)
})

test('5분보다 오래된 타임스탬프를 거부한다', () => {
  const ts = 1788800000
  const now = (ts + 301) * 1000
  const r = verifySvixSignature(BODY, headersFor(ts, sign(ID, ts, BODY)), SECRET, now)
  assert.equal(r.ok, false)
  assert.match(r.reason, /timestamp/)
})

test('5분보다 앞선 미래 타임스탬프도 거부한다', () => {
  const ts = 1788800000
  const now = (ts - 301) * 1000
  const r = verifySvixSignature(BODY, headersFor(ts, sign(ID, ts, BODY)), SECRET, now)
  assert.equal(r.ok, false)
  assert.match(r.reason, /timestamp/)
})

test('타임스탬프가 숫자가 아니면 거부한다', () => {
  const headers = { id: ID, timestamp: 'not-a-number', signature: 'v1,x' }
  assert.equal(verifySvixSignature(BODY, headers, SECRET, Date.now()).ok, false)
})

test('헤더가 하나라도 없으면 거부한다', () => {
  const ts = 1788800000
  const sig = sign(ID, ts, BODY)
  const now = ts * 1000
  assert.equal(
    verifySvixSignature(
      BODY,
      { id: null, timestamp: String(ts), signature: `v1,${sig}` },
      SECRET,
      now
    ).ok,
    false
  )
  assert.equal(
    verifySvixSignature(BODY, { id: ID, timestamp: null, signature: `v1,${sig}` }, SECRET, now).ok,
    false
  )
  assert.equal(
    verifySvixSignature(BODY, { id: ID, timestamp: String(ts), signature: null }, SECRET, now).ok,
    false
  )
})

test('시크릿이 비어 있으면 거부한다 — fail-closed', () => {
  const ts = 1788800000
  const r = verifySvixSignature(BODY, headersFor(ts, sign(ID, ts, BODY)), '', ts * 1000)
  assert.equal(r.ok, false)
})

test('whsec_ 접두어가 없는 시크릿도 그대로 base64로 본다', () => {
  const bare = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  const ts = 1788800000
  const key = Buffer.from(bare, 'base64')
  const sig = createHmac('sha256', key).update(`${ID}.${ts}.${BODY}`).digest('base64')
  const r = verifySvixSignature(BODY, headersFor(ts, sig), bare, ts * 1000)
  assert.equal(r.ok, true)
})
