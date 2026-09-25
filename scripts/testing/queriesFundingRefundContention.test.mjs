import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 환불 확정이 쓰기 잠금 경합에 **물러나지 않는지**를 진짜 경합으로 본다.
 *
 * ## 왜 두 번째 커넥션인가
 *
 * 한 프로세스가 커넥션 하나를 나눠 쓰면 경합이 생기지 않는다 — 문장이 차례로
 * 실행될 뿐이다. SQLite의 `SQLITE_BUSY`는 **서로 다른 커넥션**이 같은 파일의
 * 쓰기 잠금을 다툴 때 나온다. 그래서 여기서는 두 번째 커넥션(`blocker`)이
 * 쓰기 트랜잭션을 연 채로 붙들고 있는 동안 `finalizePledgeRefund`를 부른다.
 *
 * ## 왜 "성공한다"가 아니라 "여러 번 다시 해 본다"를 단언하는가
 *
 * 로컬 `file:` 드라이버에는 실측된 결함이 있다 — `BEGIN IMMEDIATE`가 한 번
 * `SQLITE_BUSY`로 실패하면 **그 커넥션이 영구히 잠긴 것처럼 남는다.** 잠금을
 * 쥔 쪽이 커밋한 뒤에도, 심지어 새로 연 세 번째 커넥션에서도 그 뒤의 모든
 * 트랜잭션이 `SQLITE_BUSY`다. 운영은 원격 Turso(HTTP)라 이 결함과 무관하지만,
 * 그 탓에 로컬에서는 "다시 해서 성공한다"를 재현할 수 없다. 그래서 관측할 수
 * 있는 것을 관측한다 — **몇 번 다시 해 봤는가.** 고치기 전에는 정확히 한 번이고
 * (재시도 자체가 없었다), 고친 뒤에는 돈이 걸린 예산만큼이다.
 *
 * 이 경합은 DB 파일을 못 쓰게 만들기 때문에 이 파일은 **테스트 하나만** 담는다.
 */

const DB_PATH = 'scripts/testing/.queries-funding-refund-contention.db'
const PLEDGES_URL = new URL('../../src/db/queries/fundingPledges.ts', import.meta.url)
const FUNDING_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
const PAYMENTS_URL = new URL('../../src/db/queries/payments.ts', import.meta.url)
const HELPERS_URL = new URL('../../src/db/queries/_helpers.ts', import.meta.url)
const CLIENT_URL = new URL('../../src/db/client.ts', import.meta.url)

let client, pq, fq, payq, helpers, dbModule
let paidPledge, payment

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
  helpers = await import(`${HELPERS_URL.href}?t=${t}`)
  dbModule = await import(`${CLIENT_URL.href}?t=${t}`)

  const campaign = await fq.createCampaign({
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
  const reward = await fq.createReward({
    campaign_id: campaign.id,
    title: '음반',
    amount: 10000,
  })
  await payq.createPendingPayment({
    orderId: 'funding_busy',
    userId: null,
    kind: 'funding',
    orderName: 'x',
    amount: 10000,
  })
  paidPledge = await pq.holdPledge({
    order_id: 'funding_busy',
    campaign_id: campaign.id,
    reward_id: reward.id,
    user_id: null,
    quantity: 1,
    additional_amount: 0,
    backer_name: '후원자',
    backer_email: 'busy@x.kr',
    backer_phone: '01012345678',
    is_anonymous: false,
    message_public: false,
    terms_version: 'v1',
  })
  await pq.finalizePledgePayment({
    orderId: 'funding_busy',
    pledgeId: paidPledge.id,
    paymentKey: 'pk_busy',
    method: '카드',
    approvedAt: new Date(),
    raw: {},
  })
  await pq.claimPledgeForCancel(paidPledge.id, {})
  payment = await payq.getPaymentByOrderId('funding_busy')
})

after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

test('환불 확정은 경합 한 번에 물러나지 않는다 — 돈은 이미 나간 뒤다', async () => {
  // 다른 커넥션이 쓰기 잠금을 쥔다.
  const blocker = await client.transaction('write')
  await blocker.execute({
    sql: 'UPDATE member_profiles SET display_name = ? WHERE id = ?',
    args: ['나', 'u1'],
  })

  const proto = dbModule.db.constructor.prototype
  const original = proto.transaction
  let attempts = 0
  proto.transaction = function counted(...args) {
    attempts += 1
    return original.apply(this, args)
  }
  try {
    await assert.rejects(
      () =>
        pq.finalizePledgeRefund({
          orderId: 'funding_busy',
          paymentId: payment.id,
          pledgeId: paidPledge.id,
          canceledAmount: payment.amount,
          raw: {},
        }),
      error => helpers.isLockContention(error)
    )
  } finally {
    proto.transaction = original
    try {
      await blocker.rollback()
    } catch {
      // 잠금 경합으로 이미 못 쓰는 트랜잭션일 수 있다. 정리 실패는 삼킨다.
    }
  }

  assert.equal(
    attempts,
    helpers.MONEY_PATH_RETRY_BUDGET.attempts,
    `환불 확정이 ${attempts}번만 시도했다 — 경합 한 번에 물러나면 돈은 나갔는데 원장에 환불이 없다`
  )
})
