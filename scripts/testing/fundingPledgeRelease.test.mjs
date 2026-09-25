import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 결제 단계의 "돌아가기" — 아직 결제가 붙지 않은 자기 선점을 놓아 주는 판정.
 *
 * 여기서 못박는 것:
 *   - 주문번호가 맞아야 한다(브라우저가 들고 있는 값)
 *   - 회원 선점은 세션이 그 회원일 때만
 *   - `pending`이 아니면 409, 결제가 붙어 있으면 409
 *   - 없는 것과 남의 것을 구분하지 않는다(둘 다 404, 같은 문장)
 *   - 상한 셈이 `pending`만 세므로 놓아 준 선점은 자리를 되돌려 준다
 */

const { planPledgeRelease, PLEDGE_RELEASE_IN_FLIGHT_MESSAGE } = await import(
  '../../src/lib/funding/pledgeRelease.ts'
)

function hold(o = {}) {
  return { id: 'p1', order_id: 'ord1', user_id: null, status: 'pending', payment_id: null, ...o }
}

test('비회원 선점은 주문번호가 맞으면 놓아 준다', () => {
  assert.deepEqual(planPledgeRelease(hold(), { userId: null, orderId: 'ord1' }), { ok: true })
})

test('회원 선점은 세션이 그 회원일 때만', () => {
  const p = hold({ user_id: 'u1' })
  assert.equal(planPledgeRelease(p, { userId: 'u1', orderId: 'ord1' }).ok, true)
  const other = planPledgeRelease(p, { userId: 'u2', orderId: 'ord1' })
  assert.equal(other.ok, false)
  assert.equal(other.status, 404)
})

test('주문번호가 다르면 지나가지 못한다', () => {
  const r = planPledgeRelease(hold(), { userId: null, orderId: 'ord2' })
  assert.equal(r.ok, false)
  assert.equal(r.status, 404)
})

test('없는 것과 남의 것은 같은 문장으로 답한다 — 존재 여부가 새지 않는다', () => {
  const missing = planPledgeRelease(null, { userId: null, orderId: 'ord1' })
  const others = planPledgeRelease(hold({ user_id: 'u1' }), { userId: null, orderId: 'ord1' })
  assert.equal(missing.ok, false)
  assert.equal(others.ok, false)
  assert.equal(missing.message, others.message)
})

test('pending이 아니면 409이고 결제된 건은 다른 문으로 안내한다', () => {
  const paid = planPledgeRelease(hold({ status: 'paid' }), { userId: null, orderId: 'ord1' })
  assert.equal(paid.status, 409)
  assert.match(paid.message, /후원 내역 화면/)
  const canceled = planPledgeRelease(hold({ status: 'canceled' }), {
    userId: null,
    orderId: 'ord1',
  })
  assert.equal(canceled.status, 409)
})

test('결제가 붙은 pending은 놓아 주지 않는다 — 돈이 나간 채 후원만 사라진다', () => {
  const r = planPledgeRelease(hold({ payment_id: 'pay1' }), { userId: null, orderId: 'ord1' })
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
})

/**
 * 진짜 표식은 결제 행의 `payment_key`다. 후원 행의 `payment_id`는 확정이
 * 끝나는 그 UPDATE에서야 채워지므로 `pending`에서는 언제나 비어 있다 — 그것만
 * 보는 검사는 아무것도 막지 못한다.
 */
test('승인 요청이 나간 뒤(payment_key)면 놓아 주지 않는다', () => {
  const r = planPledgeRelease(
    hold(),
    { userId: null, orderId: 'ord1' },
    { order_id: 'ord1', payment_key: 'tviva1234', status: 'pending' }
  )
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
  assert.equal(r.message, PLEDGE_RELEASE_IN_FLIGHT_MESSAGE)
})

test('결제 행이 있어도 payment_key가 비어 있으면 놓아 준다 — 결제창을 열기만 한 상태', () => {
  assert.deepEqual(
    planPledgeRelease(
      hold(),
      { userId: null, orderId: 'ord1' },
      { order_id: 'ord1', payment_key: null, status: 'pending' }
    ),
    { ok: true }
  )
  assert.deepEqual(
    planPledgeRelease(
      hold(),
      { userId: null, orderId: 'ord1' },
      { order_id: 'ord1', payment_key: '', status: 'pending' }
    ),
    { ok: true }
  )
})

test('결제 행이 아예 없어도(아직 만들어지기 전) 놓아 준다', () => {
  assert.deepEqual(planPledgeRelease(hold(), { userId: null, orderId: 'ord1' }, null), { ok: true })
})

/**
 * 표식이 서 있어도 **남의 건**이면 존재 여부를 알려 주지 않는다 — 임자 검사가
 * 먼저다.
 */
test('남의 선점은 결제가 진행 중이어도 404다', () => {
  const r = planPledgeRelease(
    hold({ user_id: 'u1' }),
    { userId: 'u2', orderId: 'ord1' },
    { order_id: 'ord1', payment_key: 'tviva1234' }
  )
  assert.equal(r.status, 404)
})

/**
 * 판정과 취소가 한 트랜잭션 안에 있어야 한다 — 라우트가 결제 행을 읽고 나서
 * UPDATE를 보내는 사이에 확정 라우트가 `recordPaymentKey`를 새길 수 있다.
 * 그래서 취소 쿼리도 같은 조건을 스스로 본다.
 */
test('돌아가기 취소 쿼리가 결제 표식을 스스로 확인한다', () => {
  const src = readFileSync(
    new URL('../../src/db/queries/fundingPledges.ts', import.meta.url),
    'utf8'
  )
  const fn = src.slice(src.indexOf('async function cancelPendingPledgeForReleaseOnce'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.match(body, /db\.transaction/)
  assert.match(body, /payments\.paymentKey/)
  assert.match(body, /in_flight/)
  // 뒷정리용 취소(`cancelPendingPledgeOnce`)에는 이 조건이 없어야 한다 —
  // 그쪽은 승인이 끝난 뒤에 불리므로 표식이 당연히 서 있다.
  const plain = src.slice(src.indexOf('async function cancelPendingPledgeOnce'))
  assert.equal(plain.slice(0, plain.indexOf('\n}\n')).includes('paymentKey'), false)
})

test('상한 셈은 pending만 센다 — 놓아 준 선점이 자리를 되돌려 준다', () => {
  const src = readFileSync(
    new URL('../../src/db/queries/fundingPledges.ts', import.meta.url),
    'utf8'
  )
  const own = src.slice(src.indexOf('function ownHoldCondition'))
  const body = own.slice(0, own.indexOf('\n}\n'))
  // 회원·비회원 두 갈래 모두 `status = 'pending'` 조건을 달고 있다.
  assert.equal(body.match(/eq\(fundingPledges\.status, 'pending'\)/g)?.length, 2)
})
