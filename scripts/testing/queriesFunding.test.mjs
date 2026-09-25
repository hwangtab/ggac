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

// --- 2026-09-23 감사: 승인은 관리자가 읽은 판에만 도장을 찍는다 --------------

/** `updated_at`은 밀리초라 같은 밀리초 안의 두 쓰기는 구별되지 않는다.
 *  판 번호가 "움직였다"를 보려면 최소 1밀리초는 벌려야 한다. */
const tick = () => new Promise(r => setTimeout(r, 2))

test('캠페인 내용을 고치면 판 번호(updated_at)가 움직인다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  await tick()
  const after = await q.updateCampaignFields(c.id, { story: '다시 쓴 본문' })
  assert.notEqual(after.updated_at, c.updated_at)
})

// 승인 토큰이 리워드까지 덮는지 — 짐작하지 말고 실제로 확인한다.
test('리워드만 고쳐도 캠페인의 판 번호가 움직인다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const r = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000 })
  const before = (await q.getCampaignById(c.id)).updated_at
  await tick()

  const res = await q.applyRewardBatch({
    campaign_id: c.id,
    expected_status: 'draft',
    creates: [],
    updates: [{ id: r.id, patch: { amount: 40000 } }],
    delete_ids: [],
  })
  assert.deepEqual(res, { ok: true })
  assert.notEqual((await q.getCampaignById(c.id)).updated_at, before)
})

test('심사한 판이 아니면 승인되지 않는다 — 철회·수정·재제출로 상태가 돌아와도 막힌다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '무해한 제목',
    summary: 's',
    goal_amount: 1,
  })
  const submitted = await q.transitionCampaign({
    id: c.id,
    action: 'submit',
    expectedFrom: 'draft',
  })
  // 관리자가 이 판을 읽었다.
  const reviewed = submitted.updated_at
  await tick()

  // 개설자가 철회 → 전면 수정 → 재제출. 상태는 다시 submitted다.
  await q.transitionCampaign({ id: c.id, action: 'withdraw', expectedFrom: 'submitted' })
  await q.updateCampaignFields(c.id, { title: '바꿔치기한 제목', story: '다른 내용' })
  const resubmitted = await q.transitionCampaign({
    id: c.id,
    action: 'submit',
    expectedFrom: 'draft',
  })
  assert.equal(resubmitted.status, 'submitted')

  // 관리자의 승인은 상태만 보면 조건이 맞지만 판이 다르다 — 아무것도 쓰지 않는다.
  assert.equal(
    await q.transitionCampaign({
      id: c.id,
      action: 'approve',
      expectedFrom: 'submitted',
      expectedUpdatedAt: reviewed,
      slug: 'swapped-campaign',
      platformFeeRate: 300,
    }),
    null
  )
  const still = await q.getCampaignById(c.id)
  assert.equal(still.status, 'submitted')
  assert.equal(still.title, '바꿔치기한 제목')

  // 지금 판을 읽고 다시 승인하면 통과한다.
  const ok = await q.transitionCampaign({
    id: c.id,
    action: 'approve',
    expectedFrom: 'submitted',
    expectedUpdatedAt: still.updated_at,
    slug: 'swapped-campaign',
    platformFeeRate: 300,
  })
  assert.equal(ok.status, 'active')
})

test('리워드를 바꿔치기해도 승인이 막힌다 — 판 번호가 리워드를 덮는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  const r = await q.createReward({ campaign_id: c.id, title: 'CD', amount: 30000 })
  const submitted = await q.transitionCampaign({
    id: c.id,
    action: 'submit',
    expectedFrom: 'draft',
  })
  const reviewed = submitted.updated_at
  await tick()

  await q.applyRewardBatch({
    campaign_id: c.id,
    expected_status: 'submitted',
    creates: [],
    updates: [{ id: r.id, patch: { amount: 1 } }],
    delete_ids: [],
  })

  assert.equal(
    await q.transitionCampaign({
      id: c.id,
      action: 'approve',
      expectedFrom: 'submitted',
      expectedUpdatedAt: reviewed,
      slug: 'reward-swapped',
    }),
    null
  )
  assert.equal((await q.getCampaignById(c.id)).status, 'submitted')
})

test('반려는 판 번호를 요구하지 않는다 — 내용이 바뀌어도 언제나 돌려보낼 수 있다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })
  await tick()
  await q.updateCampaignFields(c.id, { story: '심사 중에 고쳤다' })

  const rejected = await q.transitionCampaign({
    id: c.id,
    action: 'reject',
    expectedFrom: 'submitted',
    reviewNote: '사유',
  })
  assert.equal(rejected.status, 'draft')
  assert.equal(rejected.review_note, '사유')
})

test('판 번호가 날짜로 읽히지 않으면 아무것도 쓰지 않는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: 't',
    summary: 's',
    goal_amount: 1,
  })
  await q.transitionCampaign({ id: c.id, action: 'submit', expectedFrom: 'draft' })
  assert.equal(
    await q.transitionCampaign({
      id: c.id,
      action: 'approve',
      expectedFrom: 'submitted',
      expectedUpdatedAt: '아무 문자열',
      slug: 'garbage-token',
    }),
    null
  )
  assert.equal((await q.getCampaignById(c.id)).status, 'submitted')
})

// ── 쓰기 잠금을 가장 오래 쥐는 트랜잭션에만 재시도가 없던 것 ───────────────

/**
 * 이 배치는 맨 앞의 조건부 UPDATE로 쓰기 잠금을 잡은 뒤 생성·수정·삭제를 전부
 * 그 안에서 한다 — 원격 Turso에서는 문장마다 왕복이라 잠금을 쥐는 시간이 이
 * 앱에서 가장 길고, 그만큼 스스로도 `SQLITE_BUSY`를 만나기 쉽다.
 *
 * **다른 커넥션으로 진짜 경합을 만들어 검증하지 못한다.** 로컬 파일 DB에서는
 * `BEGIN IMMEDIATE`가 한 번 실패한 커넥션이 그다음 트랜잭션의 COMMIT에서
 * `SQLITE_BUSY: cannot commit transaction - SQL statements in progress`로
 * 이어진다(실측) — 재시도가 로컬에서는 구조적으로 성공할 수 없다. 운영은
 * 원격 Turso라 트랜잭션마다 새 스트림이 열려 이 제약이 없다. 그래서 여기서는
 * 경합 자체를 주입해 **배선**을 못박는다: 첫 트랜잭션이 경합으로 죽어도
 * 배치가 다시 시도해 저장까지 가는가.
 */
test('applyRewardBatch는 첫 트랜잭션이 경합으로 죽어도 다시 시도해 저장한다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '경합',
    summary: 's',
    goal_amount: 1,
  })
  // 쿼리 계층이 쓰는 바로 그 db 인스턴스의 클래스를 잡는다(같은 모듈이다).
  const { db } = await import('../../src/db/client.ts')
  const proto = db.constructor.prototype
  const original = proto.transaction
  let calls = 0
  proto.transaction = function patched(...args) {
    calls += 1
    if (calls === 1) {
      const busy = new Error('SQLITE_BUSY: database is locked')
      busy.code = 'SQLITE_BUSY'
      return Promise.reject(busy)
    }
    return original.apply(this, args)
  }
  try {
    const res = await q.applyRewardBatch({
      campaign_id: c.id,
      expected_status: 'draft',
      creates: [{ campaign_id: c.id, title: '경합리워드', amount: 1000 }],
      updates: [],
      delete_ids: [],
    })
    assert.equal(res.ok, true)
    assert.equal(calls, 2, '경합 뒤 한 번 더 시도해야 한다')
  } finally {
    proto.transaction = original
  }
  const rewards = await q.listRewards(c.id)
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].title, '경합리워드')
})

test('applyRewardBatch의 되감기 신호는 재시도를 타지 않는다 — 다시 해도 같은 답이다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '되감기',
    summary: 's',
    goal_amount: 1,
  })
  const { db } = await import('../../src/db/client.ts')
  const proto = db.constructor.prototype
  const original = proto.transaction
  let calls = 0
  proto.transaction = function counted(...args) {
    calls += 1
    return original.apply(this, args)
  }
  try {
    // 기대 상태가 어긋나면 `status_changed`다. 이걸 재시도하면 잠금을 오래
    // 쥐는 트랜잭션을 네 번 여는 셈이 된다.
    const res = await q.applyRewardBatch({
      campaign_id: c.id,
      expected_status: 'active',
      creates: [],
      updates: [],
      delete_ids: [],
    })
    assert.equal(res.ok, false)
    assert.equal(res.reason, 'status_changed')
    assert.equal(calls, 1)
  } finally {
    proto.transaction = original
  }
})

// ── 잠금을 쥐는 시간 ────────────────────────────────────────────────────────

/**
 * 트랜잭션 안에서 몇 문장을 내보내는지 센다.
 *
 * SQLite는 데이터베이스마다 쓰는 사람이 하나고, 원격 Turso에서는 **문장 하나가
 * 왕복 하나**다. 그러니 이 트랜잭션의 문장 수가 곧 "사이트 전체의 쓰기가 멈춰
 * 있는 시간"이다 — 그동안 결제 확정도 선점도 환불도 줄을 선다. 리워드마다 한
 * 문장씩 INSERT하던 때는 리워드 열두 개짜리 저장 한 번이 왕복 열둘이었다.
 */
function countStatements(db) {
  const proto = db.constructor.prototype
  const original = proto.transaction
  const counts = { insert: 0, update: 0, delete: 0 }
  proto.transaction = function counting(fn, ...rest) {
    return original.call(
      this,
      tx =>
        fn(
          new Proxy(tx, {
            get(target, prop) {
              const value = Reflect.get(target, prop, target)
              if (typeof value !== 'function') return value
              if (prop in counts) {
                return (...args) => {
                  counts[prop] += 1
                  return value.apply(target, args)
                }
              }
              return value.bind(target)
            },
          })
        ),
      ...rest
    )
  }
  return {
    counts,
    restore() {
      proto.transaction = original
    },
  }
}

test('리워드 여럿을 새로 만들어도 INSERT는 한 문장이다 — 잠금을 리워드 수만큼 쥐지 않는다', async () => {
  const c = await q.createCampaign({
    owner_user_id: 'u1',
    title: '문장수',
    summary: 's',
    goal_amount: 1,
  })
  const { db } = await import('../../src/db/client.ts')
  const meter = countStatements(db)
  try {
    const res = await q.applyRewardBatch({
      campaign_id: c.id,
      expected_status: 'draft',
      creates: Array.from({ length: 12 }, (_, i) => ({
        campaign_id: c.id,
        title: `리워드 ${i}`,
        amount: 1000 * (i + 1),
      })),
      updates: [],
      delete_ids: [],
    })
    assert.equal(res.ok, true)
  } finally {
    meter.restore()
  }
  assert.equal(meter.counts.insert, 1, `INSERT가 ${meter.counts.insert}문장이다 — 다중 행이 아니다`)
  // 맨 앞의 조건부 UPDATE(잠금 잡기)는 그대로 한 문장이어야 한다.
  assert.equal(meter.counts.update, 1)
  assert.equal(meter.counts.delete, 0)
  const rewards = await q.listRewards(c.id)
  assert.equal(rewards.length, 12)
  assert.deepEqual(
    rewards.map(r => r.amount),
    Array.from({ length: 12 }, (_, i) => 1000 * (i + 1))
  )
})
