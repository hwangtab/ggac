import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  keyEnvironment,
  assertKeyPairConsistent,
  KeyMismatchError,
  currentBillingMonth,
  assertDuesAmount,
  DUES_MIN,
  DUES_MAX,
} from '../../src/lib/payments/toss/config.ts'

/**
 * 키 짝 검증과 청구월 계산. 둘 다 순수 함수라 환경 없이 검증한다.
 *
 * 키가 어긋나면(공개 키는 테스트인데 시크릿은 운영) 결제창은 뜨는데 승인이
 * 통째로 실패한다. 원인이 화면에 드러나지 않아 찾는 데 오래 걸리는 종류의
 * 사고라, 부팅 시점에 걸러야 한다.
 */

// ---------------------------------------------------------------- 키 환경 판정

test('키 접두사로 테스트·운영을 가른다', () => {
  assert.equal(keyEnvironment('test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm'), 'test')
  assert.equal(keyEnvironment('test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'), 'test')
  assert.equal(keyEnvironment('live_gck_abcdef'), 'live')
  assert.equal(keyEnvironment('live_sk_abcdef'), 'live')
})

test('알 수 없는 모양의 키는 판정하지 않는다', () => {
  assert.equal(keyEnvironment('sk_abcdef'), null)
  assert.equal(keyEnvironment(''), null)
  assert.equal(keyEnvironment(undefined), null)
})

test('같은 환경의 키 짝은 통과한다', () => {
  assert.doesNotThrow(() => assertKeyPairConsistent('test_gck_a', 'test_gsk_b'))
  assert.doesNotThrow(() => assertKeyPairConsistent('live_ck_a', 'live_sk_b'))
})

test('테스트 공개 키와 운영 시크릿 키가 섞이면 거부한다', () => {
  // 이 조합은 결제창이 뜬 뒤 승인 단계에서만 실패한다 — 사용자는 결제한 줄 안다.
  assert.throws(() => assertKeyPairConsistent('test_gck_a', 'live_gsk_b'), KeyMismatchError)
  assert.throws(() => assertKeyPairConsistent('live_ck_a', 'test_sk_b'), KeyMismatchError)
})

test('키가 비어 있으면 거부한다', () => {
  assert.throws(() => assertKeyPairConsistent('', 'test_gsk_b'), KeyMismatchError)
  assert.throws(() => assertKeyPairConsistent('test_gck_a', ''), KeyMismatchError)
})

// ---------------------------------------------------------------- 청구월

test('청구월은 KST 기준 YYYY-MM이다', () => {
  assert.equal(currentBillingMonth(new Date('2026-09-15T03:00:00Z')), '2026-09')
})

test('월말 자정 근처에서 한국 날짜를 따른다', () => {
  // UTC 8월 31일 16:00 = KST 9월 1일 01:00. UTC로 계산하면 8월분이 돼
  // 9월 첫날 새벽에 도는 크론이 지난달을 다시 청구한다.
  assert.equal(currentBillingMonth(new Date('2026-08-31T16:00:00Z')), '2026-09')
})

test('월초 자정 직전은 아직 전달이다', () => {
  // UTC 8월 31일 14:59 = KST 8월 31일 23:59.
  assert.equal(currentBillingMonth(new Date('2026-08-31T14:59:00Z')), '2026-08')
})

test('연말을 넘어간다', () => {
  assert.equal(currentBillingMonth(new Date('2026-12-31T16:00:00Z')), '2027-01')
})

// ---------------------------------------------------------------- 회비 금액

test('허용 범위 안의 회비는 통과한다', () => {
  assert.doesNotThrow(() => assertDuesAmount(DUES_MIN))
  assert.doesNotThrow(() => assertDuesAmount(30000))
  assert.doesNotThrow(() => assertDuesAmount(DUES_MAX))
})

test('범위를 벗어난 회비는 거부한다', () => {
  assert.throws(() => assertDuesAmount(DUES_MIN - 1), /회비/)
  assert.throws(() => assertDuesAmount(DUES_MAX + 1), /회비/)
  assert.throws(() => assertDuesAmount(0), /회비/)
  assert.throws(() => assertDuesAmount(-30000), /회비/)
})

test('정수가 아닌 회비는 거부한다', () => {
  assert.throws(() => assertDuesAmount(30000.5), /회비/)
  assert.throws(() => assertDuesAmount(NaN), /회비/)
  assert.throws(() => assertDuesAmount('30000'), /회비/)
  assert.throws(() => assertDuesAmount(null), /회비/)
})
