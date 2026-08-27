import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAuthHeader,
  generateOrderId,
  assertAmountMatches,
  buildIdempotencyKey,
  buildCustomerKey,
  AmountMismatchError,
} from '../../src/lib/payments/toss/protocol.ts'

/**
 * 토스 프로토콜의 순수 규칙만 고정한다. 네트워크를 타지 않는다.
 *
 * 여기 있는 규칙을 어기면 조용히 실패하지 않고 **돈이 틀어진다**:
 * 인증 헤더에서 콜론이 빠지면 전 API가 401, 주문번호가 규격을 벗어나면
 * 결제창 자체가 안 뜨고, 금액 대조가 무너지면 결제창 URL을 고쳐 1,000원에
 * 결제하는 조작이 통한다.
 */

// ---------------------------------------------------------------- 인증 헤더

test('시크릿 키 뒤에 콜론을 붙여 base64로 인코딩한다', () => {
  // 토스 공식 문서(reference/using-api/authorization)의 curl 예제에 실린
  // 값을 그대로 고정값으로 쓴다 — 우리 인코딩이 문서와 한 글자라도 다르면
  // 여기서 잡힌다.
  assert.equal(
    buildAuthHeader('test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'),
    'Basic dGVzdF9nc2tfZG9jc19PYVB6OEw1S2RtUVhrelJ6M3k0N0JNdzY6'
  )
})

test('콜론을 빠뜨린 인코딩과 다르다', () => {
  // 문서가 "콜론을 빠트리지 않도록 주의하세요"라고 따로 경고하는 지점이다.
  const withColon = buildAuthHeader('test_sk_abc')
  const withoutColon = 'Basic ' + Buffer.from('test_sk_abc').toString('base64')
  assert.notEqual(withColon, withoutColon)
})

test('빈 시크릿 키는 거부한다', () => {
  assert.throws(() => buildAuthHeader(''), /시크릿 키/)
  assert.throws(() => buildAuthHeader(undefined), /시크릿 키/)
})

// ---------------------------------------------------------------- 주문번호

test('주문번호는 토스 규격(6~64자, 영문·숫자·-·_)을 지킨다', () => {
  for (let i = 0; i < 50; i++) {
    const id = generateOrderId('dues')
    assert.match(id, /^[A-Za-z0-9_-]{6,64}$/, `규격 위반: ${id}`)
  }
})

test('주문번호는 매번 다르다', () => {
  const ids = new Set()
  for (let i = 0; i < 200; i++) ids.add(generateOrderId('dues'))
  assert.equal(ids.size, 200)
})

test('주문번호에 용도 접두사가 남아 나중에 눈으로 구분된다', () => {
  assert.ok(generateOrderId('dues').startsWith('dues_'))
  assert.ok(generateOrderId('ticket').startsWith('ticket_'))
})

// ---------------------------------------------------------------- 금액 대조

test('저장 금액과 돌아온 금액이 같으면 통과한다', () => {
  assert.doesNotThrow(() => assertAmountMatches(30000, 30000))
})

test('금액이 다르면 거부한다', () => {
  assert.throws(() => assertAmountMatches(30000, 1000), AmountMismatchError)
})

test('문자열로 돌아온 금액도 숫자로 비교한다', () => {
  // successUrl 쿼리 파라미터는 항상 문자열로 도착한다. 문자열 '30000'과
  // 숫자 30000을 다르다고 판정하면 정상 결제가 전부 막힌다.
  assert.doesNotThrow(() => assertAmountMatches(30000, '30000'))
})

test('숫자가 아닌 금액은 거부한다', () => {
  assert.throws(() => assertAmountMatches(30000, 'abc'), AmountMismatchError)
  assert.throws(() => assertAmountMatches(30000, ''), AmountMismatchError)
  assert.throws(() => assertAmountMatches(30000, null), AmountMismatchError)
})

test('소수점이 섞인 금액은 거부한다', () => {
  // 원화는 정수다. 30000.4가 통과하면 반올림 위치에 따라 원장이 어긋난다.
  assert.throws(() => assertAmountMatches(30000, '30000.4'), AmountMismatchError)
})

test('거부 사유에 기대값과 실제값이 함께 남는다', () => {
  // 조작 시도를 사후에 추적하려면 두 값이 모두 로그에 있어야 한다.
  try {
    assertAmountMatches(30000, 1000)
    assert.fail('던졌어야 한다')
  } catch (error) {
    assert.ok(error instanceof AmountMismatchError)
    assert.equal(error.expected, 30000)
    assert.equal(error.received, 1000)
  }
})

// ---------------------------------------------------------------- 멱등키

test('같은 주문·같은 작업이면 멱등키가 같다', () => {
  // 재시도할 때 키가 바뀌면 멱등성이 깨져 이중 결제가 난다.
  assert.equal(
    buildIdempotencyKey('dues_abc123', 'confirm'),
    buildIdempotencyKey('dues_abc123', 'confirm')
  )
})

test('작업이 다르면 멱등키가 다르다', () => {
  // 승인과 취소가 같은 키를 쓰면 취소 요청이 승인 응답을 되돌려받는다.
  assert.notEqual(
    buildIdempotencyKey('dues_abc123', 'confirm'),
    buildIdempotencyKey('dues_abc123', 'cancel')
  )
})

test('주문이 다르면 멱등키가 다르다', () => {
  assert.notEqual(
    buildIdempotencyKey('dues_abc123', 'confirm'),
    buildIdempotencyKey('dues_xyz789', 'confirm')
  )
})

test('멱등키는 토스 제한(300자)을 넘지 않는다', () => {
  const key = buildIdempotencyKey('d'.repeat(64), 'confirm')
  assert.ok(key.length <= 300, `${key.length}자`)
  assert.ok(key.length > 0)
})

// ---------------------------------------------------------------- 구매자 식별값

test('구매자 식별값은 토스 규격(2~50자, 허용 문자)을 지킨다', () => {
  const key = buildCustomerKey('852b09d6-5bb8-48fa-b529-96c0a1141173')
  assert.match(key, /^[A-Za-z0-9\-_=.@]{2,50}$/, key)
})

test('구매자 식별값에 특수문자가 최소 하나 들어간다', () => {
  // 토스 문서가 "특수문자 -, _, =, ., @ 중 최소 1개를 포함"이라고 적고 있다.
  assert.match(buildCustomerKey('852b09d6-5bb8-48fa-b529-96c0a1141173'), /[\-_=.@]/)
})

test('같은 회원이면 항상 같은 식별값이다', () => {
  // 빌링키는 이 값과 짝이 맞아야 결제된다. 회원마다 안정적이어야 한다.
  assert.equal(buildCustomerKey('user-a'), buildCustomerKey('user-a'))
})

test('회원이 다르면 식별값이 다르다', () => {
  assert.notEqual(buildCustomerKey('user-a'), buildCustomerKey('user-b'))
})

test('식별값에 회원 id가 그대로 드러나지 않는다', () => {
  // 유추 가능한 값을 쓰지 말라는 토스 경고를 지킨다. 빌링키가 유출돼도
  // 이 값을 모르면 결제가 되지 않으므로, 회원 id를 그대로 노출하면 안 된다.
  const userId = '852b09d6-5bb8-48fa-b529-96c0a1141173'
  assert.equal(buildCustomerKey(userId).includes(userId), false)
  assert.equal(buildCustomerKey(userId).includes('852b09d6'), false)
})
