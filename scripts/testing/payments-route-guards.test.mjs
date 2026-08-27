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

// ---------------------------------------------------------------- 자동결제

const BILLING = readFileSync('src/app/api/payments/billing/route.ts', 'utf8')
const CHARGE = readFileSync('src/app/api/internal/dues/charge/route.ts', 'utf8')
const DUES_GET = readFileSync('src/app/api/payments/dues/route.ts', 'utf8')

/**
 * `ApiSuccess.xxx(...)`에 실제로 넘기는 인자만 잘라 낸다.
 *
 * 단순 정규식으로 "ApiSuccess 근처에 billing_key가 있는가"를 보면, 응답과
 * 무관한 변수 사용(토스에 삭제 요청할 때 쓰는 값)까지 잡혀 오탐이 난다.
 * 괄호 균형을 맞춰 인자 범위를 정확히 끊는다.
 */
function apiSuccessPayloads(source) {
  const payloads = []
  const opener = /ApiSuccess\.\w+\(/g
  let match
  while ((match = opener.exec(source)) !== null) {
    const start = match.index + match[0].length
    let depth = 1
    let i = start
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
      i++
    }
    payloads.push(source.slice(start, i - 1))
  }
  return payloads
}

test('빌링키를 응답에 싣지 않는다', () => {
  // 빌링키와 구매자 식별값이 함께 유출되면 그 카드로 결제를 걸 수 있다.
  for (const [name, source] of [
    ['billing', BILLING],
    ['dues', DUES_GET],
  ]) {
    const payloads = apiSuccessPayloads(source)
    assert.ok(payloads.length > 0, `${name}에서 응답을 찾지 못했다`)
    for (const payload of payloads) {
      assert.doesNotMatch(payload, /billing_key|billingKey\b/, `${name}이 빌링키를 응답에 실었다`)
    }
  }
})

test('부정 대조: 응답에 빌링키를 넣으면 위 검사가 잡는다', () => {
  // 검사가 실제로 동작하는지 확인한다 — 통과만 하는 검사는 아무것도 증명하지 않는다.
  const bad = `return ApiSuccess.ok({ registered: true, billing_key: card.billing_key }).toNextResponse()`
  const payloads = apiSuccessPayloads(bad)
  assert.equal(payloads.length, 1)
  assert.match(payloads[0], /billing_key/)
})

test('카드 등록 시 구매자 식별값이 본인 것인지 확인한다', () => {
  // 남의 식별값으로 발급받은 빌링키를 자기 계정에 붙이는 경로를 막는다.
  assert.match(BILLING, /customerKey !== buildCustomerKey\(user\.id\)/)
})

test('해지는 우리 쪽을 먼저 내리고 토스 삭제는 실패해도 넘어간다', () => {
  // 순서를 뒤집으면 토스 장애 때 해지가 통째로 실패해 다음 달에 또 청구된다.
  const deleteFn = BILLING.slice(BILLING.indexOf('export async function DELETE'))
  const deactivateAt = deleteFn.indexOf('deactivateBillingKey')
  const tossDeleteAt = deleteFn.indexOf('deleteBillingKey(')
  assert.ok(deactivateAt > 0 && tossDeleteAt > 0, '두 호출을 찾지 못했다')
  assert.ok(deactivateAt < tossDeleteAt, '우리 쪽 해지가 먼저여야 한다')
  assert.match(deleteFn, /catch[\s\S]{0,300}빌링키 삭제 실패/)
})

test('자동 청구 크론은 토큰을 타이밍 안전 비교로 검증한다', () => {
  assert.match(CHARGE, /timingSafeEqual/)
  assert.match(CHARGE, /PAYMENTS_CRON_TOKEN/)
})

test('자동 청구 크론은 판단 로직을 직접 들고 있지 않다', () => {
  // 이중 청구 조건은 테스트 가능한 순수 함수(billingRun)에만 있어야 한다.
  assert.match(CHARGE, /runBillingCharges/)
  assert.doesNotMatch(CHARGE, /status === 'paid'/)
})

test('자동결제 키가 없으면 관련 라우트가 열리지 않는다', () => {
  assert.match(BILLING, /isBillingEnabled/)
  assert.match(CHARGE, /isBillingEnabled/)
})
