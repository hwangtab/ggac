import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const DB_PATH = 'scripts/testing/.queries-funding-pledges-test.db'
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)
let client, pq, fq, payq
let campaign, limited, unlimited

const backer = {
  backer_name: '후원자',
  backer_email: 'b@x.kr',
  backer_phone: '01012345678',
  is_anonymous: false,
  supporter_message: '응원합니다',
  message_public: true,
  terms_version: 'v1',
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('u1','가','a@x.kr','approved',1)"
  )
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  const t = Date.now()
  pq = await import(`${PLEDGES_URL.href}?t=${t}`)
  fq = await import(`${FUNDING_URL.href}?t=${t}`)
  payq = await import(`${PAYMENTS_URL.href}?t=${t}`)
  campaign = await fq.createCampaign({ owner_user_id: 'u1', title: 't', summary: 's', goal_amount: 1 })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({ id: campaign.id, action: 'approve', expectedFrom: 'submitted', slug: 'c' })
  limited = await fq.createReward({ campaign_id: campaign.id, title: '한정', amount: 10000, total_quantity: 3 })
  unlimited = await fq.createReward({ campaign_id: campaign.id, title: '무제한', amount: 5000 })
})
after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

async function hold(orderId, rewardId, quantity, extra = {}) {
  const reward = rewardId === limited.id ? limited : unlimited
  const additionalAmount = extra.additional_amount ?? 0
  // 결제 원장 금액을 후원 총액과 같게 둔다 — 실제로는 항상 같은 값이고,
  // 이게 어긋나 있으면(예: 1원 고정) 환불의 전액/부분 분기 경계를
  // 아무 테스트도 지나가지 않는다.
  const amount = reward.amount * quantity + additionalAmount
  await payq.createPendingPayment({ orderId, userId: null, kind: 'funding', orderName: 'x', amount })
  return pq.holdPledge({
    order_id: orderId,
    campaign_id: campaign.id,
    reward_id: rewardId,
    user_id: null,
    quantity,
    additional_amount: additionalAmount,
    ...backer,
    ...extra,
  })
}

test('선점은 pending이며 재고를 줄인다; 초과는 매진', async () => {
  const p1 = await hold('funding_a', limited.id, 2)
  assert.equal(p1.status, 'pending')
  assert.match(p1.pledge_code, /^FND-/)
  assert.equal(p1.total_amount, 20000)
  assert.equal(await pq.getRemainingQuantity(limited.id), 1)
  await assert.rejects(() => hold('funding_b', limited.id, 2), e => e instanceof pq.RewardSoldOutError && e.remaining === 1)
  assert.equal(await pq.getRemainingQuantity(unlimited.id), null)
})

test('만료된 선점은 재고에서 빠진다', async () => {
  const past = new Date(Date.now() - 60_000)
  await client.execute({
    sql: 'UPDATE funding_pledges SET hold_expires_at = ? WHERE order_id = ?',
    args: [past.getTime(), 'funding_a'],
  })
  assert.equal(await pq.getRemainingQuantity(limited.id), 3)
  const rows = await pq.listExpiredHolds()
  assert.ok(rows.some(r => r.order_id === 'funding_a'))
  assert.equal(await pq.expirePledge(rows.find(r => r.order_id === 'funding_a').id), true)
  assert.equal((await pq.getPledgeByOrderId('funding_a')).status, 'expired')
})

test('확정은 다른 주문의 후원 id를 넘기면 실패하고 두 후원 다 그대로다', async () => {
  // 결제가 실제로 존재하는 두 주문을 각각 만든다 — "결제 자체가 없어서"가
  // 아니라 "짝이 다른 결제라서" 막히는지를 보려면 둘 다 있어야 한다.
  const a = await hold('funding_cross_a', unlimited.id, 1)
  const b = await hold('funding_cross_b', unlimited.id, 1)
  const result = await pq.finalizePledgePayment({
    orderId: 'funding_cross_b', pledgeId: a.id, paymentKey: 'pk_x', method: '카드', approvedAt: new Date(), raw: {},
  })
  assert.equal(result, null)
  assert.equal((await pq.getPledgeById(a.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(b.id)).status, 'pending')
})

test('확정은 주문·후원 짝이 맞을 때만, 결제와 리워드 잠금을 함께', async () => {
  const p = await hold('funding_c', limited.id, 1)
  const ok = await pq.finalizePledgePayment({
    orderId: 'funding_c', pledgeId: p.id, paymentKey: 'pk_c', method: '카드', approvedAt: new Date(), raw: { a: 1 },
  })
  assert.equal(ok.status, 'paid')
  assert.equal(typeof ok.paid_at, 'string')
  const payment = await payq.getPaymentByOrderId('funding_c')
  assert.equal(payment.status, 'done')
  assert.equal(ok.payment_id, payment.id)
  assert.ok((await fq.getReward(limited.id)).locked_at)
  // 새로고침: 같은 주문으로 다시 확정하면 같은 행
  const again = await pq.finalizePledgePayment({
    orderId: 'funding_c', pledgeId: p.id, paymentKey: 'pk_c', method: '카드', approvedAt: new Date(), raw: {},
  })
  assert.equal(again.id, p.id)
})

test('취소 선점 → 환불 기록, 되돌리기', async () => {
  const p = await pq.getPledgeByOrderId('funding_c')
  const claimed = await pq.claimPledgeForCancel(p.id, { requireFulfillmentNone: true })
  assert.equal(claimed.status, 'canceled')
  assert.equal(await pq.claimPledgeForCancel(p.id, {}), null)
  await pq.revertPledgeCancel(p.id)
  assert.equal((await pq.getPledgeById(p.id)).status, 'paid')
  await pq.claimPledgeForCancel(p.id, {})
  const payment = await payq.getPaymentByOrderId('funding_c')
  const refunded = await pq.finalizePledgeRefund({
    orderId: 'funding_c', paymentId: payment.id, pledgeId: p.id, canceledAmount: 10000, raw: {},
  })
  assert.equal(refunded.status, 'refunded')
  assert.equal((await payq.getPaymentByOrderId('funding_c')).status, 'canceled')
  assert.equal(await pq.getRemainingQuantity(limited.id), 3)
})

test('승인 실패 시 pending 취소는 주문 짝이 맞아야 한다', async () => {
  const p = await hold('funding_d', unlimited.id, 1)
  assert.equal(await pq.cancelPendingPledge(p.id, 'funding_other'), null)
  assert.equal((await pq.cancelPendingPledge(p.id, 'funding_d')).status, 'canceled')
})

test('결제 없이 취소된 pending 후원은 되돌릴 수 없다', async () => {
  // cancelPendingPledge도 claimPledgeForCancel(취소 선점)과 같은 'canceled'
  // 상태를 만들지만, 결제가 한 번도 붙지 않았다. revertPledgeCancel이
  // status만 보면 이걸 결제 완료 상태로 되살려버린다 — 재고를 팔린 것처럼
  // 차지하고 결제·paid_at 없는 'paid' 후원이 생긴다.
  const p = await hold('funding_revert_guard', unlimited.id, 1)
  const canceled = await pq.cancelPendingPledge(p.id, 'funding_revert_guard')
  assert.equal(canceled.status, 'canceled')
  await pq.revertPledgeCancel(p.id)
  const after = await pq.getPledgeById(p.id)
  assert.equal(after.status, 'canceled')
  assert.equal(after.payment_id, null)
})

test('부분 환불은 아무것도 쓰지 않고 거부된다', async () => {
  const p = await hold('funding_partial', unlimited.id, 1)
  await pq.finalizePledgePayment({ orderId: 'funding_partial', pledgeId: p.id, paymentKey: 'pk_partial', method: '카드', approvedAt: new Date(), raw: {} })
  await pq.claimPledgeForCancel(p.id, {})
  const payment = await payq.getPaymentByOrderId('funding_partial')
  await assert.rejects(
    () => pq.finalizePledgeRefund({ orderId: 'funding_partial', paymentId: payment.id, pledgeId: p.id, canceledAmount: payment.amount - 1000, raw: {} }),
    e => e instanceof pq.PartialRefundUnsupportedError && e.totalAmount === payment.amount
  )
  // 아무것도 쓰이지 않았어야 한다 — 후원도, 원장도 그대로.
  assert.equal((await pq.getPledgeById(p.id)).status, 'canceled')
  assert.equal((await payq.getPaymentByOrderId('funding_partial')).canceled_amount, 0)
})

test('환불 원장의 누적 취소액은 뒤에 온 더 작은 값으로 줄어들지 않는다', async () => {
  const p = await hold('funding_stale', unlimited.id, 1)
  await pq.finalizePledgePayment({ orderId: 'funding_stale', pledgeId: p.id, paymentKey: 'pk_stale', method: '카드', approvedAt: new Date(), raw: {} })
  await pq.claimPledgeForCancel(p.id, {})
  const payment = await payq.getPaymentByOrderId('funding_stale')
  const full = await pq.finalizePledgeRefund({
    orderId: 'funding_stale', paymentId: payment.id, pledgeId: p.id, canceledAmount: payment.amount, raw: {},
  })
  assert.equal(full.status, 'refunded')
  assert.equal((await payq.getPaymentByOrderId('funding_stale')).canceled_amount, payment.amount)
  // 뒤늦게 도착한, 더 작은 누적값을 담은 재전송. 원장이 뒷걸음질하면 안 된다.
  await assert.rejects(() =>
    pq.finalizePledgeRefund({
      orderId: 'funding_stale', paymentId: payment.id, pledgeId: p.id, canceledAmount: payment.amount - 1000, raw: {},
    })
  )
  assert.equal((await payq.getPaymentByOrderId('funding_stale')).canceled_amount, payment.amount)
})

test('정확히 남은 수량만큼 선점하면 성공하고 재고는 0이 된다', async () => {
  const boundary = await fq.createReward({ campaign_id: campaign.id, title: '경계', amount: 1000, total_quantity: 2 })
  const p = await hold('funding_boundary', boundary.id, 2)
  assert.equal(p.status, 'pending')
  assert.equal(await pq.getRemainingQuantity(boundary.id), 0)
})

test('비회원 조회는 번호+이메일, 공개 명단은 익명·비공개 메시지를 가리고 미확정 후원은 아예 빠진다', async () => {
  const p = await hold('funding_e', unlimited.id, 1, { is_anonymous: true, message_public: false })
  await pq.finalizePledgePayment({ orderId: 'funding_e', pledgeId: p.id, paymentKey: 'pk_e', method: '카드', approvedAt: new Date(), raw: {} })
  assert.equal(await pq.getPledgeByCodeAndEmail(p.pledge_code, 'nope@x.kr'), null)
  assert.equal((await pq.getPledgeByCodeAndEmail(p.pledge_code, 'B@X.KR')).id, p.id)

  // 아직 결제하지 않은 후원(pending)의 후원자 정보는 절대 공개되면 안 된다.
  const pending = await hold('funding_pending_hidden', unlimited.id, 1, { backer_name: '숨은후원자' })

  const backers = await pq.listPublicBackers(campaign.id)
  const paidAt = (await pq.getPledgeById(p.id)).paid_at
  const mine = backers.find(b => b.paid_at === paidAt)
  assert.equal(mine.name, '익명')
  assert.equal(mine.message, null)

  assert.ok(!backers.some(b => b.name === '숨은후원자'))
  assert.equal((await pq.getPledgeById(pending.id)).status, 'pending')

  // 응답 형태 자체가 개인정보를 새어 나가게 넓어지지 않았는지 — 정확히
  // 이 세 키만 있어야 한다. 이메일·전화·배송지·후원번호·금액은 없다.
  for (const row of backers) {
    assert.deepEqual(Object.keys(row).sort(), ['message', 'name', 'paid_at'])
  }
})
