import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 리워드 이행 — **진짜 로컬 DB**를 상대로 한다.
 *
 * 이 파일이 존재하는 이유는 하나다. 취소 라우트가 "이행이 시작되지 않은
 * 후원만 자동 환불"을 조건으로 걸고 있는데 `fulfillment_status`를 **아무도
 * 쓰지 않아** 그 조건이 한 번도 걸린 적이 없었다. 개설자가 리워드를 부친
 * 뒤에도 후원자가 전액 자동 환불을 받을 수 있었다(물건과 돈을 둘 다 잃는다).
 *
 * 그래서 마지막 두 테스트가 이 작업의 과녁이다: `claimPledgeForCancel`이
 * 이행이 시작된 후원을 **실제로 거절하는가.**
 */

const DB_PATH = 'scripts/testing/.queries-funding-fulfillment-test.db'
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)

let client, pq, fq, payq
let campaign, shipReward, plainReward

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('u1','개설자','owner@x.kr','approved',1)"
  )
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  const t = Date.now()
  pq = await import(`${PLEDGES_URL.href}?t=${t}`)
  fq = await import(`${FUNDING_URL.href}?t=${t}`)
  payq = await import(`${PAYMENTS_URL.href}?t=${t}`)
  campaign = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '첫 정규앨범',
    summary: 's',
    goal_amount: 1,
  })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'album',
  })
  shipReward = await fq.createReward({
    campaign_id: campaign.id,
    title: 'CD 한 장',
    amount: 30000,
    requires_shipping: true,
  })
  plainReward = await fq.createReward({
    campaign_id: campaign.id,
    title: '고맙습니다 한마디',
    amount: 5000,
  })
})

after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

let seq = 0
/** 결제까지 끝난 후원 하나를 만든다. */
async function paidPledge(reward, extra = {}) {
  const orderId = `fulfil_${++seq}`
  const amount = reward.amount
  await payq.createPendingPayment({
    orderId,
    userId: null,
    kind: 'funding',
    orderName: 'x',
    amount,
  })
  const held = await pq.holdPledge({
    order_id: orderId,
    campaign_id: campaign.id,
    reward_id: reward.id,
    user_id: null,
    quantity: 1,
    additional_amount: 0,
    backer_name: '김후원',
    backer_email: `${orderId}@x.kr`,
    backer_phone: '010-1234-5678',
    is_anonymous: false,
    terms_version: 'v1',
    shipping: {
      name: '김수취',
      phone: '010-9999-8888',
      postcode: '06236',
      address1: '서울시 강남구 테헤란로 1',
      address2: '3층',
      memo: '부재 시 경비실',
    },
    ...extra,
  })
  return pq.finalizePledgePayment({
    orderId,
    pledgeId: held.id,
    paymentKey: `pk_${orderId}`,
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
}

test('이행은 전진만 하고, 허용되지 않은 출발 상태의 행은 아무것도 쓰지 않는다', async () => {
  const p = await paidPledge(shipReward)
  assert.equal(p.fulfillment_status, 'none')

  const prepared = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'preparing',
    allowedFrom: ['none'],
  })
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0].fulfillment_status, 'preparing')

  // 같은 요청을 한 번 더 보낸다 — 이미 움직인 행은 출발 조건에 걸리지 않아
  // 0행이다. 화면이 두 탭에서 같은 버튼을 누른 상황이 이것이고, 라우트는
  // 이 0을 보고 409로 답한다.
  const again = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'preparing',
    allowedFrom: ['none'],
  })
  assert.equal(again.length, 0)

  // 역행은 출발 상태 목록으로 막힌다(개설자에게는 빈 목록이 온다).
  const back = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'none',
    allowedFrom: [],
  })
  assert.equal(back.length, 0)
  assert.equal((await pq.getPledgeById(p.id)).fulfillment_status, 'preparing')

  // 사무국의 유일한 역행: preparing → none.
  const restored = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'none',
    allowedFrom: ['preparing'],
  })
  assert.equal(restored.length, 1)
  assert.equal(restored[0].fulfillment_status, 'none')
})

test('결제가 끝나지 않은 후원과 남의 캠페인 건은 이행이 움직이지 않는다', async () => {
  const paid = await paidPledge(shipReward)
  const canceled = await paidPledge(shipReward)
  await pq.claimPledgeForCancel(canceled.id, { requireFulfillmentNone: true })

  const other = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '다른 프로젝트',
    summary: 's',
    goal_amount: 1,
  })

  // 취소된 건은 status='paid' 조건에 걸려 빠진다.
  const r1 = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [paid.id, canceled.id],
    to: 'shipped',
    allowedFrom: ['none', 'preparing'],
  })
  assert.deepEqual(
    r1.map(r => r.id),
    [paid.id]
  )
  assert.equal((await pq.getPledgeById(canceled.id)).fulfillment_status, 'none')

  // 남의 캠페인 id로는 이 후원을 건드리지 못한다.
  const p2 = await paidPledge(shipReward)
  const r2 = await pq.advanceFulfillment({
    campaignId: other.id,
    pledgeIds: [p2.id],
    to: 'shipped',
    allowedFrom: ['none', 'preparing'],
  })
  assert.equal(r2.length, 0)
  assert.equal((await pq.getPledgeById(p2.id)).fulfillment_status, 'none')
})

test('배송 목록은 배송이 필요한 리워드의 결제 완료 후원만, 익명은 후원자 표기만 가린다', async () => {
  const shipped = await paidPledge(shipReward, { is_anonymous: true, backer_name: '박익명' })
  const noShip = await paidPledge(plainReward, { shipping: undefined })

  const rows = await pq.listShippingPledges(campaign.id)
  const codes = rows.map(r => r.pledge_code)
  assert.ok(codes.includes(shipped.pledge_code))
  assert.ok(!codes.includes(noShip.pledge_code))

  const row = rows.find(r => r.pledge_code === shipped.pledge_code)
  // 공개 화면에서 이름을 가리기로 한 사람이라도, 소포를 부치는 사람에게
  // 받는 사람 이름은 가리지 않는다 — 개설자 대시보드와 같은 규칙이다.
  assert.equal(row.backer_name, '익명')
  assert.equal(row.shipping_name, '김수취')
  assert.equal(row.shipping_postcode, '06236')
})

test('발송한 후원은 자동 취소 선점이 거절된다 — 이 규칙이 처음으로 실제로 걸린다', async () => {
  const p = await paidPledge(shipReward)

  // 이행 전에는 선점이 된다는 것부터 고정한다. 이게 안 되면 아래 거절이
  // "원래 안 되던 것"과 구분되지 않는다.
  const before = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'shipped',
    allowedFrom: ['none', 'preparing'],
  })
  assert.equal(before.length, 1)

  const claimed = await pq.claimPledgeForCancel(p.id, { requireFulfillmentNone: true })
  assert.equal(claimed, null, '발송된 후원은 자동 환불 선점이 되면 안 된다')
  // 거절됐으니 후원은 그대로 결제 완료여야 한다 — 선점이 반쯤 걸려 있으면
  // 환불이 나가지 않은 채 후원만 취소로 남는다.
  const after = await pq.getPledgeById(p.id)
  assert.equal(after.status, 'paid')
  assert.equal(after.fulfillment_status, 'shipped')
})

test('이행이 시작되지 않은 후원은 여전히 자동 취소 선점이 된다', async () => {
  const p = await paidPledge(shipReward)
  const claimed = await pq.claimPledgeForCancel(p.id, { requireFulfillmentNone: true })
  assert.ok(claimed)
  assert.equal(claimed.status, 'canceled')
})
