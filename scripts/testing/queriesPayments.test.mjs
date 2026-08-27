import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/payments.ts`를 실제 SQLite 파일 DB로 검증한다
 * (`queriesProfiles.test.mjs`와 같은 패턴).
 *
 * 결제 원장은 **회계 기록**이다. 여기 불변식이 깨지면 화면이 잘못 보이는
 * 수준이 아니라 "이 사람이 몇 월분을 냈는가"에 답할 수 없게 된다:
 *
 * - 주문번호 유일성이 없으면 같은 번호로 두 건이 생겨 승인 응답이 어느 행에
 *   반영될지 알 수 없다.
 * - 확정이 멱등하지 않으면 웹훅과 승인 응답이 겹쳐 도착할 때 승인 시각이
 *   덮어써진다. 토스는 웹훅을 최대 7번까지 재전송한다.
 * - 회원당 청구월 유일성이 없으면 크론이 두 번 돌 때 같은 달이 두 번 청구된다.
 */

const DB_PATH = 'scripts/testing/.queries-payments-test.db'
const MODULE_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)

async function loadFresh() {
  return import(`${MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  // 결제 원장이 참조할 회원 한 명. FK가 살아 있는지도 함께 확인된다.
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, registration_status, is_active, created_at, updated_at)
          VALUES (?, ?, ?, 'approved', 1, ?, ?)`,
    args: ['m-001', '결제테스트', 'pay@test.local', Date.now(), Date.now()],
  })
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

function pendingInput(overrides = {}) {
  return {
    orderId: overrides.orderId ?? `dues_${Math.random().toString(36).slice(2, 12)}`,
    userId: overrides.userId ?? 'm-001',
    kind: overrides.kind ?? 'dues',
    orderName: overrides.orderName ?? '2026년 9월 조합비',
    amount: overrides.amount ?? 30000,
    payerName: overrides.payerName ?? '결제테스트',
    payerEmail: overrides.payerEmail ?? 'pay@test.local',
    ...overrides,
  }
}

// ---------------------------------------------------------------- 결제 준비

test('결제를 준비하면 대기 상태로 저장되고 주문번호로 조회된다', async () => {
  const { createPendingPayment, getPaymentByOrderId } = await loadFresh()
  const input = pendingInput({ orderId: 'dues_prepare01' })

  await createPendingPayment(input)
  const row = await getPaymentByOrderId('dues_prepare01')

  assert.ok(row)
  assert.equal(row.order_id, 'dues_prepare01')
  assert.equal(row.status, 'pending')
  assert.equal(row.amount, 30000)
  assert.equal(row.user_id, 'm-001')
  assert.equal(row.order_name, '2026년 9월 조합비')
  assert.equal(row.payment_key, null)
  assert.equal(row.approved_at, null)
  assert.equal(row.canceled_amount, 0)
})

test('없는 주문번호는 null을 돌려준다', async () => {
  const { getPaymentByOrderId } = await loadFresh()
  assert.equal(await getPaymentByOrderId('dues_nope'), null)
})

test('같은 주문번호로 두 번 준비할 수 없다', async () => {
  const { createPendingPayment } = await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_dup01' }))
  await assert.rejects(() => createPendingPayment(pendingInput({ orderId: 'dues_dup01' })))
})

test('결제자 이름과 이메일을 원장에 새겨 둔다', async () => {
  // 회원이 탈퇴해도 "누가 냈는가"가 원장에 남아야 세무 대응이 된다.
  const { createPendingPayment, getPaymentByOrderId } = await loadFresh()
  await createPendingPayment(
    pendingInput({ orderId: 'dues_payer01', payerName: '홍길동', payerEmail: 'hong@test.local' })
  )
  const row = await getPaymentByOrderId('dues_payer01')
  assert.equal(row.payer_name, '홍길동')
  assert.equal(row.payer_email, 'hong@test.local')
})

// ---------------------------------------------------------------- 승인 확정

test('승인을 확정하면 상태와 결제키·승인시각이 기록된다', async () => {
  const { createPendingPayment, markPaymentDone, getPaymentByOrderId } = await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_done01' }))

  await markPaymentDone('dues_done01', {
    paymentKey: 'pk_abc',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: { status: 'DONE', totalAmount: 30000 },
  })

  const row = await getPaymentByOrderId('dues_done01')
  assert.equal(row.status, 'done')
  assert.equal(row.payment_key, 'pk_abc')
  assert.equal(row.method, '카드')
  assert.equal(
    new Date(row.approved_at).toISOString(),
    new Date('2026-09-01T10:00:00+09:00').toISOString()
  )
})

test('토스 응답 원문을 그대로 보존한다', async () => {
  // 분쟁이 생기면 우리가 요약한 값이 아니라 토스가 준 원문이 근거가 된다.
  const { createPendingPayment, markPaymentDone, getPaymentByOrderId } = await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_raw01' }))
  await markPaymentDone('dues_raw01', {
    paymentKey: 'pk_raw',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: { status: 'DONE', card: { number: '43301234****123*' } },
  })

  const row = await getPaymentByOrderId('dues_raw01')
  assert.equal(row.raw_response.card.number, '43301234****123*')
})

test('확정을 두 번 해도 첫 승인 기록이 유지된다', async () => {
  // 승인 응답과 웹훅이 겹쳐 도착하는 상황. 토스는 웹훅을 최대 7번 재전송한다.
  const { createPendingPayment, markPaymentDone, getPaymentByOrderId } = await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_idem01' }))

  await markPaymentDone('dues_idem01', {
    paymentKey: 'pk_first',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: { status: 'DONE' },
  })
  await markPaymentDone('dues_idem01', {
    paymentKey: 'pk_second',
    method: '계좌이체',
    approvedAt: '2026-09-02T11:00:00+09:00',
    raw: { status: 'DONE' },
  })

  const row = await getPaymentByOrderId('dues_idem01')
  assert.equal(row.status, 'done')
  assert.equal(row.payment_key, 'pk_first')
  assert.equal(row.method, '카드')
  assert.equal(
    new Date(row.approved_at).toISOString(),
    new Date('2026-09-01T10:00:00+09:00').toISOString()
  )
})

// ---------------------------------------------------------------- 실패·취소

test('실패를 기록하면 사유가 남는다', async () => {
  const { createPendingPayment, markPaymentFailed, getPaymentByOrderId } = await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_fail01' }))

  await markPaymentFailed('dues_fail01', {
    code: 'REJECT_CARD_PAYMENT',
    message: '한도초과 혹은 잔액부족으로 결제에 실패했습니다.',
  })

  const row = await getPaymentByOrderId('dues_fail01')
  assert.equal(row.status, 'failed')
  assert.equal(row.failure_code, 'REJECT_CARD_PAYMENT')
  assert.match(row.failure_message, /한도초과/)
})

test('확정된 결제는 실패로 뒤집히지 않는다', async () => {
  // 승인 뒤에 도착한 낡은 실패 통지가 원장을 뒤집으면, 받은 돈이 장부에서 사라진다.
  const { createPendingPayment, markPaymentDone, markPaymentFailed, getPaymentByOrderId } =
    await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_nofail01' }))
  await markPaymentDone('dues_nofail01', {
    paymentKey: 'pk_x',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: {},
  })

  await markPaymentFailed('dues_nofail01', { code: 'LATE', message: '늦게 온 실패 통지' })

  const row = await getPaymentByOrderId('dues_nofail01')
  assert.equal(row.status, 'done')
  assert.equal(row.failure_code, null)
})

test('전액 취소를 기록한다', async () => {
  const { createPendingPayment, markPaymentDone, recordPaymentCancel, getPaymentByOrderId } =
    await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_cancel01' }))
  await markPaymentDone('dues_cancel01', {
    paymentKey: 'pk_c1',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: {},
  })

  await recordPaymentCancel('dues_cancel01', { canceledAmount: 30000, raw: {} })

  const row = await getPaymentByOrderId('dues_cancel01')
  assert.equal(row.status, 'canceled')
  assert.equal(row.canceled_amount, 30000)
})

test('부분 취소는 부분취소 상태로 남는다', async () => {
  const { createPendingPayment, markPaymentDone, recordPaymentCancel, getPaymentByOrderId } =
    await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_cancel02', amount: 30000 }))
  await markPaymentDone('dues_cancel02', {
    paymentKey: 'pk_c2',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: {},
  })

  await recordPaymentCancel('dues_cancel02', { canceledAmount: 10000, raw: {} })
  let row = await getPaymentByOrderId('dues_cancel02')
  assert.equal(row.status, 'partial_canceled')
  assert.equal(row.canceled_amount, 10000)

  // 두 번째 취소가 나가면 토스가 알려주는 **누적 취소 총액**을 그대로 넣는다.
  await recordPaymentCancel('dues_cancel02', { canceledAmount: 30000, raw: {} })
  row = await getPaymentByOrderId('dues_cancel02')
  assert.equal(row.status, 'canceled')
  assert.equal(row.canceled_amount, 30000)
})

test('같은 취소 통지가 두 번 와도 취소 금액이 부풀지 않는다', async () => {
  // 취소 금액을 더하는 방식으로 구현하면 웹훅 재전송(최대 7회)마다 금액이
  // 불어나 환불액이 결제액을 넘는다. 그래서 "총액을 기록"하는 방식이어야 한다.
  const { createPendingPayment, markPaymentDone, recordPaymentCancel, getPaymentByOrderId } =
    await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_cancel03', amount: 30000 }))
  await markPaymentDone('dues_cancel03', {
    paymentKey: 'pk_c3',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: {},
  })

  await recordPaymentCancel('dues_cancel03', { canceledAmount: 10000, raw: {} })
  await recordPaymentCancel('dues_cancel03', { canceledAmount: 10000, raw: {} })

  const row = await getPaymentByOrderId('dues_cancel03')
  assert.equal(row.canceled_amount, 10000)
  assert.equal(row.status, 'partial_canceled')
})

test('취소 금액이 뒤로 줄어드는 통지는 무시한다', async () => {
  // 웹훅은 순서를 보장하지 않는다. 전액 취소 뒤에 낡은 부분취소 통지가
  // 도착해 금액이 되감기면 환불 상태가 뒤집힌다.
  const { createPendingPayment, markPaymentDone, recordPaymentCancel, getPaymentByOrderId } =
    await loadFresh()
  await createPendingPayment(pendingInput({ orderId: 'dues_cancel04', amount: 30000 }))
  await markPaymentDone('dues_cancel04', {
    paymentKey: 'pk_c4',
    method: '카드',
    approvedAt: '2026-09-01T10:00:00+09:00',
    raw: {},
  })

  await recordPaymentCancel('dues_cancel04', { canceledAmount: 30000, raw: {} })
  await recordPaymentCancel('dues_cancel04', { canceledAmount: 10000, raw: {} })

  const row = await getPaymentByOrderId('dues_cancel04')
  assert.equal(row.canceled_amount, 30000)
  assert.equal(row.status, 'canceled')
})

// ---------------------------------------------------------------- 월별 회비

test('청구월 행을 만들면 미납 상태로 시작한다', async () => {
  const { ensureDues, getDues } = await loadFresh()
  await ensureDues({ userId: 'm-001', billingMonth: '2026-09', amount: 30000 })

  const row = await getDues('m-001', '2026-09')
  assert.ok(row)
  assert.equal(row.status, 'unpaid')
  assert.equal(row.amount, 30000)
  assert.equal(row.payment_id, null)
})

test('같은 회원·같은 청구월은 두 번 만들어도 한 행이다', async () => {
  // 크론이 두 번 돌아도 같은 달이 두 번 청구되지 않아야 한다.
  const { ensureDues, countDues } = await loadFresh()
  await ensureDues({ userId: 'm-001', billingMonth: '2026-10', amount: 30000 })
  await ensureDues({ userId: 'm-001', billingMonth: '2026-10', amount: 50000 })

  assert.equal(await countDues('m-001', '2026-10'), 1)
})

test('이미 있는 청구월은 금액을 덮어쓰지 않는다', async () => {
  // 청구서를 이미 보낸 뒤 회비 설정이 바뀌어도 그 달 청구액은 그대로여야 한다.
  const { ensureDues, getDues } = await loadFresh()
  await ensureDues({ userId: 'm-001', billingMonth: '2026-11', amount: 30000 })
  await ensureDues({ userId: 'm-001', billingMonth: '2026-11', amount: 50000 })

  const row = await getDues('m-001', '2026-11')
  assert.equal(row.amount, 30000)
})

test('납부 처리하면 결제와 연결되고 납부 시각이 남는다', async () => {
  const {
    createPendingPayment,
    markPaymentDone,
    ensureDues,
    markDuesPaid,
    getDues,
    getPaymentByOrderId,
  } = await loadFresh()
  await ensureDues({ userId: 'm-001', billingMonth: '2026-12', amount: 30000 })
  await createPendingPayment(pendingInput({ orderId: 'dues_link01' }))
  await markPaymentDone('dues_link01', {
    paymentKey: 'pk_link',
    method: '카드',
    approvedAt: '2026-12-01T10:00:00+09:00',
    raw: {},
  })
  const payment = await getPaymentByOrderId('dues_link01')

  await markDuesPaid({ userId: 'm-001', billingMonth: '2026-12', paymentId: payment.id })

  const row = await getDues('m-001', '2026-12')
  assert.equal(row.status, 'paid')
  assert.equal(row.payment_id, payment.id)
  assert.ok(row.paid_at)
})

test('미납 청구월만 골라낸다', async () => {
  // 매월 청구 크론이 "아직 안 낸 사람"을 찾는 경로.
  const {
    ensureDues,
    markDuesPaid,
    listUnpaidDues,
    createPendingPayment,
    markPaymentDone,
    getPaymentByOrderId,
  } = await loadFresh()
  await ensureDues({ userId: 'm-001', billingMonth: '2027-01', amount: 30000 })

  let unpaid = await listUnpaidDues('2027-01')
  assert.equal(unpaid.length, 1)
  assert.equal(unpaid[0].user_id, 'm-001')

  await createPendingPayment(pendingInput({ orderId: 'dues_unpaid01' }))
  await markPaymentDone('dues_unpaid01', {
    paymentKey: 'pk_u',
    method: '카드',
    approvedAt: '2027-01-05T10:00:00+09:00',
    raw: {},
  })
  const payment = await getPaymentByOrderId('dues_unpaid01')
  await markDuesPaid({ userId: 'm-001', billingMonth: '2027-01', paymentId: payment.id })

  unpaid = await listUnpaidDues('2027-01')
  assert.equal(unpaid.length, 0)
})
