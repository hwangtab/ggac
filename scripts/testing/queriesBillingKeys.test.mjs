import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 자동결제 카드(빌링키) 저장소.
 *
 * 빌링키는 **카드번호와 같은 무게**의 값이다. 이 키와 구매자 식별값이 있으면
 * 언제든 그 카드로 결제를 걸 수 있고, 토스는 한 번 발급한 빌링키를 다시
 * 조회해 주지 않는다. 그래서 여기서 지키는 것은 두 가지다.
 *
 *  1. 회원당 활성 카드는 하나 — 두 장이 살아 있으면 어느 카드로 청구할지
 *     코드가 임의로 고르게 되고, 회원은 해지한 줄 아는 카드로 결제된다.
 *  2. 해지는 지우지 않고 비활성으로 남긴다 — "언제 해지했는가"가 분쟁의 근거다.
 */

const DB_PATH = 'scripts/testing/.queries-billing-test.db'
const MODULE_URL = new URL('../../src/db/queries/billingKeys.ts', import.meta.url)

async function loadFresh() {
  return import(`${MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  for (const [id, email] of [
    ['b-001', 'b1@test.local'],
    ['b-002', 'b2@test.local'],
  ]) {
    await setupClient.execute({
      sql: `INSERT INTO member_profiles
              (id, display_name, email, registration_status, is_active, monthly_fee, created_at, updated_at)
            VALUES (?, ?, ?, 'approved', 1, 30000, ?, ?)`,
      args: [id, '자동결제테스트', email, Date.now(), Date.now()],
    })
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

function cardInput(overrides = {}) {
  return {
    userId: 'b-001',
    billingKey: 'bk_secret_value_0001',
    customerKey: 'm_hashed_0001',
    cardIssuerCode: '61',
    cardNumberMasked: '43301234****123*',
    cardType: '신용',
    ...overrides,
  }
}

test('카드를 등록하면 활성 상태로 저장된다', async () => {
  const { saveBillingKey, getActiveBillingKey } = await loadFresh()
  await saveBillingKey(cardInput())

  const row = await getActiveBillingKey('b-001')
  assert.ok(row)
  assert.equal(row.billing_key, 'bk_secret_value_0001')
  assert.equal(row.customer_key, 'm_hashed_0001')
  assert.equal(row.card_number_masked, '43301234****123*')
  assert.equal(row.is_active, true)
})

test('등록한 적 없는 회원은 null이다', async () => {
  const { getActiveBillingKey } = await loadFresh()
  assert.equal(await getActiveBillingKey('b-002'), null)
})

test('카드를 새로 등록하면 이전 카드는 비활성이 된다', async () => {
  // 토스는 카드 교체를 지원하지 않는다 — 새 빌링키를 다시 발급받는 방식이다.
  // 두 장이 다 살아 있으면 어느 쪽으로 청구될지 알 수 없다.
  const { saveBillingKey, getActiveBillingKey, countBillingKeys } = await loadFresh()
  await saveBillingKey(
    cardInput({ userId: 'b-002', billingKey: 'bk_old', cardNumberMasked: '1111' })
  )
  await saveBillingKey(
    cardInput({ userId: 'b-002', billingKey: 'bk_new', cardNumberMasked: '2222' })
  )

  const active = await getActiveBillingKey('b-002')
  assert.equal(active.billing_key, 'bk_new')
  assert.equal(active.card_number_masked, '2222')

  // 이전 행은 지우지 않고 이력으로 남는다.
  assert.equal(await countBillingKeys('b-002'), 2)
})

test('해지하면 활성 카드가 사라지고 해지 시각이 남는다', async () => {
  const { saveBillingKey, deactivateBillingKey, getActiveBillingKey, listBillingKeyHistory } =
    await loadFresh()
  await saveBillingKey(cardInput({ userId: 'b-001', billingKey: 'bk_to_cancel' }))

  const deactivated = await deactivateBillingKey('b-001')

  assert.equal(await getActiveBillingKey('b-001'), null)
  assert.equal(
    deactivated.billing_key,
    'bk_to_cancel',
    '해지한 키를 돌려줘야 토스에도 삭제 요청할 수 있다'
  )
  const history = await listBillingKeyHistory('b-001')
  assert.ok(history[0].deactivated_at, '해지 시각이 분쟁의 근거가 된다')
})

test('활성 카드가 없는데 해지하면 null이다', async () => {
  const { deactivateBillingKey } = await loadFresh()
  assert.equal(await deactivateBillingKey('b-002-none'), null)
})

test('자동결제 대상자만 골라낸다', async () => {
  // 매월 청구 크론이 도는 경로. 해지한 회원이 섞이면 해지가 무의미해진다.
  const { saveBillingKey, deactivateBillingKey, listActiveBillingTargets } = await loadFresh()
  await saveBillingKey(cardInput({ userId: 'b-001', billingKey: 'bk_active_1' }))
  await saveBillingKey(cardInput({ userId: 'b-002', billingKey: 'bk_active_2' }))

  let targets = await listActiveBillingTargets()
  const ids = targets.map(t => t.user_id).sort()
  assert.deepEqual(ids, ['b-001', 'b-002'])
  assert.equal(
    targets[0].monthly_fee,
    30000,
    '청구 금액을 함께 실어야 크론이 회원마다 다시 조회하지 않는다'
  )

  await deactivateBillingKey('b-002')
  targets = await listActiveBillingTargets()
  assert.deepEqual(
    targets.map(t => t.user_id),
    ['b-001']
  )
})

test('승인되지 않은 회원은 자동결제 대상에서 빠진다', async () => {
  // 탈퇴·정지된 회원에게 계속 청구하면 그대로 분쟁이 된다.
  const { saveBillingKey, listActiveBillingTargets } = await loadFresh()
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, registration_status, is_active, monthly_fee, created_at, updated_at)
          VALUES ('b-003', '정지회원', 'b3@test.local', 'approved', 0, 30000, ?, ?)`,
    args: [Date.now(), Date.now()],
  })
  await saveBillingKey(cardInput({ userId: 'b-003', billingKey: 'bk_inactive_member' }))

  const targets = await listActiveBillingTargets()
  assert.equal(
    targets.some(t => t.user_id === 'b-003'),
    false
  )
})
