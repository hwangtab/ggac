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
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  assert.equal(
    await q.transitionCampaign({ id: c.id, action: 'approve', expectedFrom: 'draft' }),
    null
  )
  const submitted = await q.transitionCampaign({
    id: c.id,
    action: 'submit',
    expectedFrom: 'draft',
  })
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
  assert.equal(
    (await q.transitionCampaign({ id: c.id, action: 'close', expectedFrom: 'active' })).status,
    'closed'
  )
  assert.equal(
    await q.transitionCampaign({ id: c.id, action: 'close', expectedFrom: 'active' }),
    null
  )
})

test('공개 목록은 active·closed·settled만', async () => {
  const all = await q.listPublicCampaigns()
  assert.ok(all.every(c => ['active', 'closed', 'settled'].includes(c.status)))
  assert.ok(all.some(c => c.slug === 'first-album'))
})

test('updateCampaignFields는 허용 키만 반영한다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const updated = await q.updateCampaignFields(c.id, {
    summary: '바뀜',
    status: 'active',
    platform_fee_rate: 999,
  })
  assert.equal(updated.summary, '바뀜')
  assert.equal(updated.status, 'draft')
  assert.equal(updated.platform_fee_rate, 0)
})

test('리워드 CRUD', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const r = await q.createReward({
    campaign_id: c.id,
    title: 'CD',
    amount: 30000,
    total_quantity: 50,
  })
  assert.equal(r.locked_at, null)
  assert.equal((await q.listRewards(c.id)).length, 1)
  assert.equal(await q.deleteReward(r.id), true)
  assert.equal(await q.getReward(r.id), null)
})

test('진행률은 paid 후원만 센다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
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

/**
 * 아래 네 건은 "편집 범위를 정한 뒤 상태가 움직인" 경합을 쿼리 계층에서 직접
 * 재현한다. 라우트가 본문을 먼저 읽도록 순서를 바로잡아도 판정과 쓰기 사이의
 * 창은 남으므로, 마지막 방어선은 쓰기 조건이어야 한다.
 */
test('updateCampaignFields는 판정 근거 상태가 바뀌면 아무것도 쓰지 않는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '원래 제목',
    summary: 's',
    goal_amount: 1000,
  })
  // 라우트가 draft를 보고 범위를 `all`로 정한 사이, 다른 요청이 제출했다.
  await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })

  const rejected = await q.updateCampaignFields(
    c.id,
    { title: '바뀐 제목', goal_amount: 999_999 },
    { requireStatus: 'draft' }
  )
  assert.equal(rejected, null)
  const after = await q.getCampaignById(c.id)
  assert.equal(after.title, '원래 제목')
  assert.equal(after.goal_amount, 1000)

  // 지금 상태를 근거로 한 쓰기는 그대로 된다.
  const ok = await q.updateCampaignFields(
    c.id,
    { title: '심사 중 수정' },
    { requireStatus: 'submitted' }
  )
  assert.equal(ok.title, '심사 중 수정')
})

test('updateCampaignFields는 빈 패치에서도 상태를 확인한다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })
  assert.equal(await q.updateCampaignFields(c.id, {}, { requireStatus: 'draft' }), null)
  assert.notEqual(await q.updateCampaignFields(c.id, {}, { requireStatus: 'submitted' }), null)
})

test('applyRewardBatch는 기대 상태가 아니면 생성·수정·삭제를 전부 되감는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const keep = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000 })
  const gone = await q.createReward({ campaign_id: c.id, title: 'LP', amount: 50000 })
  await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })

  const res = await q.applyRewardBatch({
    campaign_id: c.id,
    expected_status: 'draft',
    creates: [{ campaign_id: c.id, title: '몰래 추가', amount: 1000 }],
    updates: [{ id: keep.id, patch: { amount: 1 } }],
    delete_ids: [gone.id],
  })
  assert.deepEqual(res, { ok: false, reason: 'status_changed' })

  const rewards = await q.listRewards(c.id)
  assert.equal(rewards.length, 2)
  assert.equal(rewards.find(r => r.id === keep.id).amount, 30000)
  assert.ok(rewards.some(r => r.id === gone.id))
})

test('applyRewardBatch는 잠긴 리워드 하나 때문에 배치 전체를 되감는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const locked = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000 })
  const gone = await q.createReward({ campaign_id: c.id, title: 'LP', amount: 50000 })
  await client.execute(`UPDATE funding_rewards SET locked_at = 1 WHERE id = '${locked.id}'`)

  const res = await q.applyRewardBatch({
    campaign_id: c.id,
    expected_status: 'draft',
    creates: [{ campaign_id: c.id, title: '추가', amount: 1000 }],
    updates: [{ id: locked.id, patch: { amount: 5 }, require_unlocked: true }],
    delete_ids: [gone.id],
  })
  assert.deepEqual(res, { ok: false, reason: 'reward_locked', reward_id: locked.id })

  const rewards = await q.listRewards(c.id)
  assert.equal(rewards.length, 2)
  assert.equal(rewards.find(r => r.id === locked.id).amount, 30000)
  assert.equal(
    rewards.some(r => r.title === '추가'),
    false
  )
})

test('applyRewardBatch는 상태가 맞으면 생성·수정·삭제를 한 번에 반영한다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const keep = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000 })
  const gone = await q.createReward({ campaign_id: c.id, title: 'LP', amount: 50000 })

  const res = await q.applyRewardBatch({
    campaign_id: c.id,
    expected_status: 'draft',
    creates: [{ campaign_id: c.id, title: '포스터', amount: 1000 }],
    updates: [{ id: keep.id, patch: { amount: 33000 }, require_unlocked: true }],
    delete_ids: [gone.id],
  })
  assert.deepEqual(res, { ok: true })

  const rewards = await q.listRewards(c.id)
  assert.equal(rewards.length, 2)
  assert.equal(rewards.find(r => r.id === keep.id).amount, 33000)
  assert.ok(rewards.some(r => r.title === '포스터'))
  assert.equal(await q.getReward(gone.id), null)
})
