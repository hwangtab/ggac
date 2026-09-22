// scripts/testing/fundingSchema.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 0022가 만든 표·인덱스가 원장 순서 적용으로 실제로 생기는지, 그리고
 * 후원 한 건이 주문 하나에만 묶이는 유일 제약이 실제로 막는지 본다.
 */
const DB_PATH = 'scripts/testing/.funding-schema-test.db'
let client

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
})
after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

async function tableNames() {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table'")
  return r.rows.map(x => x.name)
}
async function indexNames() {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='index'")
  return r.rows.map(x => x.name)
}

test('펀딩 표 넷이 생긴다', async () => {
  const names = await tableNames()
  for (const t of ['funding_campaigns', 'funding_rewards', 'funding_pledges', 'funding_settlements']) {
    assert.ok(names.includes(t), `${t} 없음`)
  }
})

test('조회를 덮는 인덱스가 생긴다', async () => {
  const names = await indexNames()
  for (const i of [
    'funding_campaigns_status_idx',
    'funding_campaigns_owner_idx',
    'funding_rewards_campaign_idx',
    'funding_pledges_campaign_status_idx',
    'funding_pledges_user_idx',
    'funding_pledges_hold_idx',
    'funding_pledges_reward_idx',
    'funding_pledges_order_id_idx',
  ]) {
    assert.ok(names.includes(i), `${i} 없음`)
  }
})

test('같은 주문번호로 후원 두 건을 만들 수 없다', async () => {
  await client.execute(
    "INSERT INTO funding_campaigns (id, slug, title, summary, story, category, goal_amount, status, platform_fee_rate) VALUES ('c1','c1','t','s','','기타',1000,'active',0)"
  )
  await client.execute(
    "INSERT INTO funding_rewards (id, campaign_id, title, amount, requires_shipping, sort_order) VALUES ('r1','c1','r',1000,0,0)"
  )
  const insert = code =>
    client.execute(
      `INSERT INTO funding_pledges (id, pledge_code, campaign_id, reward_id, order_id, backer_name, backer_email, reward_title, unit_amount, quantity, additional_amount, total_amount, status, is_anonymous, message_public, fulfillment_status, entry_source) VALUES ('${code}','${code}','c1','r1','funding_dup','a','a@x.kr','r',1000,1,0,1000,'pending',0,0,'none','online')`
    )
  await insert('p1')
  await assert.rejects(() => insert('p2'), /UNIQUE/)
})
