import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 사무국 대리 환불 — **진짜 로컬 DB**를 상대로 한다.
 *
 * 이 파일이 존재하는 이유: 사무국이 후원을 환불할 길이 없어서 토스 콘솔로
 * 갔고, 콘솔에서 나간 환불은 `funding_pledges.status`에 닿지 않았다. 그러면
 * 정산은 **이미 돌려준 돈까지 창작자에게 지급하라고 말한다.** 그래서 여기서
 * 가장 중요한 단정은 하나다 — 사무국이 환불하면 **정산 근거가 따라 움직이는가.**
 *
 * 토스만 대역이다. 나머지는 전부 실제 쿼리 계층이다.
 */

const DB_PATH = 'scripts/testing/.queries-office-refund-test.db'
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const SETTLE_URL = new URL('../../src/db/queries/fundingSettlements.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)
const OFFICE_URL = new URL('../../src/lib/server/officeRefund.ts', import.meta.url)
const TOSS_URL = new URL('../../src/lib/payments/toss/client.ts', import.meta.url)

const f = await import('../../src/lib/funding/fulfillment.ts')
const plan = await import('../../src/lib/funding/officeRefund.ts')

let client, pq, fq, sq, payq, office, toss
let seq = 0

/** 캠페인 요율 5.5%(부가세 포함) — 나누어떨어지지 않는 값을 일부러 고른다. */
const RATE_BP = 550

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('u1','개설자','owner@x.kr','approved',1)"
  )
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  // **캐시 무효화 질의문자열을 붙이지 않는다.** `officeRefund.ts`가 안에서
  // 부르는 쿼리·토스 모듈은 질의문자열 없는 경로로 실려 오므로, 여기서 `?t=`를
  // 붙이면 **다른 모듈 인스턴스**가 되어 `instanceof TossApiError`가 거짓이 된다
  // (실제로 물렸다). 파일마다 프로세스가 갈리므로 무효화가 애초에 필요 없다.
  pq = await import(PLEDGES_URL.href)
  fq = await import(FUNDING_URL.href)
  sq = await import(SETTLE_URL.href)
  payq = await import(PAYMENTS_URL.href)
  toss = await import(TOSS_URL.href)
  office = await import(OFFICE_URL.href)
})

after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

async function openCampaign() {
  const n = ++seq
  const campaign = await fq.createCampaign({
    owner_user_id: 'u1',
    title: `사무국 환불 캠페인 ${n}`,
    summary: 's',
    goal_amount: 1_000_000,
  })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  const approved = await fq.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: `office-${n}`,
    platformFeeRate: RATE_BP,
  })
  const reward = await fq.createReward({
    campaign_id: campaign.id,
    title: 'CD 한 장',
    amount: 30_000,
  })
  return { campaign: approved, reward }
}

async function paidPledge(campaign, reward) {
  const orderId = `office_${++seq}`
  await payq.createPendingPayment({
    orderId,
    userId: null,
    kind: 'funding',
    orderName: 'x',
    amount: reward.amount,
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
    terms_version: 'v1',
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

/** 라우트가 하는 그대로 — 원장을 읽고, 판정하고, 실행한다. 토스만 대역이다. */
async function officeRefund(pledgeId, cancelPayment) {
  const pledge = await pq.getPledgeById(pledgeId)
  const payment = await payq.getPaymentById(String(pledge.payment_id))
  const decided = plan.planOfficeRefund(pledge, payment)
  assert.equal(decided.ok, true, decided.message)
  return office.refundPledgeAsOffice(
    {
      pledgeId: String(pledge.id),
      paymentId: String(payment.id),
      paymentKey: String(payment.payment_key),
      orderId: String(payment.order_id),
      amount: decided.amount,
      retry: decided.retry,
      secretKey: 'sk_test',
      actorId: 'u1',
    },
    { cancelPayment }
  )
}

const acceptRefund = async () => ({ status: 'CANCELED' })

// ------------------------------------------------------------------------

test('사무국이 발송 완료된 후원을 환불하면 정산 근거와 지급액이 따라 움직인다', async () => {
  const { campaign, reward } = await openCampaign()
  const a = await paidPledge(campaign, reward)
  const b = await paidPledge(campaign, reward)

  // 개설자가 a를 발송 완료로 표시한다 — 이 순간 a의 자동 취소는 닫힌다.
  const marked = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [a.id],
    to: 'shipped',
    allowedFrom: f.allowedSourcesFor('shipped', false),
  })
  assert.equal(marked.length, 1)

  // 후원자 본인 취소는 실제로 막혀 있다(그 규칙은 그대로 둔다).
  assert.equal(await pq.claimPledgeForCancel(String(a.id), { requireFulfillmentNone: true }), null)

  await fq.transitionCampaign({ id: campaign.id, action: 'close', expectedFrom: 'active' })
  const first = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: RATE_BP,
    pg_fee_amount: 1_000,
  })
  assert.equal(first.ok, true)
  assert.deepEqual(
    {
      gross: first.amounts.gross_amount,
      refund: first.amounts.refund_amount,
      backers: first.amounts.backer_count,
      payout: first.amounts.payout_amount,
    },
    // 60,000 − 1,000(PG) − 3,300(플랫폼 5.5% 버림) = 55,700
    { gross: 60_000, refund: 0, backers: 2, payout: 55_700 }
  )

  // 사무국이 **발송 완료된** a를 환불한다.
  const outcome = await officeRefund(a.id, acceptRefund)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.amount, 30_000)
  assert.equal(outcome.pledge.status, 'refunded')

  // ① 원장이 움직였다.
  assert.equal((await pq.getPledgeById(String(a.id))).status, 'refunded')
  assert.equal((await pq.getPledgeById(String(b.id))).status, 'paid')
  const payment = await payq.getPaymentById(String(a.payment_id))
  assert.equal(Number(payment.canceled_amount), 30_000)
  assert.equal(payment.status, 'canceled')

  // ② 정산 근거가 따라 움직였다 — 이 파일이 존재하는 이유다.
  const basis = await sq.computeSettlementBasis(campaign.id)
  assert.deepEqual(basis, { gross_amount: 60_000, refund_amount: 30_000, backer_count: 1 })

  // ③ 공개 화면의 모금액·후원자 수도 같이 움직인다.
  const progress = await fq.getCampaignProgress(campaign.id)
  assert.equal(Number(progress.raised_amount), 30_000)
  assert.equal(Number(progress.backer_count), 1)

  // ④ 앞서 만든 정산서는 낡았다고 말하고, 그 상태로는 지급을 찍지 못한다.
  const stored = await sq.getSettlementByCampaign(campaign.id)
  assert.equal(await sq.isSettlementStale(stored), true)
  const blocked = await sq.markSettlementPaid(campaign.id)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'stale')

  // ⑤ 다시 정리하면 지급액이 환불을 반영한다.
  //    30,000 − 1,000(PG) − 1,650(5.5% 버림) = 27,350
  const again = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: RATE_BP,
    pg_fee_amount: 1_000,
  })
  assert.equal(again.ok, true)
  assert.equal(again.amounts.refund_amount, 30_000)
  assert.equal(again.amounts.backer_count, 1)
  assert.equal(again.amounts.payout_amount, 27_350)
  const paidOut = await sq.markSettlementPaid(campaign.id)
  assert.equal(paidOut.ok, true)
})

test('토스가 거절하면 선점을 되돌려 후원은 paid로 남고 정산 근거는 그대로다', async () => {
  const { campaign, reward } = await openCampaign()
  const p = await paidPledge(campaign, reward)

  const outcome = await officeRefund(p.id, async () => {
    throw new toss.TossApiError('NOT_CANCELABLE_AMOUNT', '취소할 수 없는 금액입니다', 400, {})
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'rejected')

  assert.equal((await pq.getPledgeById(String(p.id))).status, 'paid')
  assert.deepEqual(await sq.computeSettlementBasis(campaign.id), {
    gross_amount: 30_000,
    refund_amount: 0,
    backer_count: 1,
  })
})

test('판단 불가는 완료로 기록하지 않는다 — 재시도가 선점을 건너뛰고 끝까지 간다', async () => {
  const { campaign, reward } = await openCampaign()
  const p = await paidPledge(campaign, reward)

  const first = await officeRefund(p.id, async () => {
    throw new toss.TossLookupError('응답을 읽지 못했습니다')
  })
  assert.equal(first.ok, false)
  assert.equal(first.reason, 'lookup')

  // 후원은 `canceled`로 남는다 — `refunded`가 아니다. 부분 실패를 완료로
  // 기록하지 않는다는 것이 이 단정이다.
  const mid = await pq.getPledgeById(String(p.id))
  assert.equal(mid.status, 'canceled')
  // 그래도 정산은 이 돈을 창작자에게 주지 않는다 — 나가는 중인 건을 환불로
  // 세는 쪽을 고른 이유다(`capturedCondition`).
  assert.deepEqual(await sq.computeSettlementBasis(campaign.id), {
    gross_amount: 30_000,
    refund_amount: 30_000,
    backer_count: 0,
  })

  // 같은 버튼을 다시 누른다. 판정이 재시도로 갈리고, 선점을 건너뛴다.
  const replan = plan.planOfficeRefund(
    await pq.getPledgeById(String(p.id)),
    await payq.getPaymentById(String(p.payment_id))
  )
  assert.equal(replan.retry, true)
  const second = await officeRefund(p.id, acceptRefund)
  assert.equal(second.ok, true)
  assert.equal((await pq.getPledgeById(String(p.id))).status, 'refunded')
})

test('같은 후원을 두 번 환불하지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  const p = await paidPledge(campaign, reward)
  assert.equal((await officeRefund(p.id, acceptRefund)).ok, true)

  const again = plan.planOfficeRefund(
    await pq.getPledgeById(String(p.id)),
    await payq.getPaymentById(String(p.payment_id))
  )
  assert.equal(again.ok, false)
  assert.equal(again.reason, 'already_refunded')
  assert.deepEqual(await sq.computeSettlementBasis(campaign.id), {
    gross_amount: 30_000,
    refund_amount: 30_000,
    backer_count: 0,
  })
})

test('되돌리기는 사무국의 별도 표로만 통하고, 되돌리면 후원자의 직접 취소가 다시 열린다', async () => {
  const { campaign, reward } = await openCampaign()
  const p = await paidPledge(campaign, reward)
  await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'shipped',
    allowedFrom: f.allowedSourcesFor('shipped', false),
  })

  // 평상시 표로는 관리자도 발송 완료를 되돌리지 못한다 — 0행이다.
  const byNormalTable = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'none',
    allowedFrom: f.allowedSourcesFor('none', true),
  })
  assert.equal(byNormalTable.length, 0)
  assert.equal((await pq.getPledgeById(String(p.id))).fulfillment_status, 'shipped')

  // 사무국 전용 문으로는 통한다.
  const reversed = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'none',
    allowedFrom: f.allowedReversalSourcesFor('none'),
  })
  assert.equal(reversed.length, 1)
  assert.equal(reversed[0].fulfillment_status, 'none')
  assert.equal(f.crossesSentBoundaryBackward('shipped', 'none'), true)
  assert.equal(f.reopensSelfCancel('shipped', 'none'), true)

  // 그리고 실제로 후원자가 스스로 취소할 수 있게 된다.
  const claimed = await pq.claimPledgeForCancel(String(p.id), { requireFulfillmentNone: true })
  assert.ok(claimed)
  await pq.revertPledgeCancel(String(p.id))

  // 환불된 후원은 되돌리기 대상이 아니다(조건부 쓰기가 `paid`만 본다).
  assert.equal((await officeRefund(p.id, acceptRefund)).ok, true)
  const afterRefund = await pq.advanceFulfillment({
    campaignId: campaign.id,
    pledgeIds: [p.id],
    to: 'preparing',
    allowedFrom: f.allowedSourcesFor('preparing', true),
  })
  assert.equal(afterRefund.length, 0)
})
