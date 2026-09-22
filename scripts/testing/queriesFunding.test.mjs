import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const DB_PATH = 'scripts/testing/.queries-funding-test.db'
const MODULE_URL = new URL('../../src/db/queries/funding.ts', import.meta.url)
let client
let q

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('u1','가','a@x.kr','approved',1)"
  )
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  q = await import(`${MODULE_URL.href}?t=${Date.now()}`)
})
after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

test('캠페인 생성은 draft이고 임시 slug를 가진다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '첫 음반',
    summary: '요약',
    goal_amount: 1_000_000,
  })
  assert.equal(c.status, 'draft')
  assert.match(c.slug, /^draft-[0-9a-f]{8}$/)
  assert.equal(c.owner_user_id, 'u1')
  assert.equal(typeof c.created_at, 'string')
})

test('전이는 기대 상태에서만 일어나고 승인 시 slug·수수료율을 새긴다', async () => {
  const c = await q.createCampaign({ owner_user_id: 'u1', title: 't', summary: 's', goal_amount: 1 })
  assert.equal(await q.transitionCampaign({ id: c.id, action: 'approve', expectedFrom: 'draft' }), null)
  const submitted = await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })
  assert.equal(submitted.status, 'submitted')
  assert.equal(typeof submitted.submitted_at, 'string')
  const active = await q.transitionCampaign({
    id: c.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: 'first-album',
    platformFeeRate: 300,
  })
  assert.equal(active.status, 'active')
  assert.equal(active.slug, 'first-album')
  assert.equal(active.platform_fee_rate, 300)
  // 이중 마감: 두 번째는 0행
  assert.equal((await q.transitionCampaign({ id: c.id, action: 'close', expectedFrom: 'active' })).status, 'closed')
  assert.equal(await q.transitionCampaign({ id: c.id, action: 'close', expectedFrom: 'active' }), null)
})

test('공개 목록은 active·closed·settled만', async () => {
  const all = await q.listPublicCampaigns()
  assert.ok(all.every(c => ['active', 'closed', 'settled'].includes(c.status)))
  assert.ok(all.some(c => c.slug === 'first-album'))
})

test('updateCampaignFields는 허용 키만 반영한다', async () => {
  const c = await q.createCampaign({ owner_user_id: 'u1', title: 't', summary: 's', goal_amount: 1 })
  const updated = await q.updateCampaignFields(c.id, { summary: '바뀜', status: 'active', platform_fee_rate: 999 })
  assert.equal(updated.summary, '바뀜')
  assert.equal(updated.status, 'draft')
  assert.equal(updated.platform_fee_rate, 0)
})

test('리워드 CRUD', async () => {
  const c = await q.createCampaign({ owner_user_id: 'u1', title: 't', summary: 's', goal_amount: 1 })
  const r = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000, total_quantity: 50 })
  assert.equal(r.locked_at, null)
  assert.equal((await q.listRewards(c.id)).length, 1)
  assert.equal(await q.deleteReward(r.id), true)
  assert.equal(await q.getReward(r.id), null)
})

test('진행률은 paid 후원만 센다', async () => {
  const c = await q.createCampaign({ owner_user_id: 'u1', title: 't', summary: 's', goal_amount: 1 })
  const r = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 1000 })
  const row = (code, status) =>
    client.execute(
      `INSERT INTO funding_pledges (id, pledge_code, campaign_id, reward_id, order_id, backer_name, backer_email, reward_title, unit_amount, quantity, additional_amount, total_amount, status) VALUES ('${code}','${code}','${c.id}','${r.id}','o_${code}','a','a@x.kr','CD',1000,2,500,2500,'${status}')`
    )
  await row('pp1', 'paid')
  await row('pp2', 'paid')
  await row('pp3', 'pending')
  await row('pp4', 'refunded')
  assert.deepEqual(await q.getCampaignProgress(c.id), { raised_amount: 5000, backer_count: 2 })
})
