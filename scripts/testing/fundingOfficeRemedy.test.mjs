import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 주석에서 말하는 것과 코드가 하는 것을 가른다. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 사무국 구제 수단의 **순수한 부분** — 되돌리기 표, 환불 가능 판정, 문안,
 * 그리고 "토스 호출을 트랜잭션이 감싸지 않는가"의 소스 확인.
 *
 * 여기서 못박는 것은 넷이다.
 * ① 평상시 이행 표는 그대로다 — 개설자는 여전히 `shipped`를 혼자 되돌릴 수
 *    없고, 사무국의 평상시 역행도 `preparing → none` 하나뿐이다. 되돌리기는
 *    **다른 문**(`allowedReversalSourcesFor`)이며, 그 문은 사무국 전용
 *    라우트만 연다.
 * ② 사무국이 환불할 수 있는 것과 없는 것의 경계.
 * ③ 사유 없는 환불·되돌리기는 통과하지 못한다.
 * ④ 돈을 옮기는 파일에서 **DB 트랜잭션이 네트워크 왕복을 감싸지 않는다.**
 */

const f = await import('../../src/lib/funding/fulfillment.ts')
const r = await import('../../src/lib/funding/officeRefund.ts')
const n = await import('../../src/lib/funding/notifyOfficeRemedy.ts')

// ------------------------------------------------------------ ① 평상시 표는 그대로

test('평상시 이행 표는 건드리지 않았다 — 개설자는 발송을 되돌릴 수 없다', () => {
  assert.deepEqual(f.allowedSourcesFor('none', false), [])
  assert.deepEqual(f.allowedSourcesFor('none', true), ['preparing'])
  assert.equal(f.canTransitionFulfillment('shipped', 'none', false), false)
  assert.equal(f.canTransitionFulfillment('shipped', 'none', true), false)
  assert.equal(f.canTransitionFulfillment('delivered', 'preparing', true), false)
})

test('되돌리기 표는 별도이고 역행만 담는다', () => {
  assert.deepEqual(f.allowedReversalSourcesFor('none'), ['preparing', 'shipped', 'delivered'])
  assert.deepEqual(f.allowedReversalSourcesFor('preparing'), ['shipped', 'delivered'])
  assert.deepEqual(f.allowedReversalSourcesFor('shipped'), ['delivered'])
  // 전진은 이 문으로 들어오지 못한다 — 가장 뒤 상태로는 되돌릴 것이 없다.
  assert.deepEqual(f.allowedReversalSourcesFor('delivered'), [])
})

test('자동 취소가 다시 열리는 이동만 따로 센다', () => {
  // 원래 규칙이 막으려던 바로 그 이동이다.
  assert.equal(f.reopensSelfCancel('shipped', 'none'), true)
  assert.equal(f.reopensSelfCancel('delivered', 'none'), true)
  // `preparing`까지만 내리면 취소는 여전히 닫혀 있다.
  assert.equal(f.reopensSelfCancel('shipped', 'preparing'), false)
  assert.equal(f.reopensSelfCancel('preparing', 'none'), false)
})

test('앞서 발송 안내를 받은 사람만 정정을 받는다', () => {
  assert.equal(f.crossesSentBoundaryBackward('shipped', 'none'), true)
  assert.equal(f.crossesSentBoundaryBackward('delivered', 'preparing'), true)
  assert.equal(f.crossesSentBoundaryBackward('delivered', 'shipped'), false)
  assert.equal(f.crossesSentBoundaryBackward('preparing', 'none'), false)
})

test('무슨 일이었는지는 두 갈래뿐이고 문자열을 아무거나 받지 않는다', () => {
  assert.equal(f.isFulfillmentReversalKind('wrong_row'), true)
  assert.equal(f.isFulfillmentReversalKind('not_shipped'), true)
  assert.equal(f.isFulfillmentReversalKind('etc'), false)
  assert.equal(f.isFulfillmentReversalKind(null), false)
  for (const k of f.FULFILLMENT_REVERSAL_KINDS) {
    assert.equal(typeof f.FULFILLMENT_REVERSAL_KIND_LABEL[k], 'string')
  }
})

// ------------------------------------------------------------ ② 쓸어버린 표시

test('한 번에 거의 전부를 올린 표시에만 표가 붙는다', () => {
  assert.equal(f.isSweepingMark(40, 40), true)
  assert.equal(f.isSweepingMark(40, 50), true)
  assert.equal(f.isSweepingMark(30, 50), false)
  // 몇 건짜리 캠페인은 모양이랄 것이 없다 — 표를 달면 전부 노란불이 된다.
  assert.equal(f.isSweepingMark(3, 3), false)
  assert.equal(f.isSweepingMark(0, 0), false)
  assert.equal(f.isSweepingMark('x', 10), false)
})

// ------------------------------------------------------------ ③ 환불 경계

const payment = { id: 'pay1', payment_key: 'pk', order_id: 'o1', amount: 30_000 }

test('사무국은 발송 완료된 후원도, 마감·정산된 캠페인의 후원도 환불할 수 있다', () => {
  // 후원자 본인은 이 셋 중 어느 것도 못 한다 — 그것이 이 기능의 요점이다.
  for (const fulfillment of ['none', 'preparing', 'shipped', 'delivered']) {
    const plan = r.planOfficeRefund(
      { status: 'paid', payment_id: 'pay1', total_amount: 30_000, fulfillment_status: fulfillment },
      payment
    )
    assert.equal(plan.ok, true, fulfillment)
    assert.equal(plan.amount, 30_000)
    assert.equal(plan.retry, false)
  }
})

test('돈이 잡힌 적 없는 후원은 막힌다 — 환불할 금액이 없다', () => {
  for (const status of ['pending', 'expired']) {
    const plan = r.planOfficeRefund({ status, payment_id: null }, null)
    assert.equal(plan.ok, false, status)
    assert.equal(plan.reason, 'not_captured')
  }
  // 결제 연결이 없는 canceled는 결제 한 번 없이 만료된 선점이다.
  const noPay = r.planOfficeRefund({ status: 'canceled', payment_id: null }, null)
  assert.equal(noPay.ok, false)
  assert.equal(noPay.reason, 'not_captured')
})

test('이미 환불된 후원은 다시 환불하지 않는다', () => {
  const plan = r.planOfficeRefund({ status: 'refunded', payment_id: 'pay1' }, payment)
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'already_refunded')
})

test('선점까지 마치고 판단 불가로 끝난 건은 재시도로 이어진다', () => {
  const plan = r.planOfficeRefund(
    { status: 'canceled', payment_id: 'pay1', total_amount: 30_000 },
    payment
  )
  assert.equal(plan.ok, true)
  assert.equal(plan.retry, true)
})

test('결제 금액이 후원 금액보다 적으면 토스를 부르기 전에 막는다', () => {
  // 나간 뒤에 원장이 거부하면 돈만 나가고 기록이 남지 않는다.
  const plan = r.planOfficeRefund(
    { status: 'paid', payment_id: 'pay1', total_amount: 50_000 },
    payment
  )
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'amount_mismatch')
})

test('결제 키가 없으면 토스에 요청할 것이 없다', () => {
  const plan = r.planOfficeRefund(
    { status: 'paid', payment_id: 'pay1', total_amount: 30_000 },
    { id: 'pay1', payment_key: null, order_id: 'o1', amount: 30_000 }
  )
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'no_payment')
})

test('사유가 짧으면 환불도 되돌리기도 통과하지 못한다', () => {
  assert.equal(r.normalizeOfficeRefundReason('실수'), null)
  assert.equal(r.normalizeOfficeRefundReason('   '), null)
  assert.equal(r.normalizeOfficeRefundReason(null), null)
  const ok = r.normalizeOfficeRefundReason('  후원자 요청으로 전액 환불합니다.  ')
  assert.equal(ok, '후원자 요청으로 전액 환불합니다.')
  assert.ok(r.OFFICE_REFUND_REASON_MIN >= 10)
  assert.ok(f.FULFILLMENT_REVERSAL_REASON_MIN >= 10)
  // 아무리 길게 적어도 기록에 들어가는 길이는 잘린다.
  assert.equal(r.normalizeOfficeRefundReason('가'.repeat(900)).length, r.OFFICE_REFUND_REASON_MAX)
})

test('지급이 끝난 정산서가 있으면 한 번 더 확인받는다', () => {
  assert.equal(r.officeRefundNeedsSettledAck(null), false)
  assert.equal(r.officeRefundNeedsSettledAck({ status: 'pending' }), false)
  assert.equal(r.officeRefundNeedsSettledAck({ status: 'paid' }), true)
})

// ------------------------------------------------------------ ④ 문안

test('사무국 환불 문안은 "승인하는 사이에"라고 말하지 않는다', () => {
  // 기존 환불 문안은 승인 직후 자동 환불용이다. 며칠 뒤 손으로 돌려준 건에
  // 그 문장을 붙이면 사실과 다른 안내가 나간다.
  const notice = n.buildOfficeRefundedNotice(
    { total_amount: 30_000, user_id: 'u1', pledge_code: 'FND-1', campaign_id: 'c1' },
    { title: '첫 정규 앨범' },
    'https://ggac.kr'
  )
  assert.ok(!notice.message.includes('승인하는 사이에'))
  assert.ok(notice.message.includes('30,000원'))
  assert.ok(notice.message.includes('첫 정규 앨범'))
  assert.equal(notice.data.refunded_by, 'office')
  // 사무국이 적은 사유는 후원자에게 가지 않는다 — 내부 기록이다.
  assert.ok(!notice.message.includes('사유'))
})

test('비회원에게는 후원번호를 함께 준다 — 조회 화면이 그 번호로 열린다', () => {
  const guest = n.buildOfficeRefundedNotice(
    { total_amount: 10_000, user_id: null, pledge_code: 'FND-9' },
    null,
    'https://ggac.kr'
  )
  assert.ok(guest.message.includes('FND-9'))
  assert.ok(guest.url.endsWith('/funding/manage'))
})

test('되돌리기 정정 문안은 직접 취소가 열렸는지에 따라 갈린다', () => {
  const reopened = n.buildFulfillmentReversedNotice(
    { user_id: 'u1', pledge_code: 'FND-2' },
    { title: '첫 정규 앨범' },
    'https://ggac.kr',
    true
  )
  assert.ok(reopened.message.includes('직접 전액 취소'))
  const kept = n.buildFulfillmentReversedNotice(
    { user_id: 'u1', pledge_code: 'FND-2' },
    { title: '첫 정규 앨범' },
    'https://ggac.kr',
    false
  )
  assert.ok(!kept.message.includes('직접 전액 취소'))
  // 앞의 안내를 정정한다는 것이 제목에서 분명해야 한다.
  assert.ok(reopened.title.includes('정정'))
})

// ------------------------------------------------------------ ⑤ 트랜잭션과 토스

test('환불 실행 파일과 라우트는 DB 트랜잭션으로 토스 호출을 감싸지 않는다', () => {
  // 트랜잭션이 네트워크 왕복을 붙들면 libSQL 쓰기 잠금이 최대 60초 동안
  // 잡혀 있게 되고(토스 타임아웃), 그동안 이 캠페인의 다른 쓰기가 전부
  // 막힌다. 이 저장소가 지키기로 한 성질이라 소스에서 직접 확인한다.
  for (const file of [
    'src/lib/server/officeRefund.ts',
    'src/app/api/admin/funding/pledges/[id]/refund/route.ts',
  ]) {
    const code = stripComments(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf-8'))
    assert.ok(!/\.transaction\s*\(/.test(code), `${file}에 트랜잭션 호출이 생겼습니다`)
    // DB 커넥션을 직접 잡으면 이 파일에서 트랜잭션을 여는 것도 한 줄이 된다.
    // 원장 쓰기는 전부 쿼리 계층을 거쳐야 한다.
    assert.ok(!/db\/client/.test(code), `${file}이 DB 커넥션을 직접 잡습니다`)
  }
})

test('환불 실행은 후원자 취소와 같은 함수를 쓴다 — 환불기를 두 벌 만들지 않는다', () => {
  const src = readFileSync(
    new URL('../../src/lib/server/officeRefund.ts', import.meta.url),
    'utf-8'
  )
  for (const fn of [
    'claimPledgeForCancel',
    'revertPledgeCancel',
    'finalizePledgeRefund',
    'PartialRefundUnsupportedError',
  ]) {
    assert.ok(src.includes(fn), `${fn}을 쓰지 않습니다`)
  }
  // 선점에 이행 조건을 걸면 사무국도 발송 완료 건을 환불하지 못한다 —
  // 그것이 이 기능의 요점이므로 코드에 그 조건이 없어야 한다.
  assert.ok(!stripComments(src).includes('requireFulfillmentNone'))
})
