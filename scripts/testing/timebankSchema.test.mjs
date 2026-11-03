import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations, migrationFiles } from './apply-migrations.mjs'

/**
 * 타임뱅크 표(마이그레이션 `0026_timebank.sql`)를 **마이그레이션을 적용한 파일 DB**로
 * 검증한다. 트리거는 `drizzle-kit push`가 모르기 때문에 `db:push:local`로 만든
 * DB(E2E 포함)에는 없다 — 원장 불변성은 여기서만 증명된다(계획 "스펙과 다르게
 * 가는 곳" 3).
 *
 * 함께 고정하는 것:
 * - 부분 유일 인덱스·CHECK가 Drizzle 스키마에도 선언돼 있다(선언하지 않으면
 *   `drizzle-kit push`가 지운다)
 * - 트리거에 박은 묘비 표시명이 `withdrawal.ts`가 쓰는 상수와 같은 값이다
 */

const DB_PATH = 'scripts/testing/.timebank-schema-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const TABLES = [
  'timebank_profiles',
  'timebank_listings',
  'timebank_comments',
  'timebank_task_volunteers',
  'timebank_transfers',
  'timebank_withdrawn_keys',
]
const TRIGGERS = [
  'timebank_transfers_core_immutable',
  'timebank_transfers_final_immutable',
  'timebank_transfers_no_delete',
]

let client
let seq = 0

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

function timebankMigrationSql() {
  const file = migrationFiles().find(f => /\/\d{4}_timebank\.sql$/.test(f))
  assert.ok(file, '원장에 00NN_timebank 마이그레이션이 있어야 한다')
  return readFileSync(file, 'utf8')
}

/** 원장 행 하나를 넣고 id를 돌려준다. 기본은 회원 a → b 60분 confirmed exchange. */
async function insertTransfer(overrides = {}) {
  seq += 1
  const row = {
    id: `t-${seq}`,
    from_account: 'member-a',
    to_account: 'member-b',
    minutes: 60,
    kind: 'exchange',
    status: 'confirmed',
    created_by: 'member-a',
    counterparty_id: 'member-b',
    ref_type: null,
    ref_id: null,
    reverses_id: null,
    memo: null,
    from_name: '가나',
    to_name: '다라',
    ...overrides,
  }
  const cols = Object.keys(row)
  await client.execute({
    sql: `INSERT INTO timebank_transfers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    args: cols.map(c => row[c]),
  })
  return row.id
}

async function readTransfer(id) {
  const r = await client.execute({
    sql: 'SELECT * FROM timebank_transfers WHERE id = ?',
    args: [id],
  })
  return r.rows[0]
}

test('표 6개와 트리거 3개가 sqlite_master에 있다', async () => {
  const r = await client.execute(
    "SELECT type, name FROM sqlite_master WHERE name LIKE 'timebank_%' AND type IN ('table','trigger')"
  )
  const tables = r.rows
    .filter(x => x.type === 'table')
    .map(x => x.name)
    .sort()
  const triggers = r.rows
    .filter(x => x.type === 'trigger')
    .map(x => x.name)
    .sort()
  assert.deepEqual(tables, [...TABLES].sort())
  assert.deepEqual(triggers, [...TRIGGERS].sort())
})

test('Drizzle 스키마가 마이그레이션의 인덱스·CHECK를 전부 선언한다(push가 지우지 않게)', async () => {
  const { getTableConfig } = await import('drizzle-orm/sqlite-core')
  const schema = await import('../../src/db/schema/timebank.ts')
  const barrel = await import('../../src/db/schema/index.ts')
  const tables = [
    schema.timebankProfiles,
    schema.timebankListings,
    schema.timebankComments,
    schema.timebankTaskVolunteers,
    schema.timebankTransfers,
    schema.timebankWithdrawnKeys,
  ]
  for (const t of tables) {
    const cfg = getTableConfig(t)
    assert.ok(barrel[Object.keys(schema).find(k => schema[k] === t)], `${cfg.name} 재수출`)
    const declared = cfg.indexes.map(i => i.config.name).sort()
    const r = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      args: [cfg.name],
    })
    assert.deepEqual(declared, r.rows.map(x => x.name).sort(), `${cfg.name} 인덱스`)
  }

  const transfers = getTableConfig(schema.timebankTransfers)
  const partial = transfers.indexes
    .filter(i => i.config.where)
    .map(i => i.config.name)
    .sort()
  assert.deepEqual(partial, [
    'timebank_transfers_carryover_uq',
    'timebank_transfers_coop_task_uq',
    'timebank_transfers_market_uq',
    'timebank_transfers_reversal_uq',
    'timebank_transfers_signup_grant_uq',
  ])
  for (const i of transfers.indexes.filter(x => x.config.where)) {
    assert.equal(i.config.unique, true, `${i.config.name}는 유일 인덱스`)
  }
  assert.deepEqual(
    transfers.checks.map(c => c.name),
    ['timebank_transfers_minutes_positive'],
    'CHECK도 스키마에 선언한다'
  )
})

test('minutes = 0·음수 INSERT는 CHECK 위반이다', async () => {
  await assert.rejects(() => insertTransfer({ minutes: 0 }), /CHECK constraint failed/)
  await assert.rejects(() => insertTransfer({ minutes: -30 }), /CHECK constraint failed/)
})

test('같은 회원에 signup_grant 두 번은 UNIQUE 위반이다', async () => {
  const grant = {
    kind: 'signup_grant',
    from_account: 'coop',
    to_account: 'grant-1',
    created_by: null,
  }
  await insertTransfer(grant)
  await assert.rejects(() => insertTransfer(grant), /UNIQUE constraint failed/)
  // 다른 회원은 받는다
  await insertTransfer({ ...grant, to_account: 'grant-2' })
})

test('같은 reverses_id에 살아 있는 되돌림은 하나뿐이고, 거절된 되돌림은 자리를 차지하지 않는다', async () => {
  const original = await insertTransfer()
  const rev = {
    kind: 'reversal',
    from_account: 'member-b',
    to_account: 'member-a',
    reverses_id: original,
    status: 'pending',
  }
  await insertTransfer(rev)
  await assert.rejects(() => insertTransfer(rev), /UNIQUE constraint failed/)

  const original2 = await insertTransfer()
  await insertTransfer({ ...rev, reverses_id: original2, status: 'rejected' })
  await insertTransfer({ ...rev, reverses_id: original2, status: 'pending' })
})

test('같은 ref_id에 market pending 두 건은 위반이고, 그 글의 되돌림은 걸리지 않는다', async () => {
  const market = {
    kind: 'market',
    ref_type: 'market_listing',
    ref_id: 'listing-1',
    status: 'pending',
  }
  const first = await insertTransfer(market)
  await assert.rejects(() => insertTransfer(market), /UNIQUE constraint failed/)
  await insertTransfer({
    kind: 'reversal',
    ref_type: 'market_listing',
    ref_id: 'listing-1',
    reverses_id: first,
    status: 'pending',
  })
  // 취소된 거래는 자리를 비운다
  await insertTransfer({ ...market, ref_id: 'listing-2', status: 'canceled' })
  await insertTransfer({ ...market, ref_id: 'listing-2' })
})

test('같은 회원의 carryover 두 번은 위반이다', async () => {
  const carry = {
    kind: 'carryover',
    from_account: 'rejoin-1',
    to_account: 'coop',
    created_by: null,
  }
  await insertTransfer(carry)
  await assert.rejects(() => insertTransfer(carry), /UNIQUE constraint failed/)
})

test('같은 (ref_id, to_account)에 coop_task confirmed 두 건은 위반이다', async () => {
  const task = {
    kind: 'coop_task',
    from_account: 'coop',
    to_account: 'vol-1',
    ref_type: 'listing',
    ref_id: 'task-1',
    created_by: 'admin-1',
  }
  await insertTransfer(task)
  await assert.rejects(() => insertTransfer(task), /UNIQUE constraint failed/)
  // 다른 자원자는 같은 업무로 받는다
  await insertTransfer({ ...task, to_account: 'vol-2' })
})

test('같은 업무에 같은 회원이 두 번 자원하면 위반이다', async () => {
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO member_profiles (id, email, display_name, registration_status, is_active, created_at, updated_at)
          VALUES ('vol-m', 'vol-m@example.test', '자원자', 'approved', 1, ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO timebank_listings (id, author_id, kind, category, title, description)
          VALUES ('task-l', 'vol-m', 'coop_task', 'admin_help', '업무', '설명')`,
  })
  const vol = {
    sql: `INSERT INTO timebank_task_volunteers (id, listing_id, member_id, volunteered_at)
          VALUES (?, 'task-l', 'vol-m', ?)`,
  }
  await client.execute({ ...vol, args: ['v1', now] })
  await assert.rejects(
    () => client.execute({ ...vol, args: ['v2', now] }),
    /UNIQUE constraint failed/
  )
})

test('핵심 칸은 상태와 무관하게 바뀌지 않는다', async () => {
  const confirmed = await insertTransfer()
  await assert.rejects(
    () =>
      client.execute({
        sql: 'UPDATE timebank_transfers SET minutes = 90 WHERE id = ?',
        args: [confirmed],
      }),
    /core columns are immutable/
  )
  const pending = await insertTransfer({ status: 'pending' })
  for (const set of [
    'minutes = 90',
    "from_account = 'x'",
    "to_account = 'x'",
    "kind = 'market'",
    "created_by = 'x'",
    "counterparty_id = 'x'",
    "ref_type = 'listing'",
    "ref_id = 'x'",
    "reverses_id = 'x'",
    'created_at = 1',
    "id = 'x'",
  ]) {
    await assert.rejects(
      () =>
        client.execute({
          sql: `UPDATE timebank_transfers SET ${set} WHERE id = ?`,
          args: [pending],
        }),
      /core columns are immutable/,
      `pending 행의 ${set}`
    )
  }
  assert.equal(Number((await readTransfer(pending)).minutes), 60)
})

test('pending → confirmed 전이는 성공한다', async () => {
  const id = await insertTransfer({ status: 'pending' })
  await client.execute({
    sql: "UPDATE timebank_transfers SET status = 'confirmed', decided_by = 'member-b', decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    args: [Date.now(), Date.now(), id],
  })
  assert.equal((await readTransfer(id)).status, 'confirmed')
})

test('확정 행은 상태·메모·결정자·분류 무엇도 바뀌지 않는다', async () => {
  const id = await insertTransfer({ memo: '원래 메모', category: 'lesson' })
  for (const set of [
    "status = 'rejected'",
    "status = 'pending'",
    "memo = '고친 메모'",
    'memo = NULL',
    "decided_by = 'x'",
    'decided_at = 1',
    "approved_by = 'x'",
    "category = 'etc'",
  ]) {
    await assert.rejects(
      () =>
        client.execute({ sql: `UPDATE timebank_transfers SET ${set} WHERE id = ?`, args: [id] }),
      /finalized rows are immutable/,
      `확정 행의 ${set}`
    )
  }
  // 거절·취소된 행도 확정으로 본다
  const rejected = await insertTransfer({ status: 'rejected' })
  await assert.rejects(
    () =>
      client.execute({
        sql: "UPDATE timebank_transfers SET status = 'confirmed' WHERE id = ?",
        args: [rejected],
      }),
    /finalized rows are immutable/
  )
})

test('확정 행의 이름은 묘비 표시명으로만 덮을 수 있다(updated_at이 함께 바뀌어도)', async () => {
  const { WITHDRAWN_DISPLAY_NAME } = await import('../../src/constants/memberProfile.ts')
  const id = await insertTransfer()

  await assert.rejects(
    () =>
      client.execute({
        sql: "UPDATE timebank_transfers SET from_name = '아무개' WHERE id = ?",
        args: [id],
      }),
    /finalized rows are immutable/
  )
  await assert.rejects(
    () =>
      client.execute({
        sql: 'UPDATE timebank_transfers SET to_name = NULL WHERE id = ?',
        args: [id],
      }),
    /finalized rows are immutable/
  )
  // 묘비 이름 + 다른 칸 동시 변경은 막힌다
  await assert.rejects(
    () =>
      client.execute({
        sql: "UPDATE timebank_transfers SET from_name = ?, memo = 'x' WHERE id = ?",
        args: [WITHDRAWN_DISPLAY_NAME, id],
      }),
    /finalized rows are immutable/
  )

  await client.execute({
    sql: 'UPDATE timebank_transfers SET from_name = ?, updated_at = ? WHERE id = ?',
    args: [WITHDRAWN_DISPLAY_NAME, Date.now() + 1000, id],
  })
  await client.execute({
    sql: 'UPDATE timebank_transfers SET to_name = ? WHERE id = ?',
    args: [WITHDRAWN_DISPLAY_NAME, id],
  })
  const row = await readTransfer(id)
  assert.equal(row.from_name, WITHDRAWN_DISPLAY_NAME)
  assert.equal(row.to_name, WITHDRAWN_DISPLAY_NAME)
  // 이미 묘비가 된 이름을 다른 값으로 되돌리지 못한다
  await assert.rejects(
    () =>
      client.execute({
        sql: "UPDATE timebank_transfers SET from_name = '가나' WHERE id = ?",
        args: [id],
      }),
    /finalized rows are immutable/
  )
})

test('이름이 NULL인 확정 행도 임의 이름으로 덮지 못한다', async () => {
  const id = await insertTransfer({ from_name: null })
  await assert.rejects(
    () =>
      client.execute({
        sql: "UPDATE timebank_transfers SET from_name = '아무개' WHERE id = ?",
        args: [id],
      }),
    /finalized rows are immutable/
  )
})

test('Drizzle 업데이트($onUpdate가 updated_at을 함께 쓴다)로도 묘비 덮기가 된다', async () => {
  const { drizzle } = await import('drizzle-orm/libsql')
  const { eq } = await import('drizzle-orm')
  const { timebankTransfers } = await import('../../src/db/schema/timebank.ts')
  const { WITHDRAWN_DISPLAY_NAME } = await import('../../src/constants/memberProfile.ts')
  const db = drizzle(client)
  const id = await insertTransfer()
  const before = Number((await readTransfer(id)).updated_at)
  await new Promise(r => setTimeout(r, 5))
  await db
    .update(timebankTransfers)
    .set({ fromName: WITHDRAWN_DISPLAY_NAME })
    .where(eq(timebankTransfers.id, id))
  const row = await readTransfer(id)
  assert.equal(row.from_name, WITHDRAWN_DISPLAY_NAME)
  assert.ok(Number(row.updated_at) > before, 'updated_at이 바뀌었는데도 허용된다')
  await assert.rejects(
    () => db.update(timebankTransfers).set({ memo: '고침' }).where(eq(timebankTransfers.id, id)),
    err => /finalized rows are immutable/.test(String(err?.cause?.message ?? err?.message))
  )
})

test('원장 행은 상태와 무관하게 지워지지 않는다', async () => {
  for (const status of ['pending', 'confirmed', 'rejected']) {
    const id = await insertTransfer({ status })
    await assert.rejects(
      () => client.execute({ sql: 'DELETE FROM timebank_transfers WHERE id = ?', args: [id] }),
      /rows are never deleted/
    )
    assert.ok(await readTransfer(id))
  }
})

test('트리거의 묘비 표시명은 withdrawal.ts가 쓰는 상수와 같은 값이다', async () => {
  const { WITHDRAWN_DISPLAY_NAME } = await import('../../src/constants/memberProfile.ts')
  const withdrawal = readFileSync('src/db/queries/withdrawal.ts', 'utf8')
  assert.match(
    withdrawal,
    /import \{[^}]*\bWITHDRAWN_DISPLAY_NAME\b[^}]*\} from '\.\.\/\.\.\/constants\/memberProfile\.ts'/,
    'withdrawal.ts가 묘비 이름을 이 상수에서 가져와야 한다'
  )

  const sql = timebankMigrationSql()
  const trigger = sql.match(/CREATE TRIGGER `?timebank_transfers_final_immutable`?[\s\S]*?END;/)
  assert.ok(trigger, '확정 후 고정 트리거가 마이그레이션에 있어야 한다')
  const literals = [...trigger[0].matchAll(/'([^']*)'/g)]
    .map(m => m[1])
    .filter(s => s !== 'pending' && !s.startsWith('timebank_transfers:'))
  assert.ok(literals.length > 0)
  for (const lit of literals) assert.equal(lit, WITHDRAWN_DISPLAY_NAME)
})
