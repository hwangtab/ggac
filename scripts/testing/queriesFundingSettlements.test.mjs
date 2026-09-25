import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 정산 — **진짜 로컬 DB**를 상대로 한다.
 *
 * 이 파일이 존재하는 이유: `funding_settlements` 테이블은 처음부터 있었지만
 * 저장소의 어떤 코드도 그 테이블을 읽거나 쓰지 않았다. 그래서 캠페인이
 * '정산 완료'가 되어도 **얼마를 줬는지 아무 기록이 없었다.**
 *
 * 숫자는 고약하게 고른다 — 환불이 섞인 모금액, 나누어떨어지지 않는 수수료율,
 * 지급액 0원, 그리고 **정리한 뒤에 도착한 환불**.
 */

const DB_PATH = 'scripts/testing/.queries-funding-settlements-test.db'
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const SETTLE_URL = new URL('../../src/db/queries/fundingSettlements.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)
const PRECONDITIONS_URL = new URL('../../src/lib/funding/campaignPreconditions.ts', import.meta.url)

const { cooperativeLossFor, changedSettlementFields } = await import(
  '../../src/lib/funding/settlement.ts'
)

let client, pq, fq, sq, payq, preq
let seq = 0

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
  sq = await import(`${SETTLE_URL.href}?t=${t}`)
  payq = await import(`${PAYMENTS_URL.href}?t=${t}`)
  preq = await import(`${PRECONDITIONS_URL.href}?t=${t}`)
})

after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

/** 공개 상태(`active`)까지 올라간 캠페인 하나와 리워드 하나. */
async function openCampaign(options = {}) {
  const n = ++seq
  const campaign = await fq.createCampaign({
    owner_user_id: 'u1',
    title: `정산 캠페인 ${n}`,
    summary: 's',
    goal_amount: 1_000_000,
  })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  const approved = await fq.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: `settle-${n}`,
    platformFeeRate: options.platformFeeRate ?? 0,
  })
  const reward = await fq.createReward({
    campaign_id: campaign.id,
    title: 'CD 한 장',
    amount: options.amount ?? 10_000,
  })
  return { campaign: approved, reward }
}

/** 결제까지 끝난 후원 하나. 추가 후원금은 1,000원 단위여야 한다(`amounts.ts`). */
async function paidPledge(campaign, reward, additional = 0) {
  const orderId = `settle_${++seq}`
  const amount = reward.amount + additional
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
    additional_amount: additional,
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

/** 전액 환불까지 끝낸다 — 취소 라우트가 하는 두 단계 그대로. */
async function refund(pledge) {
  await pq.claimPledgeForCancel(String(pledge.id), {})
  return pq.finalizePledgeRefund({
    orderId: String(pledge.order_id),
    paymentId: String(pledge.payment_id),
    pledgeId: String(pledge.id),
    canceledAmount: Number(pledge.total_amount),
    raw: {},
  })
}

async function close(campaign) {
  return fq.transitionCampaign({ id: campaign.id, action: 'close', expectedFrom: 'active' })
}

// ---------------------------------------------------------------- 합산

test('총 모금액은 돌려준 돈까지 세고, 실 모금액은 남은 후원의 합과 같다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward, 5_000) // 15,000
  await paidPledge(campaign, reward, 0) // 10,000
  const gone = await paidPledge(campaign, reward, 2_000) // 12,000 → 환불
  await refund(gone)

  const basis = await sq.computeSettlementBasis(campaign.id)
  assert.equal(basis.gross_amount, 37_000)
  assert.equal(basis.refund_amount, 12_000)
  assert.equal(basis.backer_count, 2)
  // 실 모금액은 공개 화면의 모인 금액과 정확히 같아야 한다.
  const progress = await fq.getCampaignProgress(campaign.id)
  assert.equal(basis.gross_amount - basis.refund_amount, progress.raised_amount)
  assert.equal(basis.backer_count, progress.backer_count)
})

async function hold(campaign, reward, name) {
  return pq.holdPledge({
    order_id: `settle_hold_${++seq}`,
    campaign_id: campaign.id,
    reward_id: reward.id,
    user_id: null,
    quantity: 1,
    additional_amount: 0,
    backer_name: name,
    backer_email: `${name}@x.kr`,
    terms_version: 'v1',
  })
}

test('결제가 붙은 적 없는 취소·만료 선점은 총 모금액에 들어가지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)

  // ① 만료된 선점(`expired`)
  const expired = await hold(campaign, reward, 'expired')
  await pq.expirePledge(expired.id)

  // ② **결제 한 번 없이 취소된 선점(`canceled`)** — 토스가 승인을 거절하면
  //    `cancelPendingPledge`가 만드는 행이고, 이것이 `payment_id IS NOT NULL`
  //    조건이 존재하는 이유다. 상태만 보면 환불 진행 건과 구별되지 않는다.
  const rejected = await hold(campaign, reward, 'rejected')
  const canceled = await pq.cancelPendingPledge(rejected.id, rejected.order_id)
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.payment_id, null, '전제가 깨졌다 — 결제가 붙어 있다')

  const basis = await sq.computeSettlementBasis(campaign.id)
  // 조건을 지우면 gross와 refund가 나란히 10,000씩 늘어 실 모금액은 그대로다.
  // 그래서 금액만 보면 조용히 통과한다 — 총액과 환불액을 따로 못박는다.
  assert.equal(basis.gross_amount, 10_000)
  assert.equal(basis.refund_amount, 0)
  assert.equal(basis.backer_count, 1)
})

test('정리한 뒤 토스가 승인을 거절해도 정산서는 낡지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)
  const prepared = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(prepared.ok, true)

  // 결제된 적 없는 선점 하나가 거절돼 `canceled`가 된다. 돈은 오간 적이 없으니
  // 정산서의 근거는 하나도 움직이지 않아야 한다 — 움직이면 창작자는 있지도
  // 않았던 환불을 통지받고, 사무국은 고칠 것이 없는 정산서를 다시 정리한다.
  const rejected = await hold(campaign, reward, 'rejected2')
  await pq.cancelPendingPledge(rejected.id, rejected.order_id)

  assert.equal(await sq.isSettlementStale(await sq.getSettlementByCampaign(campaign.id)), false)
  assert.equal((await sq.markSettlementPaid(campaign.id)).ok, true)
})

test('환불이 진행 중인 건(canceled + 결제 있음)은 환불로 센다 — 지급액을 크게 잡지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  const inflight = await paidPledge(campaign, reward)
  await pq.claimPledgeForCancel(String(inflight.id), {}) // 토스 취소 직전 상태

  const basis = await sq.computeSettlementBasis(campaign.id)
  assert.equal(basis.gross_amount, 20_000)
  assert.equal(basis.refund_amount, 10_000)
  assert.equal(basis.backer_count, 1)
})

// ---------------------------------------------------------------- 정리

test('마감되지 않은 캠페인은 정산서를 만들 수 없다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'campaign_not_closed')
  assert.equal(await sq.getSettlementByCampaign(campaign.id), null)
})

test('정산서는 저장하는 그 순간의 원장으로 계산한다 — 수수료율은 캠페인에 새긴 값', async () => {
  // 나누어떨어지지 않는 금액을 일부러 고른다 — 리워드 11,111원.
  const { campaign, reward } = await openCampaign({ platformFeeRate: 500, amount: 11_111 })
  await paidPledge(campaign, reward, 1_000) // 12,111
  await paidPledge(campaign, reward, 0) // 11,111
  const gone = await paidPledge(campaign, reward, 0) // 11,111 → 환불
  await refund(gone)
  await close(campaign)

  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: Number(campaign.platform_fee_rate),
    pg_fee_amount: 777,
  })
  assert.equal(result.ok, true)
  const s = result.settlement
  assert.equal(s.gross_amount, 34_333)
  assert.equal(s.refund_amount, 11_111)
  assert.equal(s.backer_count, 2)
  // 실 모금액 23,222 × 5% = 1,161.1 → 버림 1,161(올림이면 1,162로 조합이 1원 더 가져간다)
  assert.equal(s.platform_fee_amount, 1_161)
  assert.equal(s.pg_fee_amount, 777)
  assert.equal(s.payout_amount, 23_222 - 777 - 1_161)
  assert.equal(s.status, 'pending')
  assert.equal(s.paid_out_at, null)
})

test('지급액이 0원인 정산도 기록된다', async () => {
  const { campaign, reward } = await openCampaign({ platformFeeRate: 1000 })
  await paidPledge(campaign, reward) // 10,000
  await close(campaign)
  // 실 모금액 10,000 × 10% = 1,000. 남은 9,000을 결제대행 수수료가 다 먹는다.
  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 1000,
    pg_fee_amount: 9_000,
  })
  assert.equal(result.ok, true)
  assert.equal(result.settlement.payout_amount, 0)
})

test('지급액이 음수가 되는 정산서는 만들지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)
  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 10_001,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'compute')
  assert.equal(await sq.getSettlementByCampaign(campaign.id), null)
})

test('전액 환불된 캠페인도 실제로 나간 결제대행 수수료를 적을 수 있다', async () => {
  const { campaign, reward } = await openCampaign()
  const gone = await paidPledge(campaign, reward)
  await refund(gone)
  await close(campaign)

  // 실 모금액은 0이다. 그래도 결제대행사는 제 수수료를 대체로 돌려주지 않으니
  // 조합은 그 돈을 실제로 잃었다. 거부하면 사실인 수수료를 적을 길이 없어
  // "0원인 줄 알면서 0원을 넣는" 수밖에 없어진다.
  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 330,
  })
  assert.equal(result.ok, true)
  assert.equal(result.settlement.gross_amount, 10_000)
  assert.equal(result.settlement.refund_amount, 10_000)
  assert.equal(result.settlement.pg_fee_amount, 330)
  // 창작자에게서 되돌려 받을 것은 없다 — 지급액은 0이고 음수가 되지 않는다.
  assert.equal(result.settlement.payout_amount, 0)
  assert.equal(cooperativeLossFor(result.settlement), 330)
})

test('실 모금액이 남아 있으면 지급액을 음수로 만드는 수수료는 여전히 거부한다', async () => {
  // 위 예외는 "남은 돈이 0일 때"로 좁다. 1원이라도 남아 있으면 오타를 조용히
  // 0으로 깎지 않고 거부한다.
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)
  const result = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 10_001,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'compute')
})

test('정산서가 없으면 지급을 기록할 수 없고, 있으면 직전 금액을 함께 돌려준다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)

  const none = await sq.markSettlementPaid(campaign.id)
  assert.equal(none.ok, false)
  assert.equal(none.reason, 'not_found')

  const first = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(first.ok, true)
  assert.equal(first.created, true)
  // 처음 만든 정산서에는 '직전'이 없다 — 호출부는 이 null을 보고 알린다.
  assert.equal(first.previous_amounts, null)

  const again = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 1_000,
  })
  assert.equal(again.ok, true)
  // 직전 값은 트랜잭션 안에서 읽는다 — 같은 금액을 두 번 알리지 않기 위한 근거다.
  assert.equal(again.previous_amounts.payout_amount, 10_000)
  assert.equal(again.settlement.payout_amount, 9_000)
})

test('다시 정리하면 덮이기 전의 금액 한 벌과 달라진 칸이 남는다', async () => {
  const { campaign, reward } = await openCampaign({ platformFeeRate: 500 })
  await paidPledge(campaign, reward)
  const second = await paidPledge(campaign, reward)
  await close(campaign)

  const first = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 500,
    pg_fee_amount: 500,
  })
  assert.equal(first.ok, true)
  assert.equal(first.previous_amounts, null)
  const before = {
    gross_amount: first.amounts.gross_amount,
    refund_amount: first.amounts.refund_amount,
    backer_count: first.amounts.backer_count,
    pg_fee_amount: first.amounts.pg_fee_amount,
    platform_fee_amount: first.amounts.platform_fee_amount,
    payout_amount: first.amounts.payout_amount,
  }

  // 정리한 뒤 환불이 들어오고, 사무국이 결제대행 수수료를 고쳐 다시 정리한다.
  await refund(second)
  const again = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 500,
    pg_fee_amount: 700,
  })
  assert.equal(again.ok, true)
  assert.equal(again.created, false)

  // 사라질 뻔한 숫자가 통째로 손에 들어온다 — 활동 기록에 적히는 값이 이것이다.
  assert.deepEqual(again.previous_amounts, before)
  assert.notEqual(again.previous_amounts.payout_amount, again.amounts.payout_amount)

  const changed = changedSettlementFields(again.previous_amounts, again.amounts)
  assert.deepEqual(changed.sort(), [
    'backer_count',
    'payout_amount',
    'pg_fee_amount',
    'platform_fee_amount',
    'refund_amount',
  ])
  // 총 모금액은 "들어온 적 있는 돈"이라 환불에도 줄지 않는다.
  assert.equal(changed.includes('gross_amount'), false)
  // 바뀐 것이 없으면 목록도 비어 있다.
  assert.deepEqual(changedSettlementFields(again.amounts, again.amounts), [])
})

// ---------------------------------------------------------------- 정리 뒤 환불

test('정리한 뒤 환불이 들어오면 낡은 정산서가 되고, 그대로는 지급을 기록할 수 없다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  const late = await paidPledge(campaign, reward)
  await close(campaign)

  const prepared = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(prepared.ok, true)
  assert.equal(prepared.settlement.payout_amount, 20_000)
  assert.equal(await sq.isSettlementStale(prepared.settlement), false)

  // 정리가 끝난 **뒤에** 환불이 도착한다.
  await refund(late)
  assert.equal(await sq.isSettlementStale(await sq.getSettlementByCampaign(campaign.id)), true)

  const blocked = await sq.markSettlementPaid(campaign.id)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'stale')
  assert.equal(blocked.current.refund_amount, 10_000)
  // 막혔을 뿐 아니라 **아무것도 쓰지 않았다** — 낡은 금액이 지급으로 굳지 않는다.
  const still = await sq.getSettlementByCampaign(campaign.id)
  assert.equal(still.status, 'pending')
  assert.equal(still.payout_amount, 20_000)

  // 다시 정리하면 금액이 따라 움직이고, 그제야 지급을 기록할 수 있다.
  const again = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  assert.equal(again.ok, true)
  assert.equal(again.created, false)
  assert.equal(again.settlement.payout_amount, 10_000)
  const paid = await sq.markSettlementPaid(campaign.id)
  assert.equal(paid.ok, true)
  assert.equal(paid.settlement.status, 'paid')
  assert.ok(paid.settlement.paid_out_at)
})

// ---------------------------------------------------------------- 지급 뒤

test('지급을 기록한 정산서는 어떤 경로로도 움직이지 않는다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)
  await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 500,
  })
  assert.equal((await sq.markSettlementPaid(campaign.id)).ok, true)

  // ① 다시 정리 — 거절.
  const reprepare = await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 999_999,
  })
  assert.equal(reprepare.ok, false)
  assert.equal(reprepare.reason, 'already_paid')

  // ② 두 번째 지급 기록 — 거절.
  const twice = await sq.markSettlementPaid(campaign.id)
  assert.equal(twice.ok, false)
  assert.equal(twice.reason, 'already_paid')

  const stored = await sq.getSettlementByCampaign(campaign.id)
  assert.equal(stored.pg_fee_amount, 500)
  assert.equal(stored.payout_amount, 9_500)
  // ③ 지급 뒤에 환불이 들어와도 지급한 정산서는 낡았다고 하지 않는다 —
  //    그때의 숫자가 곧 사실이다.
  assert.equal(await sq.isSettlementStale(stored), false)
})

// ---------------------------------------------------------------- 전이 사전조건

test('정산 내역 없이는 정산 완료로 바꿀 수 없다', async () => {
  const { campaign, reward } = await openCampaign()
  await paidPledge(campaign, reward)
  await close(campaign)

  const none = await preq.checkActionPreconditions(campaign.id, 'settle')
  assert.equal(none.ok, false)
  assert.match(none.message, /정산 내역을 먼저 정리/)

  await sq.prepareSettlement({
    campaign_id: campaign.id,
    platform_fee_rate_bp: 0,
    pg_fee_amount: 0,
  })
  const unpaid = await preq.checkActionPreconditions(campaign.id, 'settle')
  assert.equal(unpaid.ok, false)
  assert.match(unpaid.message, /지급하지 않은/)

  await sq.markSettlementPaid(campaign.id)
  const ready = await preq.checkActionPreconditions(campaign.id, 'settle')
  assert.equal(ready.ok, true)
})

// ---------------------------------------------------------------- 라우트 배선

/**
 * 라우트 핸들러는 `next/headers` 요청 스코프에 묶여 있어 `node --test`에서
 * 직접 부를 수 없다(`notifyTriggers.test.mjs`가 이미 마주친 제약). 그래서
 * "무엇을 부르는가"는 소스 가드로 못박는다 — 알림 한 줄이 조용히 사라져도
 * 아무도 모르는 일을 이 저장소는 이미 한 번 겪었다.
 *
 * 주석 안의 문자열에 속지 않도록 먼저 주석을 걷어낸다(같은 파일의 관례).
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function routeSource(relative) {
  return stripComments(
    readFileSync(new URL(`../../src/app/api/${relative}`, import.meta.url), 'utf8')
  )
}

test('정산 라우트는 관리자만 통과시키고, 금액을 클라이언트에서 받지 않는다', () => {
  const src = routeSource('admin/funding/campaigns/[id]/settlement/route.ts')
  assert.match(src, /requireAdmin\(\)/)
  // 사람이 넣는 값은 결제대행 수수료와 메모뿐이다.
  assert.match(src, /body\.pg_fee_amount/)
  for (const derived of ['body.gross_amount', 'body.refund_amount', 'body.payout_amount']) {
    assert.ok(!src.includes(derived), `파생 값을 클라이언트에서 받는다: ${derived}`)
  }
  // 파생 값은 쿼리 계층이 다시 센다.
  assert.match(src, /prepareSettlement\(/)
  assert.match(src, /markSettlementPaid\(/)
})

test('정산 라우트는 정리·지급 때 개설자에게 알린다', () => {
  const src = routeSource('admin/funding/campaigns/[id]/settlement/route.ts')
  assert.match(src, /notifySettlementPrepared\(/)
  assert.match(src, /notifySettlementPaid\(/)
  // 같은 금액을 두 번 알리지 않는다 — 지급 예정 금액이 달라졌을 때만 다시 간다.
  assert.match(src, /payoutChanged/)
})

test('개설자 대시보드 라우트가 정산 내역을 함께 준다', () => {
  const src = routeSource('mypage/funding/campaigns/[id]/route.ts')
  assert.match(src, /getSettlementByCampaign\(/)
  assert.match(src, /isSettlementStale\(/)
  // 사무국 메모는 상대방에게 보내는 약속이 아니다.
  assert.ok(!/memo:\s*settlement\.memo/.test(src), '사무국 메모가 개설자에게 나간다')
})
