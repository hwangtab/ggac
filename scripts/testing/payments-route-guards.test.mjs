import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 결제 라우트의 구조를 고정한다.
 *
 * 여기 있는 규칙은 전부 **한 줄만 고쳐도 돈이 새는** 종류다. 동작 테스트로
 * 잡으려면 요청 스코프와 토스 서버가 필요해서 아무도 테스트하지 않게 되므로,
 * 소스를 읽어 구조로 고정한다(`scripts/testing/middleware-profile.test.mjs`와
 * 같은 패턴).
 */

const CONFIRM = readFileSync('src/app/api/payments/dues/confirm/route.ts', 'utf8')
const PREPARE = readFileSync('src/app/api/payments/dues/prepare/route.ts', 'utf8')

test('승인 라우트가 금액을 대조한다', () => {
  assert.match(CONFIRM, /assertAmountMatches/)
})

test('승인 라우트가 토스에 넘기는 금액은 원장에 저장된 값이다', () => {
  // 수신값(body.amount)을 그대로 넘기면 결제창 주소를 고쳐 1,000원에 결제하는
  // 조작이 통한다. 대조를 통과했더라도 넘기는 값은 저장값이어야 한다.
  assert.match(CONFIRM, /confirmPayment\(\s*\{[^}]*amount:\s*storedAmount/s)
  assert.doesNotMatch(CONFIRM, /confirmPayment\(\s*\{[^}]*amount:\s*body\.amount/s)
})

test('승인 라우트가 주문 소유자를 확인한다', () => {
  // 남의 주문번호로 승인을 시도하는 경로를 막는다.
  assert.match(CONFIRM, /payment\.user_id !== user\.id/)
})

test('판단 불가 오류를 결제 실패로 기록하지 않는다', () => {
  // TossLookupError는 "승인됐는지 모른다"는 뜻이다. 여기서 실패로 확정하면
  // 실제로 승인된 결제가 미결제로 남고, 회원은 돈만 나간 채 미납이 된다.
  const lookupBlock = CONFIRM.match(/error instanceof TossLookupError\)\s*\{([\s\S]*?)\n    \}/)
  assert.ok(lookupBlock, 'TossLookupError 분기를 찾지 못했다')
  assert.doesNotMatch(lookupBlock[1], /markPaymentFailed/)
})

test('명확한 거절만 결제 실패로 기록한다', () => {
  const apiErrorBlock = CONFIRM.match(/error instanceof TossApiError\)\s*\{([\s\S]*?)\n    \}/)
  assert.ok(apiErrorBlock, 'TossApiError 분기를 찾지 못했다')
  assert.match(apiErrorBlock[1], /markPaymentFailed/)
})

test('준비 라우트가 금액을 클라이언트에서 받지 않는다', () => {
  // 금액은 회원의 회비 설정에서 서버가 정한다. 요청 본문을 읽는 순간
  // "얼마를 낼지 클라이언트가 정하는" 구조가 된다.
  assert.doesNotMatch(PREPARE, /parseJsonObjectBody|request\.json\(\)/)
})

test('준비 라우트가 결제창보다 먼저 원장을 남긴다', () => {
  // createPendingPayment 없이 주문번호만 내려보내면, 승인은 됐는데 우리
  // 원장에는 없는 건이 생긴다.
  assert.match(PREPARE, /createPendingPayment/)
})

test('두 라우트 모두 시크릿 키를 응답에 싣지 않는다', () => {
  for (const [name, source] of [
    ['confirm', CONFIRM],
    ['prepare', PREPARE],
  ]) {
    assert.doesNotMatch(
      source,
      /ApiSuccess[\s\S]{0,400}secretKey/,
      `${name}이 시크릿 키를 응답에 실었다`
    )
  }
})

test('두 라우트 모두 결제 킬스위치를 확인한다', () => {
  assert.match(CONFIRM, /isPaymentEnabled/)
  assert.match(PREPARE, /isPaymentEnabled/)
})

test('두 라우트 모두 승인된 활성 조합원만 통과시킨다', () => {
  assert.match(CONFIRM, /requireActiveMember/)
  assert.match(PREPARE, /requireActiveMember/)
})
