import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseAllowedRecipients, isAllowedRecipient } from '../../src/lib/mail/inboundRecipients.ts'

test('콤마로 나누고 공백을 털고 소문자로 만든다', () => {
  assert.deepEqual(parseAllowedRecipients(' Contact@GGAC.kr , info@ggac.kr '), [
    'contact@ggac.kr',
    'info@ggac.kr',
  ])
})

test('빈 값·undefined는 빈 배열이다', () => {
  assert.deepEqual(parseAllowedRecipients(undefined), [])
  assert.deepEqual(parseAllowedRecipients(''), [])
  assert.deepEqual(parseAllowedRecipients('  ,  ,'), [])
})

test('대소문자를 무시하고 일치시킨다', () => {
  assert.equal(isAllowedRecipient(['CONTACT@ggac.kr'], ['contact@ggac.kr']), true)
})

test('꺾쇠 표기와 표시 이름에서 주소를 뽑아낸다', () => {
  assert.equal(
    isAllowedRecipient(['경기아트콜렉티브 <contact@ggac.kr>'], ['contact@ggac.kr']),
    true
  )
})

test('목록에 없으면 거부한다', () => {
  assert.equal(isAllowedRecipient(['spam@ggac.kr'], ['contact@ggac.kr']), false)
})

test('여러 수신자 중 하나만 허용돼도 통과한다 — 참조로 걸린 정상 메일을 버리지 않는다', () => {
  assert.equal(
    isAllowedRecipient(['other@example.com', 'contact@ggac.kr'], ['contact@ggac.kr']),
    true
  )
})

test('허용 목록이 비면 전부 거부한다 — fail-closed', () => {
  assert.equal(isAllowedRecipient(['contact@ggac.kr'], []), false)
})

test('수신자 목록이 비면 거부한다', () => {
  assert.equal(isAllowedRecipient([], ['contact@ggac.kr']), false)
})

test('null이 섞여 있어도 예외를 던지지 않고, 정상 주소가 있으면 통과한다', () => {
  assert.equal(isAllowedRecipient([null, 'contact@ggac.kr'], ['contact@ggac.kr']), true)
})

test('null·undefined만 있으면 예외를 던지지 않고 거부한다 — fail-closed', () => {
  assert.equal(isAllowedRecipient([null, undefined], ['contact@ggac.kr']), false)
})
