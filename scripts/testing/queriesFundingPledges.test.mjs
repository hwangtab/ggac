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
  await payq.createPendingPayment({ orderId, userId: null, kind: 'funding', orderName: 'x', amount: 1 })
  return pq.holdPledge({
    order_id: orderId,
    campaign_id: campaign.id,
    reward_id: rewardId,
    user_id: null,
    quantity,
    additional_amount: 0,
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

test('확정은 주문·후원 짝이 맞을 때만, 결제와 리워드 잠금을 함께', async () => {
  const p = await hold('funding_c', limited.id, 1)
  const wrong = await pq.finalizePledgePayment({
    orderId: 'funding_zzz', pledgeId: p.id, paymentKey: 'pk', method: '카드', approvedAt: new Date(), raw: {},
  })
  assert.equal(wrong, null)
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

test('비회원 조회는 번호+이메일, 공개 명단은 익명·비공개 메시지를 가린다', async () => {
  const p = await hold('funding_e', unlimited.id, 1, { is_anonymous: true, message_public: false })
  await pq.finalizePledgePayment({ orderId: 'funding_e', pledgeId: p.id, paymentKey: 'pk_e', method: '카드', approvedAt: new Date(), raw: {} })
  assert.equal(await pq.getPledgeByCodeAndEmail(p.pledge_code, 'nope@x.kr'), null)
  assert.equal((await pq.getPledgeByCodeAndEmail(p.pledge_code, 'B@X.KR')).id, p.id)
  const backers = await pq.listPublicBackers(campaign.id)
  const paidAt = (await pq.getPledgeById(p.id)).paid_at
  const mine = backers.find(b => b.paid_at === paidAt)
  assert.equal(mine.name, '익명')
  assert.equal(mine.message, null)
})
