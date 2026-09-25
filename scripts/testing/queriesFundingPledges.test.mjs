import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const DB_PATH = 'scripts/testing/.queries-funding-pledges-test.db'
/** 동시 확정 테스트가 다른 커넥션으로 확정을 부르게 하는 자식 프로세스. */
const RACE_CHILD = `
const [dbPath, pledgesUrl, orderId, pledgeId] = process.argv.slice(-4)
process.env.TURSO_DATABASE_URL = 'file:' + dbPath
const pq = await import(pledgesUrl)
try {
  const row = await pq.finalizePledgePayment({ orderId, pledgeId, paymentKey: 'pk_rb', method: '카드', approvedAt: new Date(), raw: {} })
  process.stdout.write(JSON.stringify({ ok: row?.status ?? null }))
} catch (error) {
  process.stdout.write(JSON.stringify({ err: error?.name ?? String(error) }))
}
`
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)
let client, pq, pq2, fq, payq
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
  // 같은 파일 DB를 보는 **두 번째 커넥션**. 확정을 진짜로 겹쳐 돌리려면
  // 트랜잭션이 서로 다른 커넥션에서 시작해야 한다 — 한 커넥션에서 두
  // 트랜잭션을 겹치면 BEGIN이 겹쳐 연결 자체가 잠긴 채 남는다(실측).
  pq2 = await import(`${PLEDGES_URL.href}?t=${t}&conn=2`)
  fq = await import(`${FUNDING_URL.href}?t=${t}`)
  payq = await import(`${PAYMENTS_URL.href}?t=${t}`)
  campaign = await fq.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'c',
  })
  limited = await fq.createReward({
    campaign_id: campaign.id,
    title: '한정',
    amount: 10000,
    total_quantity: 3,
  })
  unlimited = await fq.createReward({ campaign_id: campaign.id, title: '무제한', amount: 5000 })
})
after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

async function hold(orderId, rewardId, quantity, extra = {}) {
  const { reward: rewardOverride, campaign_id: campaignOverride, ...input } = extra
  const reward = rewardOverride ?? (rewardId === limited.id ? limited : unlimited)
  const additionalAmount = input.additional_amount ?? 0
  // 결제 원장 금액을 후원 총액과 같게 둔다 — 실제로는 항상 같은 값이고,
  // 이게 어긋나 있으면(예: 1원 고정) 환불의 전액/부분 분기 경계를
  // 아무 테스트도 지나가지 않는다.
  const amount = reward.amount * quantity + additionalAmount
  await payq.createPendingPayment({
    orderId,
    userId: null,
    kind: 'funding',
    orderName: 'x',
    amount,
  })
  return pq.holdPledge({
    order_id: orderId,
    campaign_id: campaignOverride ?? campaign.id,
    reward_id: rewardId,
    user_id: null,
    quantity,
    additional_amount: additionalAmount,
    ...backer,
    // 선점의 임자는 회원이면 계정, 비회원이면 이메일이다. 주문마다 다른
    // 기본 이메일을 두어야 "서로 다른 후원자"가 된다 — 같은 이메일이면
    // 뒤 선점이 앞 선점을 갈아 버리므로, 매진을 단언하려던 테스트가
    // 실제로는 자기 선점을 비우고 성공해 버린다.
    backer_email: `${orderId}@x.kr`,
    ...input,
  })
}

test('선점은 pending이며 재고를 줄인다; 초과는 매진', async () => {
  const p1 = await hold('funding_a', limited.id, 2)
  assert.equal(p1.status, 'pending')
  assert.match(p1.pledge_code, /^FND-/)
  assert.equal(p1.total_amount, 20000)
  assert.equal(await pq.getRemainingQuantity(limited.id), 1)
  await assert.rejects(
    () => hold('funding_b', limited.id, 2),
    e => e instanceof pq.RewardSoldOutError && e.remaining === 1
  )
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
    orderId: 'funding_cross_b',
    pledgeId: a.id,
    paymentKey: 'pk_x',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  assert.equal(result, null)
  assert.equal((await pq.getPledgeById(a.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(b.id)).status, 'pending')
})

test('확정은 주문·후원 짝이 맞을 때만, 결제와 리워드 잠금을 함께', async () => {
  const p = await hold('funding_c', limited.id, 1)
  const ok = await pq.finalizePledgePayment({
    orderId: 'funding_c',
    pledgeId: p.id,
    paymentKey: 'pk_c',
    method: '카드',
    approvedAt: new Date(),
    raw: { a: 1 },
  })
  assert.equal(ok.status, 'paid')
  assert.equal(typeof ok.paid_at, 'string')
  const payment = await payq.getPaymentByOrderId('funding_c')
  assert.equal(payment.status, 'done')
  assert.equal(ok.payment_id, payment.id)
  assert.ok((await fq.getReward(limited.id)).locked_at)
  // 새로고침: 같은 주문으로 다시 확정하면 같은 행
  const again = await pq.finalizePledgePayment({
    orderId: 'funding_c',
    pledgeId: p.id,
    paymentKey: 'pk_c',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
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
    orderId: 'funding_c',
    paymentId: payment.id,
    pledgeId: p.id,
    canceledAmount: 10000,
    raw: {},
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
  await pq.finalizePledgePayment({
    orderId: 'funding_partial',
    pledgeId: p.id,
    paymentKey: 'pk_partial',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  await pq.claimPledgeForCancel(p.id, {})
  const payment = await payq.getPaymentByOrderId('funding_partial')
  await assert.rejects(
    () =>
      pq.finalizePledgeRefund({
        orderId: 'funding_partial',
        paymentId: payment.id,
        pledgeId: p.id,
        canceledAmount: payment.amount - 1000,
        raw: {},
      }),
    e => e instanceof pq.PartialRefundUnsupportedError && e.totalAmount === payment.amount
  )
  // 아무것도 쓰이지 않았어야 한다 — 후원도, 원장도 그대로.
  assert.equal((await pq.getPledgeById(p.id)).status, 'canceled')
  assert.equal((await payq.getPaymentByOrderId('funding_partial')).canceled_amount, 0)
})

test('환불 원장의 누적 취소액은 뒤에 온 더 작은 값으로 줄어들지 않는다', async () => {
  const p = await hold('funding_stale', unlimited.id, 1)
  await pq.finalizePledgePayment({
    orderId: 'funding_stale',
    pledgeId: p.id,
    paymentKey: 'pk_stale',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  await pq.claimPledgeForCancel(p.id, {})
  const payment = await payq.getPaymentByOrderId('funding_stale')
  const full = await pq.finalizePledgeRefund({
    orderId: 'funding_stale',
    paymentId: payment.id,
    pledgeId: p.id,
    canceledAmount: payment.amount,
    raw: {},
  })
  assert.equal(full.status, 'refunded')
  assert.equal((await payq.getPaymentByOrderId('funding_stale')).canceled_amount, payment.amount)
  // 뒤늦게 도착한, 더 작은 누적값을 담은 재전송. 원장이 뒷걸음질하면 안 된다.
  await assert.rejects(() =>
    pq.finalizePledgeRefund({
      orderId: 'funding_stale',
      paymentId: payment.id,
      pledgeId: p.id,
      canceledAmount: payment.amount - 1000,
      raw: {},
    })
  )
  assert.equal((await payq.getPaymentByOrderId('funding_stale')).canceled_amount, payment.amount)
})

test('정확히 남은 수량만큼 선점하면 성공하고 재고는 0이 된다', async () => {
  const boundary = await fq.createReward({
    campaign_id: campaign.id,
    title: '경계',
    amount: 1000,
    total_quantity: 2,
  })
  const p = await hold('funding_boundary', boundary.id, 2)
  assert.equal(p.status, 'pending')
  assert.equal(await pq.getRemainingQuantity(boundary.id), 0)
})

test('비회원 조회는 번호+이메일, 공개 명단은 익명·비공개 메시지를 가리고 미확정 후원은 아예 빠진다', async () => {
  const p = await hold('funding_e', unlimited.id, 1, { is_anonymous: true, message_public: false })
  await pq.finalizePledgePayment({
    orderId: 'funding_e',
    pledgeId: p.id,
    paymentKey: 'pk_e',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  assert.equal(await pq.getPledgeByCodeAndEmail(p.pledge_code, 'nope@x.kr'), null)
  assert.equal((await pq.getPledgeByCodeAndEmail(p.pledge_code, 'FUNDING_E@X.KR')).id, p.id)

  // 아직 결제하지 않은 후원(pending)의 후원자 정보는 절대 공개되면 안 된다.
  const pending = await hold('funding_pending_hidden', unlimited.id, 1, {
    backer_name: '숨은후원자',
  })

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

test('recordPaymentKey는 pending 행에만 식별자를 새기고 settled 행은 건드리지 않는다', async () => {
  const p = await hold('funding_record_key', unlimited.id, 1)
  await payq.recordPaymentKey('funding_record_key', 'pk_early')
  assert.equal((await payq.getPaymentByOrderId('funding_record_key')).payment_key, 'pk_early')

  await pq.finalizePledgePayment({
    orderId: 'funding_record_key',
    pledgeId: p.id,
    paymentKey: 'pk_early',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  assert.equal((await payq.getPaymentByOrderId('funding_record_key')).status, 'done')

  // 이미 done인 행에 다른 식별자를 쓰려 해도 무시된다 — 정본은 첫 확정이다.
  await payq.recordPaymentKey('funding_record_key', 'pk_late_overwrite_attempt')
  assert.equal((await payq.getPaymentByOrderId('funding_record_key')).payment_key, 'pk_early')
})

// ── 결제 없는 선점만으로 한정 리워드를 매진시키던 것 ──────────────────────

test('같은 사람이 같은 리워드를 다시 선점해도 앞의 선점은 그대로 남는다 — 선물 두 건이 된다', async () => {
  const r = await fq.createReward({
    campaign_id: campaign.id,
    title: '교체',
    amount: 1000,
    total_quantity: 3,
  })
  const first = await hold('funding_swap_1', r.id, 1, { reward: r, backer_email: 'same@x.kr' })
  assert.equal(await pq.getRemainingQuantity(r.id), 2)

  // 대소문자만 다른 같은 이메일 = 같은 신원. 그래도 앞 선점을 덮지 않는다 —
  // 배송지가 다른 두 사람에게 같은 리워드를 보내는 것이 정상 후원이다.
  const second = await hold('funding_swap_2', r.id, 1, { reward: r, backer_email: 'SAME@x.kr' })
  assert.equal((await pq.getPledgeById(first.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(second.id)).status, 'pending')
  assert.equal(await pq.getRemainingQuantity(r.id), 1)

  // 다른 사람의 선점도 그대로 쌓인다.
  const other = await hold('funding_swap_3', r.id, 1, { reward: r, backer_email: 'other@x.kr' })
  assert.equal((await pq.getPledgeById(other.id)).status, 'pending')
  assert.equal(await pq.getRemainingQuantity(r.id), 0)
})

test('한 리워드에 한 신원이 들 수 있는 선점 수에는 상한이 있다', async () => {
  const r = await fq.createReward({ campaign_id: campaign.id, title: '리워드상한', amount: 1000 })
  for (let i = 0; i < pq.MAX_HOLDS_PER_REWARD; i++) {
    const p = await hold(`funding_rcap_${i}`, r.id, 1, { reward: r, backer_email: 'rcap@x.kr' })
    assert.equal(p.status, 'pending')
  }
  await assert.rejects(
    () => hold('funding_rcap_over', r.id, 1, { reward: r, backer_email: 'RCAP@x.kr' }),
    e =>
      e instanceof pq.TooManyPendingHoldsError &&
      e.scope === 'reward' &&
      e.limit === pq.MAX_HOLDS_PER_REWARD &&
      // 후원자가 할 수 있는 일이 문장 안에 있어야 한다.
      /수량을 늘리/.test(e.message)
  )
  // 다른 사람은 막히지 않는다.
  const stranger = await hold('funding_rcap_other', r.id, 1, {
    reward: r,
    backer_email: 'notrcap@x.kr',
  })
  assert.equal(stranger.status, 'pending')
})

// ── 갈아 끼우기가 승인된 결제를 스윕의 눈에서 지우던 것 ────────────────────

test('결제가 떠 있을지 모르는 선점은 같은 사람이 다시 선점해도 만료 스윕이 계속 본다', async () => {
  const r = await fq.createReward({
    campaign_id: campaign.id,
    title: '유실복구',
    amount: 1000,
    total_quantity: 5,
  })
  // 토스는 승인했는데 우리 쪽 확정이 유실된 상태를 그대로 둔다 — 후원은
  // 아직 `pending`이고, 라우트는 후원자에게 503 "결제 결과를 확인하는
  // 중입니다"라고 답한 참이다.
  const inFlight = await hold('funding_sweep_1', r.id, 1, {
    reward: r,
    backer_email: 'sweep@x.kr',
  })
  // 그 말을 들은 후원자가 가장 자연스럽게 하는 일: 같은 리워드를 다시 후원.
  const retry = await hold('funding_sweep_2', r.id, 1, { reward: r, backer_email: 'sweep@x.kr' })
  assert.notEqual(inFlight.id, retry.id)
  // 앞 선점이 살아 있어야 한다. 갈아 끼우던 때는 여기서 'expired'였다.
  assert.equal((await pq.getPledgeById(inFlight.id)).status, 'pending')

  // 선점 시간이 지나 스윕이 도는 시점.
  await client.execute({
    sql: 'UPDATE funding_pledges SET hold_expires_at = ? WHERE id = ?',
    args: [Date.now() - 60_000, inFlight.id],
  })
  const swept = await pq.listExpiredHolds(new Date())
  // 스윕은 `pending`만 고른다. 갈아 끼우던 때는 이 목록에 없었고, 그래서
  // 승인된 결제가 아무에게도 환불되지 않은 채 남았다.
  assert.ok(
    swept.some(p => p.id === inFlight.id),
    '결제가 떠 있을지 모르는 선점이 만료 스윕 목록에서 사라졌다'
  )
})

test('회원 선점과 비회원 선점은 섞이지 않는다 — 남의 이메일로 남의 선점을 비울 수 없다', async () => {
  const r = await fq.createReward({
    campaign_id: campaign.id,
    title: '임자',
    amount: 1000,
    total_quantity: 3,
  })
  const member = await pq.holdPledge({
    order_id: 'funding_owner_member',
    campaign_id: campaign.id,
    reward_id: r.id,
    user_id: 'u1',
    quantity: 1,
    additional_amount: 0,
    ...backer,
    backer_email: 'member@x.kr',
  })
  const guest = await hold('funding_owner_guest', r.id, 1, {
    reward: r,
    backer_email: 'member@x.kr',
  })
  // 같은 이메일이어도 회원의 선점은 건드리지 못한다.
  assert.equal((await pq.getPledgeById(member.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(guest.id)).status, 'pending')
  assert.equal(await pq.getRemainingQuantity(r.id), 1)

  // 회원이 다시 선점해도 자기 앞 선점을 덮지 않는다 — 셋 다 살아 있다.
  const again = await pq.holdPledge({
    order_id: 'funding_owner_member2',
    campaign_id: campaign.id,
    reward_id: r.id,
    user_id: 'u1',
    quantity: 1,
    additional_amount: 0,
    ...backer,
    backer_email: 'member@x.kr',
  })
  assert.equal((await pq.getPledgeById(member.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(again.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(guest.id)).status, 'pending')
  assert.equal(await pq.getRemainingQuantity(r.id), 0)
})

test('한 프로젝트에 한 신원이 동시에 들 수 있는 선점 수에는 상한이 있다', async () => {
  const rewards = []
  for (let i = 0; i < pq.MAX_OUTSTANDING_HOLDS + 1; i++) {
    rewards.push(
      await fq.createReward({ campaign_id: campaign.id, title: `상한${i}`, amount: 1000 })
    )
  }
  const held = []
  for (let i = 0; i < pq.MAX_OUTSTANDING_HOLDS; i++) {
    held.push(
      await hold(`funding_cap_${i}`, rewards[i].id, 1, {
        reward: rewards[i],
        backer_email: 'cap@x.kr',
      })
    )
  }
  await assert.rejects(
    () =>
      hold('funding_cap_over', rewards[pq.MAX_OUTSTANDING_HOLDS].id, 1, {
        reward: rewards[pq.MAX_OUTSTANDING_HOLDS],
        backer_email: 'cap@x.kr',
      }),
    e =>
      e instanceof pq.TooManyPendingHoldsError &&
      e.scope === 'campaign' &&
      e.limit === pq.MAX_OUTSTANDING_HOLDS
  )
  // 다른 사람은 영향을 받지 않는다.
  const stranger = await hold('funding_cap_other', rewards[0].id, 1, {
    reward: rewards[0],
    backer_email: 'nocap@x.kr',
  })
  assert.equal(stranger.status, 'pending')

  // 앞 선점 하나가 만료되면 자리가 다시 난다.
  await client.execute({
    sql: 'UPDATE funding_pledges SET hold_expires_at = ? WHERE id = ?',
    args: [Date.now() - 60_000, held[0].id],
  })
  const now = await hold('funding_cap_after', rewards[pq.MAX_OUTSTANDING_HOLDS].id, 1, {
    reward: rewards[pq.MAX_OUTSTANDING_HOLDS],
    backer_email: 'cap@x.kr',
  })
  assert.equal(now.status, 'pending')
})

test('상한은 프로젝트별로 센다 — 다른 프로젝트를 견주어 보던 선점이 후원을 막지 않는다', async () => {
  const other = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '다른 프로젝트',
    summary: 's',
    goal_amount: 1,
  })
  await fq.transitionCampaign({ id: other.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({
    id: other.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'c2',
  })
  // 첫 프로젝트에서 상한을 꽉 채운다.
  for (let i = 0; i < pq.MAX_OUTSTANDING_HOLDS; i++) {
    const r = await fq.createReward({ campaign_id: campaign.id, title: `건너${i}`, amount: 1000 })
    await hold(`funding_xcap_${i}`, r.id, 1, { reward: r, backer_email: 'xcap@x.kr' })
  }
  // 그래도 다른 프로젝트에는 후원할 수 있다. 전체로 세던 때는 여기서 막혔다.
  const r2 = await fq.createReward({ campaign_id: other.id, title: '다른리워드', amount: 1000 })
  const p = await hold('funding_xcap_other', r2.id, 1, {
    reward: r2,
    campaign_id: other.id,
    backer_email: 'xcap@x.kr',
  })
  assert.equal(p.status, 'pending')
})

// ── 마지막 재고가 두 번 팔리던 것 ─────────────────────────────────────────

test('선점이 만료된 사이에 팔린 수량은 뒤늦은 확정으로 되찾지 못한다', async () => {
  const r = await fq.createReward({
    campaign_id: campaign.id,
    title: '마지막하나',
    amount: 1000,
    total_quantity: 1,
  })
  const late = await hold('funding_late', r.id, 1, { reward: r, backer_email: 'late@x.kr' })
  // 선점이 만료된다 — 라우트의 만료 검사를 통과한 직후 토스 승인이 오가는
  // 몇 초를 재현한다.
  await client.execute({
    sql: 'UPDATE funding_pledges SET hold_expires_at = ? WHERE id = ?',
    args: [Date.now() - 1000, late.id],
  })
  const winner = await hold('funding_winner', r.id, 1, { reward: r, backer_email: 'winner@x.kr' })
  const paid = await pq.finalizePledgePayment({
    orderId: 'funding_winner',
    pledgeId: winner.id,
    paymentKey: 'pk_winner',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  assert.equal(paid.status, 'paid')

  // 뒤늦게 도착한 승인. 고치기 전에는 그대로 확정돼 하나뿐인 수량이 둘에게 팔렸다.
  await assert.rejects(
    () =>
      pq.finalizePledgePayment({
        orderId: 'funding_late',
        pledgeId: late.id,
        paymentKey: 'pk_late',
        method: '카드',
        approvedAt: new Date(),
        raw: {},
      }),
    e => e instanceof pq.PledgeStockUnavailableError && e.reason === 'sold_out'
  )
  // 아무것도 쓰이지 않았어야 한다 — 후원도 원장도 그대로다.
  assert.equal((await pq.getPledgeById(late.id)).status, 'pending')
  assert.equal((await pq.getPledgeById(late.id)).payment_id, null)
  assert.equal((await payq.getPaymentByOrderId('funding_late')).status, 'pending')
  assert.equal(await pq.getRemainingQuantity(r.id), 0)
})

test('마감된 프로젝트의 승인은 확정되지 않는다 — 크론이 열 분 뒤에 승격시켜도 마찬가지다', async () => {
  const closing = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '마감될 프로젝트',
    summary: 's',
    goal_amount: 1,
  })
  await fq.transitionCampaign({ id: closing.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({
    id: closing.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'closing',
  })
  const r = await fq.createReward({ campaign_id: closing.id, title: '무제한', amount: 1000 })
  const p = await hold('funding_closed', r.id, 1, {
    reward: r,
    campaign_id: closing.id,
    backer_email: 'closed@x.kr',
  })
  await fq.transitionCampaign({ id: closing.id, action: 'close', expectedFrom: 'active' })

  await assert.rejects(
    () =>
      pq.finalizePledgePayment({
        orderId: 'funding_closed',
        pledgeId: p.id,
        paymentKey: 'pk_closed',
        method: '카드',
        approvedAt: new Date(),
        raw: {},
      }),
    e => e instanceof pq.PledgeStockUnavailableError && e.reason === 'campaign_closed'
  )
  assert.equal((await pq.getPledgeById(p.id)).status, 'pending')
  assert.equal((await payq.getPaymentByOrderId('funding_closed')).status, 'pending')
})

test('이미 확정된 후원의 재확인은 마감 뒤에도 성공으로 답한다 — 끝난 결제를 환불하게 만들지 않는다', async () => {
  const closing = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '나중에 마감',
    summary: 's',
    goal_amount: 1,
  })
  await fq.transitionCampaign({ id: closing.id, action: 'submit', expectedFrom: 'draft' })
  await fq.transitionCampaign({
    id: closing.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'closing-2',
  })
  const r = await fq.createReward({
    campaign_id: closing.id,
    title: '무제한',
    amount: 1000,
    total_quantity: 1,
  })
  const p = await hold('funding_idem', r.id, 1, {
    reward: r,
    campaign_id: closing.id,
    backer_email: 'idem@x.kr',
  })
  await pq.finalizePledgePayment({
    orderId: 'funding_idem',
    pledgeId: p.id,
    paymentKey: 'pk_idem',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  await fq.transitionCampaign({ id: closing.id, action: 'close', expectedFrom: 'active' })

  const again = await pq.finalizePledgePayment({
    orderId: 'funding_idem',
    pledgeId: p.id,
    paymentKey: 'pk_idem',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  assert.equal(again.status, 'paid')
  assert.equal(again.id, p.id)
})

// 파일 맨 뒤에 둔다 — 두 커넥션이 같은 파일을 두고 겨루므로, 뒤에 오는
// 테스트가 잠금 경합에 휘말리지 않게 한다.
test('마지막 하나를 두 승인이 동시에 확정하려 하면 한 쪽만 팔린다', async () => {
  const r = await fq.createReward({
    campaign_id: campaign.id,
    title: '동시확정',
    amount: 1000,
    total_quantity: 1,
  })
  const a = await hold('funding_race_a', r.id, 1, { reward: r, backer_email: 'race_a@x.kr' })
  // a의 선점이 만료돼 b가 같은 자리를 잡았고, 바로 그때 a의 토스 승인이
  // 돌아온다 — 감사가 지적한 그 창이다.
  await client.execute({
    sql: 'UPDATE funding_pledges SET hold_expires_at = ? WHERE id = ?',
    args: [Date.now() - 1000, a.id],
  })
  const b = await hold('funding_race_b', r.id, 1, { reward: r, backer_email: 'race_b@x.kr' })

  // b의 확정은 **다른 프로세스**에서 돌린다. 한 프로세스 안에서는 쿼리 계층이
  // 커넥션 하나를 공유하므로(`src/db/client.ts`가 모듈 수준에서 캐시한다)
  // 트랜잭션 두 개가 겹치면 BEGIN이 겹쳐 연결이 잠긴 채 남는다 — 그건 이
  // 저장소의 실제 운영(Turso 서버가 요청마다 따로 받는다)과 다른 모양이다.
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      RACE_CHILD,
      '--',
      DB_PATH,
      PLEDGES_URL.href,
      'funding_race_b',
      b.id,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let childOut = ''
  child.stdout.on('data', chunk => (childOut += chunk))
  let childErr = ''
  child.stderr.on('data', chunk => (childErr += chunk))
  const childDone = new Promise(resolve => child.on('close', resolve))

  const mine = await pq
    .finalizePledgePayment({
      orderId: 'funding_race_a',
      pledgeId: a.id,
      paymentKey: 'pk_ra',
      method: '카드',
      approvedAt: new Date(),
      raw: {},
    })
    .then(value => ({ ok: value?.status }))
    .catch(error => ({ err: error?.name }))
  await childDone
  const theirs = JSON.parse(childOut.trim() || '{}')
  assert.ok(theirs.ok || theirs.err, `자식 프로세스가 아무 답도 주지 않았다: ${childErr}`)

  const statuses = [(await pq.getPledgeById(a.id)).status, (await pq.getPledgeById(b.id)).status]
  // 하나뿐인 수량이다. 고치기 전에는 둘 다 paid가 됐다.
  assert.equal(
    statuses.filter(st => st === 'paid').length,
    1,
    `두 후원의 상태: ${statuses.join(', ')} / 내 결과: ${JSON.stringify(mine)} / 자식 결과: ${JSON.stringify(theirs)}`
  )
  assert.equal(await pq.getRemainingQuantity(r.id), 0)
  // 진 쪽은 "확정했다"고 답하지 않는다 — 부르는 쪽이 환불할 수 있게 던진다.
  const loser = [mine, theirs].find(x => !x.ok)
  assert.equal(loser.err, 'PledgeStockUnavailableError')
})

test('크레딧 명단은 결제된 후원의 기재할 이름만 가나다순으로 나눠 준다 — 익명 후원이어도 싣는다', async () => {
  const credited = await fq.createReward({
    campaign_id: campaign.id,
    title: '이름 기재',
    amount: 10000,
    requires_credit_name: true,
  })
  assert.equal(credited.requires_credit_name, true)
  assert.equal(unlimited.requires_credit_name, false)

  const paid = await hold('funding_credit_paid', credited.id, 2, {
    reward: credited,
    is_anonymous: true,
    credit_name: '하늘, 가람',
  })
  await pq.finalizePledgePayment({
    orderId: 'funding_credit_paid',
    pledgeId: paid.id,
    paymentKey: 'pk_credit',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  await hold('funding_credit_pending', credited.id, 1, {
    reward: credited,
    credit_name: '미결제',
  })

  assert.equal((await pq.getPledgeById(paid.id)).credit_name, '하늘, 가람')
  const names = await pq.listCreditNames(campaign.id)
  assert.deepEqual(names, ['가람', '하늘'])
})
