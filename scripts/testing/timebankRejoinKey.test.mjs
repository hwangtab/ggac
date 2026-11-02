import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  rejoinKeysFor,
  rejoinSecretFromEnv,
  normalizeRejoinEmail,
  normalizeRejoinPhone,
} from '../../src/lib/timebank/rejoinKey.ts'

/**
 * 재가입 승계 키(스펙 §3 `timebank_withdrawn_keys`, §9.3). 비밀값은 테스트가
 * 직접 넘긴다 — 실제 `BETTER_AUTH_SECRET`에 기대지 않는다.
 */

const SECRET = 'test-secret-not-real-0123456789abcdef'

test('정규화: 이메일은 trim+lowercase, 전화는 숫자만, 비면 null', () => {
  assert.equal(normalizeRejoinEmail('  Foo.Bar@Example.COM '), 'foo.bar@example.com')
  assert.equal(normalizeRejoinEmail('   '), null)
  assert.equal(normalizeRejoinEmail(null), null)
  assert.equal(normalizeRejoinPhone('010-1234-5678'), '01012345678')
  assert.equal(normalizeRejoinPhone(' (010) 1234 5678 '), '01012345678')
  assert.equal(normalizeRejoinPhone('--- '), null)
  // 국가번호 표기는 국내 형식과 같은 값이 된다
  assert.equal(normalizeRejoinPhone('+82 10-1234-5678'), '01012345678')
  assert.equal(normalizeRejoinPhone('+82 010-1234-5678'), '01012345678')
  assert.equal(normalizeRejoinPhone('82-2-123-4567'), '021234567')
  // 82로 시작하는 짧은 국내 번호(지역번호 없이 적은 경우 등)는 건드리지 않는다
  assert.equal(normalizeRejoinPhone('8212345'), '8212345')
  assert.equal(normalizeRejoinPhone(null), null)
})

test('같은 이메일의 대소문자·공백 차이는 같은 키', () => {
  const a = rejoinKeysFor({ email: 'Member@Example.com', phone: null }, SECRET)
  const b = rejoinKeysFor({ email: '  member@example.COM  ', phone: null }, SECRET)
  assert.equal(a.length, 1)
  assert.deepEqual(a, b)
  assert.match(a[0], /^[0-9a-f]{64}$/)
})

test('전화 010-1234-5678과 01012345678은 같은 키', () => {
  const a = rejoinKeysFor({ email: null, phone: '010-1234-5678' }, SECRET)
  const b = rejoinKeysFor({ email: null, phone: '01012345678' }, SECRET)
  assert.equal(a.length, 1)
  assert.deepEqual(a, b)
})

test('이메일·전화는 각각 한 키이고 서로 다르다(접두사로 영역을 가른다)', () => {
  const keys = rejoinKeysFor({ email: 'a@b.c', phone: '01012345678' }, SECRET)
  assert.equal(keys.length, 2)
  assert.notEqual(keys[0], keys[1])
  const [emailKey] = rejoinKeysFor({ email: 'a@b.c', phone: null }, SECRET)
  const [phoneKey] = rejoinKeysFor({ email: null, phone: '010-1234-5678' }, SECRET)
  assert.deepEqual(keys, [emailKey, phoneKey])
})

test('secret이 다르면 다른 키', () => {
  const a = rejoinKeysFor({ email: 'a@b.c', phone: '01012345678' }, SECRET)
  const b = rejoinKeysFor({ email: 'a@b.c', phone: '01012345678' }, `${SECRET}x`)
  assert.notEqual(a[0], b[0])
  assert.notEqual(a[1], b[1])
})

test('이메일·전화가 모두 null(또는 빈 값)이면 빈 배열', () => {
  assert.deepEqual(rejoinKeysFor({ email: null, phone: null }, SECRET), [])
  assert.deepEqual(rejoinKeysFor({ email: '  ', phone: '-' }, SECRET), [])
})

test('원문이 키에 드러나지 않는다', () => {
  const keys = rejoinKeysFor({ email: 'leak@example.com', phone: '01099998888' }, SECRET)
  for (const k of keys) {
    assert.ok(!k.includes('leak'))
    assert.ok(!k.includes('01099998888'))
  }
})

test('빈 secret은 거부한다(키가 공개 함수가 되는 것을 막는다)', () => {
  assert.throws(() => rejoinKeysFor({ email: 'a@b.c', phone: null }, ''), /secret/i)
})

test('rejoinSecretFromEnv: BETTER_AUTH_SECRET을 읽고, 없으면 던진다', () => {
  const prev = process.env.BETTER_AUTH_SECRET
  try {
    process.env.BETTER_AUTH_SECRET = SECRET
    assert.equal(rejoinSecretFromEnv(), SECRET)
    delete process.env.BETTER_AUTH_SECRET
    assert.throws(() => rejoinSecretFromEnv(), /BETTER_AUTH_SECRET/)
    process.env.BETTER_AUTH_SECRET = '   '
    assert.throws(() => rejoinSecretFromEnv(), /BETTER_AUTH_SECRET/)
  } finally {
    if (prev === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = prev
  }
})
