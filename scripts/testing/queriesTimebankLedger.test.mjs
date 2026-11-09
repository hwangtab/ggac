import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 원장 쿼리 계층(`src/db/queries/timebankLedger.ts`)과 `withWriteRetry`를
 * **마이그레이션을 적용한 파일 DB**(트리거 포함)로 검증한다.
 *
 * 테스트마다 새 회원을 만든다 — 잔액·대기 상한·월 누적이 테스트끼리 섞이면
 * 검증하려던 것과 무관한 이유로 깨진다.
 *
 * 동시성 테스트는 같은 모듈(같은 클라이언트)에서 `Promise.allSettled`로 겹쳐
 * 부른다. libSQL은 트랜잭션마다 연결을 따로 열고 `BEGIN IMMEDIATE`로 잠그므로
 * 실제로 경합하고, `withWriteRetry`가 그 경합을 받는다.
 */

const DB_PATH = 'scripts/testing/.queries-timebank-ledger-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const TERMS = '2026-11'
const SETTINGS = Object.freeze({
  enabled: true,
  coop_tasks_enabled: true,
  redeem_tickets_enabled: false,
  redeem_rewards_enabled: false,
  market_time_enabled: false,
  terms_version: TERMS,
  signup_grant_minutes: 120,
  min_balance_minutes: -600,
  soft_max_minutes: 1800,
  low_balance_flag_minutes: -480,
  coop_task_monthly_cap_minutes: 480,
  redeem_monthly_cap_minutes: 480,
  market_item_max_minutes: 240,
  adjustment_dual_approval_minutes: 240,
})

let client
let ledger
let retry
let upsertProfile
let seq = 0

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  ledger = await import('../../src/db/queries/timebankLedger.ts')
  retry = await import('../../src/db/queries/_writeRetry.ts')
  ;({ upsertProfile } = await import('../../src/db/queries/profiles.ts'))
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

/** 승인·활성 회원 + 현재 판 동의 프로필. */
async function newMember(label = 'm', { admin = false, agreed = true } = {}) {
  seq += 1
  const id = `${label}-${seq}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: `${label}${seq}`,
    registration_status: 'approved',
    is_active: true,
    is_admin: admin,
  })
  if (agreed) {
    const now = Date.now()
    await client.execute({
      sql: `INSERT INTO timebank_profiles (member_id, terms_version, agreed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, TERMS, now, now, now],
    })
  }
  return id
}

/** 잔액을 맞추려고 원장에 확정 행을 직접 넣는다. 조정·조합 업무 누적에 걸리지 않는 kind를 쓴다. */
async function seedBalance(memberId, minutes, decidedAt = Date.now()) {
  seq += 1
  const [from, to, kind] =
    minutes < 0 ? [memberId, 'coop', 'redeem'] : ['coop', memberId, 'redeem_refund']
  await client.execute({
    sql: `INSERT INTO timebank_transfers (id, from_account, to_account, minutes, kind, status,
            decided_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
    args: [`seed-${seq}`, from, to, Math.abs(minutes), kind, decidedAt, decidedAt, decidedAt],
  })
}

async function insertRow(row) {
  seq += 1
  const now = Date.now()
  const full = {
    id: `row-${seq}`,
    status: 'confirmed',
    created_at: now,
    updated_at: now,
    ...row,
  }
  const cols = Object.keys(full)
  await client.execute({
    sql: `INSERT INTO timebank_transfers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    args: cols.map(c => full[c]),
  })
  return full.id
}

async function setProfile(id, assignments) {
  await client.execute({
    sql: `UPDATE member_profiles SET ${assignments} WHERE id = ?`,
    args: [id],
  })
}

async function statusOf(id) {
  const r = await client.execute({
    sql: 'SELECT status FROM timebank_transfers WHERE id = ?',
    args: [id],
  })
  return r.rows[0]?.status
}

/** 거부 사유·상태 코드로 단정한다(클래스 이름까지). */
async function rejectsWith(promise, expected) {
  await assert.rejects(promise, err => {
    if (expected.reason) {
      assert.equal(err.name, 'TransferRejectedError', `${err.name}: ${err.message}`)
      assert.equal(err.reason, expected.reason)
    }
    if (expected.code) {
      assert.equal(err.name, 'TransferStateError', `${err.name}: ${err.message}`)
      assert.equal(err.code, expected.code)
    }
    return true
  })
}

const record = (recorderId, counterpartyId, extra = {}) =>
  ledger.createMemberTransfer({
    recorderId,
    counterpartyId,
    kind: 'exchange',
    role: 'received',
    minutes: 60,
    category: 'lesson',
    settings: SETTINGS,
    ...extra,
  })

const confirm = (id, actorId) => ledger.confirmTransfer({ id, actorId, settings: SETTINGS })

// ── withWriteRetry ───────────────────────────────────────────────────────────

test('withWriteRetry: 락 경합은 다시 하고, 그 밖의 실패와 fatal은 곧바로 던진다', async () => {
  const busy = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
  assert.equal(retry.isLockContention(busy), true)
  assert.equal(retry.isLockContention(new Error('UNIQUE constraint failed')), false)

  let calls = 0
  const value = await retry.withWriteRetry(async () => {
    calls += 1
    if (calls < 3) throw busy
    return 'ok'
  })
  assert.equal(value, 'ok')
  assert.equal(calls, 3)

  calls = 0
  await assert.rejects(
    retry.withWriteRetry(async () => {
      calls += 1
      throw new Error('boom')
    }),
    /boom/
  )
  assert.equal(calls, 1, '경합이 아닌 실패는 한 번만 시도한다')

  calls = 0
  await assert.rejects(
    retry.withWriteRetry(
      async () => {
        calls += 1
        throw busy
      },
      { isFatal: () => true }
    )
  )
  assert.equal(calls, 1, 'fatal은 경합이어도 다시 하지 않는다')

  calls = 0
  await assert.rejects(
    retry.withWriteRetry(
      async () => {
        calls += 1
        throw busy
      },
      { attempts: 2 }
    ),
    /SQLITE_BUSY/
  )
  assert.equal(calls, 2, '시도 횟수를 넘으면 마지막 경합 오류를 던진다')
})

// ── 잔액 ─────────────────────────────────────────────────────────────────────

test('잔액: 빈 계좌는 0, confirmed만 합산한다', async () => {
  const a = await newMember('bal')
  const b = await newMember('bal')
  assert.equal(await ledger.balanceOf(a), 0)

  await seedBalance(a, 300)
  await insertRow({
    from_account: a,
    to_account: b,
    minutes: 60,
    kind: 'exchange',
    status: 'pending',
  })
  await insertRow({
    from_account: a,
    to_account: b,
    minutes: 90,
    kind: 'exchange',
    status: 'rejected',
  })
  await insertRow({ from_account: a, to_account: b, minutes: 30, kind: 'exchange' })
  assert.equal(await ledger.balanceOf(a), 270)
  assert.equal(await ledger.balanceOf(b), 30)
})

test('balancesByAccount: coop을 포함한 합계는 0이다', async () => {
  const rows = await ledger.balancesByAccount()
  assert.ok(rows.some(r => r.account === 'coop'))
  assert.equal(
    rows.reduce((s, r) => s + r.balance_minutes, 0),
    0
  )
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['account', 'balance_minutes'])
})

// ── 기록과 확인 ─────────────────────────────────────────────────────────────

test('A가 "받았다" 60 → pending, 상대 B가 확인하면 A −60, B +60', async () => {
  const a = await newMember('rec')
  const b = await newMember('rec')
  const row = await record(a, b)
  assert.equal(row.status, 'pending')
  assert.equal(row.counterparty_id, b)
  assert.equal(row.created_by, a)
  assert.equal(row.from_account, a)
  assert.equal(row.to_account, b)
  assert.equal(row.kind, 'exchange')
  assert.ok(row.from_name && row.to_name, '이름 스냅샷')
  assert.equal(await ledger.balanceOf(a), 0, 'pending은 잔액에 안 든다')

  const { row: done, flags } = await confirm(row.id, b)
  assert.equal(done.status, 'confirmed')
  assert.equal(done.decided_by, b)
  assert.ok(done.decided_at)
  assert.deepEqual(flags, [])
  assert.equal(await ledger.balanceOf(a), -60)
  assert.equal(await ledger.balanceOf(b), 60)
})

test('"해 줬다"는 방향이 반대다(상대가 낸다)', async () => {
  const a = await newMember('gave')
  const b = await newMember('gave')
  const row = await record(a, b, { role: 'gave' })
  assert.equal(row.from_account, b)
  assert.equal(row.to_account, a)
  assert.equal(row.counterparty_id, b)
})

test('확인·거절은 상대만, 취소는 기록자만, 확정 후 거절은 not_pending', async () => {
  const a = await newMember('who')
  const b = await newMember('who')
  const c = await newMember('who')
  const row = await record(a, b)

  await rejectsWith(confirm(row.id, a), { code: 'not_counterparty' })
  await rejectsWith(confirm(row.id, c), { code: 'not_counterparty' })
  await rejectsWith(ledger.rejectTransfer({ id: row.id, actorId: a }), { code: 'not_counterparty' })
  await rejectsWith(ledger.cancelTransfer({ id: row.id, actorId: b }), { code: 'not_recorder' })
  await rejectsWith(confirm('no-such-id', b), { code: 'not_found' })

  await confirm(row.id, b)
  await rejectsWith(ledger.rejectTransfer({ id: row.id, actorId: b }), { code: 'not_pending' })
  await rejectsWith(ledger.cancelTransfer({ id: row.id, actorId: a }), { code: 'not_pending' })
})

test('거절·취소는 조건부 UPDATE로 상태만 바꾼다', async () => {
  const a = await newMember('rc')
  const b = await newMember('rc')
  const r1 = await record(a, b)
  const rejected = await ledger.rejectTransfer({ id: r1.id, actorId: b })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.decided_by, b)

  const r2 = await record(a, b)
  const canceled = await ledger.cancelTransfer({ id: r2.id, actorId: a })
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.decided_by, a)
  assert.equal(await ledger.balanceOf(a), 0)
  // 사유 없는 결정은 memo를 건드리지 않는다.
  assert.equal(rejected.memo, r1.memo)
  assert.equal(canceled.memo, r2.memo)
})

test('거절·취소 사유는 memo 끝에 머리말을 붙여 남고, 원 memo를 지우지 않는다', async () => {
  const a = await newMember('rm')
  const b = await newMember('rm')
  const r1 = await record(a, b)
  const rejected = await ledger.rejectTransfer({
    id: r1.id,
    actorId: b,
    memo: '  그날 안 만났어요 ',
  })
  assert.equal(rejected.status, 'rejected')
  assert.equal(
    rejected.memo,
    r1.memo ? `${r1.memo} / 거절 사유: 그날 안 만났어요` : '거절 사유: 그날 안 만났어요'
  )

  const r2 = await record(a, b)
  const canceled = await ledger.cancelTransfer({ id: r2.id, actorId: a, memo: '잘못 눌렀어요' })
  assert.match(canceled.memo, /취소 사유: 잘못 눌렀어요$/)

  // 공백뿐인 사유는 사유 없음이다.
  const r3 = await record(a, b)
  const plain = await ledger.rejectTransfer({ id: r3.id, actorId: b, memo: '   ' })
  assert.equal(plain.memo, r3.memo)
})

test('1-A에서 market 기록은 kind_not_allowed, 그 밖의 kind는 거부', async () => {
  const a = await newMember('mk')
  const b = await newMember('mk')
  await rejectsWith(record(a, b, { kind: 'market', refType: 'market_listing', refId: 'x' }), {
    reason: 'kind_not_allowed',
  })
  await rejectsWith(record(a, b, { kind: 'adjustment' }), { reason: 'kind_not_allowed' })
})

test('기록 시점 판정: 자기 자신, 30분 배수 아님, 동의 안 한 상대', async () => {
  const a = await newMember('pre')
  const b = await newMember('pre', { agreed: false })
  await rejectsWith(record(a, a), { reason: 'self' })
  await rejectsWith(record(a, b), { reason: 'counterparty_not_participant' })
  const c = await newMember('pre')
  await rejectsWith(record(a, c, { minutes: 45 }), { reason: 'bad_minutes' })
})

// ── 하한·상한 ───────────────────────────────────────────────────────────────

test('하한: A −570에서 60 확인은 below_floor이고 행은 pending으로 남는다', async () => {
  const a = await newMember('floor')
  const b = await newMember('floor')
  await seedBalance(a, -540)
  const row = await record(a, b) // 미리보기 −600은 통과
  await seedBalance(a, -30) // 그 사이 −570이 됐다
  await rejectsWith(confirm(row.id, b), { reason: 'below_floor' })
  assert.equal(await statusOf(row.id), 'pending')
  assert.equal(await ledger.balanceOf(a), -570)
})

test('기록 시점 미리보기 하한을 넘으면 기록 자체를 거부한다', async () => {
  const a = await newMember('floor2')
  const b = await newMember('floor2')
  await seedBalance(a, -570)
  await rejectsWith(record(a, b), { reason: 'below_floor' })
})

test('받는 쪽이 +1800을 넘으면 확정하되 over_soft_max 플래그', async () => {
  const a = await newMember('soft')
  const b = await newMember('soft')
  await seedBalance(b, 1800)
  const row = await record(a, b)
  const { row: done, flags } = await confirm(row.id, b)
  assert.equal(done.status, 'confirmed')
  assert.deepEqual(flags, ['over_soft_max'])
})

// ── 확인 시점 재판정 ────────────────────────────────────────────────────────

test('확인 시점 재판정: 확인자가 탈퇴 신청 중이면 not_participant', async () => {
  const a = await newMember('re')
  const b = await newMember('re')
  const row = await record(a, b)
  await setProfile(b, `withdrawal_requested_at = ${Date.now()}`)
  await rejectsWith(confirm(row.id, b), { reason: 'not_participant' })
  assert.equal(await statusOf(row.id), 'pending')
})

test('확인 시점 재판정: 확인자가 정지(is_active=false)면 not_participant', async () => {
  const a = await newMember('re')
  const b = await newMember('re')
  const row = await record(a, b)
  await setProfile(b, 'is_active = 0')
  await rejectsWith(confirm(row.id, b), { reason: 'not_participant' })
  assert.equal(await statusOf(row.id), 'pending')
})

test('확인 시점 재판정: 기록자가 정지(is_suspended)면 counterparty_not_participant', async () => {
  const a = await newMember('re')
  const b = await newMember('re')
  const row = await record(a, b)
  await setProfile(a, 'is_suspended = 1')
  await rejectsWith(confirm(row.id, b), { reason: 'counterparty_not_participant' })
})

test('정지·탈퇴 신청 중에도 pending 거절·취소는 된다', async () => {
  const a = await newMember('frz')
  const b = await newMember('frz')
  const r1 = await record(a, b)
  const r2 = await record(a, b)
  await setProfile(b, 'is_active = 0')
  await setProfile(a, `withdrawal_requested_at = ${Date.now()}`)
  assert.equal((await ledger.rejectTransfer({ id: r1.id, actorId: b })).status, 'rejected')
  assert.equal((await ledger.cancelTransfer({ id: r2.id, actorId: a })).status, 'canceled')
})

// ── 동시성 ──────────────────────────────────────────────────────────────────

test('동시성: 같은 pending에 확인 두 번 병렬 → 하나만 성공', async () => {
  const a = await newMember('race')
  const b = await newMember('race')
  const row = await record(a, b)
  const results = await Promise.allSettled([confirm(row.id, b), confirm(row.id, b)])
  const ok = results.filter(r => r.status === 'fulfilled')
  assert.equal(ok.length, 1, JSON.stringify(results.map(r => r.reason?.message ?? 'ok')))
  const failed = results.find(r => r.status === 'rejected')
  assert.equal(failed.reason.code, 'not_pending')
  assert.equal(await ledger.balanceOf(a), -60)
})

test('동시성: A −540에서 서로 다른 60분 pending 두 건을 병렬 확인 → 하나만 성공', async () => {
  const a = await newMember('race2')
  const b = await newMember('race2')
  const c = await newMember('race2')
  await seedBalance(a, -540)
  const toB = await record(a, b)
  const toC = await record(a, c)
  const results = await Promise.allSettled([confirm(toB.id, b), confirm(toC.id, c)])
  const ok = results.filter(r => r.status === 'fulfilled')
  assert.equal(ok.length, 1, JSON.stringify(results.map(r => r.reason?.message ?? 'ok')))
  assert.equal(results.find(r => r.status === 'rejected').reason.reason, 'below_floor')
  assert.equal(await ledger.balanceOf(a), -600)
})

// ── 대기 상한과 차단 ─────────────────────────────────────────────────────────

test('대기 상한: 기록자 pending 11번째는 pending_limit', async () => {
  const r = await newMember('lim')
  const cps = [
    await newMember('lim'),
    await newMember('lim'),
    await newMember('lim'),
    await newMember('lim'),
  ]
  const plan = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]
  for (const i of plan) await record(r, cps[i])
  assert.equal(await ledger.countOpenPending({ recorderId: r }), 10)
  await rejectsWith(record(r, cps[3]), { reason: 'pending_limit' })
})

test('대기 상한: 같은 쌍 4번째는 pair_pending_limit', async () => {
  const r = await newMember('pair')
  const x = await newMember('pair')
  for (let i = 0; i < 3; i++) await record(r, x)
  assert.equal(await ledger.countOpenPending({ recorderId: r, counterpartyId: x }), 3)
  await rejectsWith(record(r, x), { reason: 'pair_pending_limit' })
})

test('거절 누적: 같은 상대에게서 30일 안에 거절 3회면 다음 기록은 pair_blocked', async () => {
  const r = await newMember('blk')
  const x = await newMember('blk')
  for (let i = 0; i < 3; i++) {
    const row = await record(r, x)
    await ledger.rejectTransfer({ id: row.id, actorId: x })
  }
  assert.equal(
    await ledger.countRecentRejections({ recorderId: r, counterpartyId: x, windowDays: 30 }),
    3
  )
  await rejectsWith(record(r, x), { reason: 'pair_blocked' })
  // 다른 상대에게는 기록할 수 있다
  const y = await newMember('blk')
  assert.equal((await record(r, y)).status, 'pending')
})

test('거절 누적: 오래된 거절(30일 밖에 걸친 3회)은 차단하지 않는다', async () => {
  const r = await newMember('blk2')
  const x = await newMember('blk2')
  const day = 86_400_000
  const now = Date.now()
  for (const ago of [70, 45, 1]) {
    await insertRow({
      from_account: r,
      to_account: x,
      minutes: 60,
      kind: 'exchange',
      status: 'rejected',
      created_by: r,
      counterparty_id: x,
      decided_by: x,
      decided_at: now - ago * day,
    })
  }
  assert.equal((await record(r, x)).status, 'pending')
})

// ── 되돌림 ──────────────────────────────────────────────────────────────────

async function confirmedExchange(a, b) {
  const row = await record(a, b)
  await confirm(row.id, b)
  return row
}

test('reversal: 확정 exchange의 되돌림 → 상대 확인 → 잔액 원복', async () => {
  const a = await newMember('rev')
  const b = await newMember('rev')
  const orig = await confirmedExchange(a, b)
  const rev = await ledger.createMemberTransfer({
    recorderId: b,
    counterpartyId: a,
    kind: 'reversal',
    role: 'gave',
    minutes: 60,
    memo: '잘못 기록했어요',
    reversesId: orig.id,
    settings: SETTINGS,
  })
  assert.equal(rev.kind, 'reversal')
  assert.equal(rev.from_account, b)
  assert.equal(rev.to_account, a)
  assert.equal(rev.reverses_id, orig.id)
  assert.equal(rev.counterparty_id, a)
  await confirm(rev.id, a)
  assert.equal(await ledger.balanceOf(a), 0)
  assert.equal(await ledger.balanceOf(b), 0)

  // 되돌림의 되돌림은 없다
  await rejectsWith(
    ledger.createMemberTransfer({
      recorderId: a,
      counterpartyId: b,
      kind: 'reversal',
      role: 'gave',
      minutes: 60,
      reversesId: rev.id,
      settings: SETTINGS,
    }),
    { reason: 'not_reversible' }
  )
})

test('reversal: 거절된 되돌림 뒤 새 되돌림을 기록할 수 있다', async () => {
  const a = await newMember('rev2')
  const b = await newMember('rev2')
  const orig = await confirmedExchange(a, b)
  const input = {
    recorderId: a,
    counterpartyId: b,
    kind: 'reversal',
    role: 'received',
    minutes: 60,
    reversesId: orig.id,
    settings: SETTINGS,
  }
  const first = await ledger.createMemberTransfer(input)
  await ledger.rejectTransfer({ id: first.id, actorId: b })
  const second = await ledger.createMemberTransfer(input)
  assert.equal(second.status, 'pending')
  assert.notEqual(second.id, first.id)
})

test('reversal: 열린(pending·confirmed) 되돌림이 있으면 두 번째는 already_reversed', async () => {
  const a = await newMember('rev4')
  const b = await newMember('rev4')
  const orig = await confirmedExchange(a, b)
  const input = {
    recorderId: a,
    counterpartyId: b,
    kind: 'reversal',
    role: 'received',
    minutes: 60,
    reversesId: orig.id,
    settings: SETTINGS,
  }
  const first = await ledger.createMemberTransfer(input)
  // pending 되돌림이 있을 때 — 기록자든 상대든 같은 사유
  await rejectsWith(ledger.createMemberTransfer(input), { reason: 'already_reversed' })
  await rejectsWith(ledger.createMemberTransfer({ ...input, recorderId: b, counterpartyId: a }), {
    reason: 'already_reversed',
  })
  // 확정된 되돌림이 있을 때
  await confirm(first.id, b)
  await rejectsWith(ledger.createMemberTransfer(input), { reason: 'already_reversed' })
  const count = await client.execute({
    sql: 'SELECT count(*) AS n FROM timebank_transfers WHERE reverses_id = ?',
    args: [orig.id],
  })
  assert.equal(Number(count.rows[0].n), 1)
})

test('listTransfersFor: 열린 되돌림이 있는 원 이동은 reversal_open', async () => {
  const a = await newMember('rev5')
  const b = await newMember('rev5')
  const orig = await confirmedExchange(a, b)
  const other = await confirmedExchange(a, b)
  const rev = await ledger.createMemberTransfer({
    recorderId: a,
    counterpartyId: b,
    kind: 'reversal',
    role: 'received',
    minutes: 60,
    reversesId: orig.id,
    settings: SETTINGS,
  })
  const byId = async () =>
    new Map(
      (await ledger.listTransfersFor({ memberId: a, limit: 10, offset: 0 })).rows.map(r => [
        r.id,
        r,
      ])
    )
  let rows = await byId()
  assert.equal(rows.get(orig.id).reversal_open, true, 'pending 되돌림')
  assert.equal(rows.get(other.id).reversal_open, false)
  await ledger.rejectTransfer({ id: rev.id, actorId: b })
  rows = await byId()
  assert.equal(rows.get(orig.id).reversal_open, false, '거절된 되돌림은 닫힌 것')
})

test('reversal: 당사자가 아닌 사람·pending 원 이동·다른 분량은 거부', async () => {
  const a = await newMember('rev3')
  const b = await newMember('rev3')
  const c = await newMember('rev3')
  const orig = await confirmedExchange(a, b)
  const base = {
    kind: 'reversal',
    role: 'gave',
    minutes: 60,
    reversesId: orig.id,
    settings: SETTINGS,
  }
  await rejectsWith(ledger.createMemberTransfer({ ...base, recorderId: c, counterpartyId: a }), {
    reason: 'recorder_not_party',
  })
  await rejectsWith(
    ledger.createMemberTransfer({ ...base, recorderId: b, counterpartyId: a, minutes: 30 }),
    {
      reason: 'reverse_mismatch',
    }
  )
  const pend = await record(a, b)
  await rejectsWith(
    ledger.createMemberTransfer({ ...base, recorderId: b, counterpartyId: a, reversesId: pend.id }),
    { reason: 'not_reversible' }
  )
})

// ── 조합 지급 ───────────────────────────────────────────────────────────────

test('issueFromCoop(signup_grant) 두 번 → 행 1개, 잔액 120', async () => {
  const m = await newMember('grant')
  const first = await ledger.issueFromCoop({
    kind: 'signup_grant',
    memberId: m,
    minutes: 120,
    actorId: null,
  })
  const second = await ledger.issueFromCoop({
    kind: 'signup_grant',
    memberId: m,
    minutes: 120,
    actorId: null,
  })
  assert.equal(second.id, first.id, '기존 행을 돌려준다')
  assert.equal(first.status, 'confirmed')
  assert.equal(first.from_account, 'coop')
  assert.equal(await ledger.balanceOf(m), 120)
})

test('issueFromCoop(carryover)는 회원 → coop이고 회원당 1회', async () => {
  const m = await newMember('carry')
  const first = await ledger.issueFromCoop({
    kind: 'carryover',
    memberId: m,
    minutes: 300,
    actorId: null,
  })
  assert.equal(first.from_account, m)
  assert.equal(first.to_account, 'coop')
  const again = await ledger.issueFromCoop({
    kind: 'carryover',
    memberId: m,
    minutes: 300,
    actorId: null,
  })
  assert.equal(again.id, first.id)
  assert.equal(await ledger.balanceOf(m), -300)
})

async function coopTask(adminId, ...volunteers) {
  seq += 1
  const id = `task-${seq}`
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO timebank_listings (id, author_id, kind, category, title, description, created_at, updated_at)
          VALUES (?, ?, 'coop_task', 'admin_help', '행사 준비', '자원 참여', ?, ?)`,
    args: [id, adminId, now, now],
  })
  for (const v of volunteers) {
    seq += 1
    await client.execute({
      sql: `INSERT INTO timebank_task_volunteers (id, listing_id, member_id, volunteered_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [`vol-${seq}`, id, v, now, now, now],
    })
  }
  return id
}

const credit = (listingId, memberId, actorId, minutes, extra = {}) =>
  ledger.creditCoopTask({
    listingId,
    memberId,
    actorId,
    minutes,
    memo: '행사 준비 도움',
    notPaidElsewhere: true,
    settings: SETTINGS,
    ...extra,
  })

test('coop_task: 월 상한 480에서 300 + 240 → 두 번째는 monthly_cap', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('task')
  const t1 = await coopTask(admin, m)
  const t2 = await coopTask(admin, m)
  const row = await credit(t1, m, admin, 300)
  assert.equal(row.kind, 'coop_task')
  assert.equal(row.ref_type, 'listing')
  assert.equal(row.ref_id, t1)
  assert.equal(row.created_by, admin)
  await rejectsWith(credit(t2, m, admin, 240), { reason: 'monthly_cap' })
  assert.equal(await ledger.balanceOf(m), 300)
})

test('coop_task 지급 조건: 자원자 아님·철회자·본인·비참여자·중복', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('task2')
  const stranger = await newMember('task2')
  const quitter = await newMember('task2')
  const frozen = await newMember('task2')
  const t = await coopTask(admin, m, quitter, frozen, admin)
  await client.execute({
    sql: 'UPDATE timebank_task_volunteers SET withdrawn_at = ? WHERE listing_id = ? AND member_id = ?',
    args: [Date.now(), t, quitter],
  })
  await setProfile(frozen, `withdrawal_requested_at = ${Date.now()}`)

  await rejectsWith(credit(t, stranger, admin, 60), { reason: 'not_volunteer' })
  await rejectsWith(credit(t, quitter, admin, 60), { reason: 'volunteer_withdrawn' })
  await rejectsWith(credit(t, admin, admin, 60), { reason: 'self' })
  await rejectsWith(credit(t, frozen, admin, 60), { reason: 'not_participant' })
  await rejectsWith(credit(t, m, admin, 45), { reason: 'bad_minutes' })
  await rejectsWith(credit(t, m, admin, 60, { memo: '  ' }), { reason: 'memo_required' })
  await rejectsWith(credit('no-such-task', m, admin, 60), { reason: 'not_coop_task' })
  // "사례비·인건비 미지급" 확인은 원장도 본다 — 라우트가 빠뜨려도 지급되지 않는다
  await rejectsWith(credit(t, m, admin, 60, { notPaidElsewhere: false }), {
    reason: 'paid_elsewhere_unconfirmed',
  })
  // 일반 글(offer)은 조합 업무가 아니다
  seq += 1
  const offer = `offer-${seq}`
  await client.execute({
    sql: `INSERT INTO timebank_listings (id, author_id, kind, category, title, description, created_at, updated_at)
          VALUES (?, ?, 'offer', 'etc', '제공', '내용', ?, ?)`,
    args: [offer, m, Date.now(), Date.now()],
  })
  await rejectsWith(credit(offer, m, admin, 60), { reason: 'not_coop_task' })

  await credit(t, m, admin, 60)
  await rejectsWith(credit(t, m, admin, 60), { reason: 'already_credited' })
})

test('coop_task 동시성: 상한 경계에서 병렬 지급 → 하나만 성공', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('task3')
  const t0 = await coopTask(admin, m)
  const t1 = await coopTask(admin, m)
  const t2 = await coopTask(admin, m)
  await credit(t0, m, admin, 240)
  const results = await Promise.allSettled([credit(t1, m, admin, 240), credit(t2, m, admin, 240)])
  const ok = results.filter(r => r.status === 'fulfilled')
  assert.equal(ok.length, 1, JSON.stringify(results.map(r => r.reason?.message ?? 'ok')))
  assert.equal(results.find(r => r.status === 'rejected').reason.reason, 'monthly_cap')
  assert.equal(await ledger.balanceOf(m), 480)
})

test('KST 월 경계: 11-30T15:30Z 지급은 12월로 센다', async () => {
  const m = await newMember('kst')
  const at = Date.parse('2026-11-30T15:30:00Z')
  await insertRow({
    from_account: 'coop',
    to_account: m,
    minutes: 300,
    kind: 'coop_task',
    ref_type: 'listing',
    ref_id: 'kst-task',
    decided_at: at,
    created_at: at,
  })
  const sum = month =>
    ledger.monthlySum({ account: m, kinds: ['coop_task'], direction: 'in', monthKey: month })
  assert.equal(await sum('2026-12'), 300)
  assert.equal(await sum('2026-11'), 0)

  // 같은 회원에게 12월 1일(KST)에 240을 더 주면 상한을 넘는다
  const admin = await newMember('adm', { admin: true })
  const t = await coopTask(admin, m)
  await rejectsWith(credit(t, m, admin, 240, { now: new Date('2026-12-01T01:00:00Z') }), {
    reason: 'monthly_cap',
  })
  // 11월(KST)에는 여유가 있다
  const ok = await credit(t, m, admin, 240, { now: new Date('2026-11-30T14:00:00Z') })
  assert.equal(ok.status, 'confirmed')
})

// ── 조정 ────────────────────────────────────────────────────────────────────

const adjust = (adminId, memberId, minutes, extra = {}) =>
  ledger.createAdjustment({
    adminId,
    memberId,
    direction: 'credit',
    minutes,
    memo: '정정',
    targetIsAdmin: false,
    settings: SETTINGS,
    ...extra,
  })

test('조정: 본인 대상·memo 없음·30분 배수 아님은 거부', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj0')
  await rejectsWith(adjust(admin, admin, 60, { targetIsAdmin: true }), { reason: 'self' })
  await rejectsWith(adjust(admin, m, 60, { memo: ' ' }), { reason: 'memo_required' })
  await rejectsWith(adjust(admin, m, 45), { reason: 'bad_minutes' })
})

test('조정: 200분 즉시 확정 후 같은 대상에 60분 → 누적 260 > 240이라 pending', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj1')
  const first = await adjust(admin, m, 200 - 20) // 180 — 30 배수
  assert.equal(first.status, 'confirmed')
  assert.equal(first.from_account, 'coop')
  assert.equal(first.to_account, m)
  const second = await adjust(admin, m, 60, { direction: 'debit' }) // 누적 240 — 경계 안
  assert.equal(second.status, 'confirmed', '누적 240은 넘지 않는다')
  assert.equal(second.from_account, m)
  const third = await adjust(admin, m, 30)
  assert.equal(third.status, 'pending', '누적 270 > 240')
  assert.equal(third.counterparty_id, null)
  assert.equal(await ledger.balanceOf(m), 120)
})

test('조정: 210 확정 뒤 60 → 270 > 240이라 pending (계획 예시와 같은 경계)', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj1b')
  assert.equal((await adjust(admin, m, 210)).status, 'confirmed')
  assert.equal((await adjust(admin, m, 60)).status, 'pending')
})

test('조정: dispute는 30분이어도 pending, 관리자 대상도 pending', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj2')
  const other = await newMember('adm', { admin: true })
  const d = await adjust(admin, m, 30, { dispute: { resolution_ref: '2026-11-20 이사회 3호' } })
  assert.equal(d.status, 'pending')
  assert.equal(d.ref_type, 'dispute')
  assert.equal(d.ref_id, '2026-11-20 이사회 3호')
  const toAdmin = await adjust(admin, other, 30, { targetIsAdmin: true })
  assert.equal(toAdmin.status, 'pending')
})

test('조정: 차감이 하한을 넘으면 below_floor', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj3')
  await seedBalance(m, -480)
  await rejectsWith(adjust(admin, m, 150, { direction: 'debit' }), { reason: 'below_floor' })
})

test('조정 승인: 생성자·대상 본인 승인 거부, 다른 관리자 승인 → confirmed', async () => {
  const admin = await newMember('adm', { admin: true })
  const admin2 = await newMember('adm', { admin: true })
  const adminTarget = await newMember('adm', { admin: true })
  const pend = await adjust(admin, adminTarget, 60, { targetIsAdmin: true })
  const approve = approverId =>
    ledger.approveAdjustment({ id: pend.id, approverId, settings: SETTINGS })

  await rejectsWith(approve(admin), { reason: 'self_approval' })
  await rejectsWith(approve(adminTarget), { reason: 'self_approval' })
  assert.equal(await statusOf(pend.id), 'pending')

  const done = await approve(admin2)
  assert.equal(done.status, 'confirmed')
  assert.equal(done.approved_by, admin2)
  assert.equal(done.decided_by, admin2)
  assert.equal(await ledger.balanceOf(adminTarget), 60)
  await rejectsWith(approve(admin2), { code: 'not_pending' })
})

test('조정 승인: 승인 시점에 대상 자격·하한을 다시 본다', async () => {
  const admin = await newMember('adm', { admin: true })
  const admin2 = await newMember('adm', { admin: true })
  const m = await newMember('adj4')
  const m2 = await newMember('adj4')
  const p1 = await adjust(admin, m, 30, { dispute: { resolution_ref: '안건 1' } })
  await setProfile(m, `withdrawal_requested_at = ${Date.now()}`)
  await rejectsWith(
    ledger.approveAdjustment({ id: p1.id, approverId: admin2, settings: SETTINGS }),
    {
      reason: 'not_participant',
    }
  )
  assert.equal(await statusOf(p1.id), 'pending')

  const p2 = await adjust(admin, m2, 120, {
    direction: 'debit',
    dispute: { resolution_ref: '안건 2' },
  })
  await seedBalance(m2, -540)
  await rejectsWith(
    ledger.approveAdjustment({ id: p2.id, approverId: admin2, settings: SETTINGS }),
    {
      reason: 'below_floor',
    }
  )
  assert.equal(await statusOf(p2.id), 'pending')
})

test('조정 pending은 조합원 경로(확인·거절·취소)로 닿지 않는다', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('adj5')
  const pend = await adjust(admin, m, 30, { dispute: { resolution_ref: '안건' } })
  await rejectsWith(confirm(pend.id, m), { code: 'not_found' })
  await rejectsWith(ledger.rejectTransfer({ id: pend.id, actorId: m }), { code: 'not_found' })
  await rejectsWith(ledger.cancelTransfer({ id: pend.id, actorId: admin }), { code: 'not_found' })
  // 승인 경로도 조정이 아닌 행에는 닿지 않는다
  const a = await newMember('adj5')
  const row = await record(a, m)
  await rejectsWith(
    ledger.approveAdjustment({ id: row.id, approverId: admin, settings: SETTINGS }),
    {
      code: 'not_found',
    }
  )
})

// ── 관리자 pending 취소(계획 Task 9) ───────────────────────────────────────

const adminCancel = (id, adminId, memo = '분쟁 정리 — 당사자 합의') =>
  ledger.adminCancelPending({ id, adminId, memo })

test('관리자 취소: 회원 간 pending을 canceled로, 결정자는 관리자, memo는 원 memo 뒤에 붙는다', async () => {
  const admin = await newMember('adm', { admin: true })
  const a = await newMember('ac')
  const b = await newMember('ac')
  const row = await record(a, b, { memo: '기타 레슨' })
  const canceled = await adminCancel(row.id, admin)
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.decided_by, admin)
  assert.ok(canceled.decided_at)
  assert.equal(canceled.memo, '기타 레슨 / 관리자 취소: 분쟁 정리 — 당사자 합의')
  assert.equal(await statusOf(row.id), 'canceled')
  assert.equal(await ledger.balanceOf(a), 0)
})

test('관리자 취소: kind 무관 — 조정 pending도 취소한다(원 memo 없으면 사유만)', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('ac2')
  const pend = await adjust(admin, m, 30, { dispute: { resolution_ref: '안건' } })
  assert.equal(pend.status, 'pending')
  const canceled = await adminCancel(pend.id, admin, '근거 재확인 필요')
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.kind, 'adjustment')
  assert.equal(canceled.memo, '정정 / 관리자 취소: 근거 재확인 필요')

  const other = await newMember('ac2')
  const bare = await insertRow({
    from_account: m,
    to_account: other,
    minutes: 30,
    kind: 'exchange',
    status: 'pending',
    created_by: m,
    counterparty_id: other,
  })
  assert.equal((await adminCancel(bare, admin, '중복 기록')).memo, '관리자 취소: 중복 기록')
})

test('관리자 취소: memo 없음·확정된 행·없는 행은 거부하고 행을 바꾸지 않는다', async () => {
  const admin = await newMember('adm', { admin: true })
  const a = await newMember('ac3')
  const b = await newMember('ac3')
  const row = await record(a, b)
  await rejectsWith(adminCancel(row.id, admin, '   '), { reason: 'memo_required' })
  assert.equal(await statusOf(row.id), 'pending')
  await confirm(row.id, b)
  await rejectsWith(adminCancel(row.id, admin), { code: 'not_pending' })
  assert.equal(await statusOf(row.id), 'confirmed')
  await rejectsWith(adminCancel('no-such-row', admin), { code: 'not_found' })
})

test('관리자 취소: 같은 pending에 병렬 두 번 → 하나만 성공', async () => {
  const admin = await newMember('adm', { admin: true })
  const a = await newMember('ac4')
  const b = await newMember('ac4')
  const row = await record(a, b)
  const results = await Promise.allSettled([adminCancel(row.id, admin), adminCancel(row.id, admin)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const failed = results.find(r => r.status === 'rejected')
  assert.equal(failed.reason.code, 'not_pending')
})

test('listPendingAdjustments: 승인 대기 조정만, 오래된 것부터', async () => {
  const admin = await newMember('adm', { admin: true })
  const m = await newMember('pa')
  const p1 = await adjust(admin, m, 30, { dispute: { resolution_ref: '안건 1' } })
  const p2 = await adjust(admin, m, 30, { dispute: { resolution_ref: '안건 2' } })
  const done = await adjust(admin, await newMember('pa'), 30)
  assert.equal(done.status, 'confirmed')
  const list = await ledger.listPendingAdjustments()
  const ids = list.map(r => r.id)
  assert.ok(ids.indexOf(p1.id) >= 0 && ids.indexOf(p1.id) < ids.indexOf(p2.id))
  assert.ok(!ids.includes(done.id))
  assert.ok(list.every(r => r.kind === 'adjustment' && r.status === 'pending'))
})

test('listPendingAdjustments: 행마다 승인이 필요한 이유(분쟁·관리자 대상·누적)', async () => {
  const admin = await newMember('adm', { admin: true })
  const disputed = await adjust(admin, await newMember('dr'), 30, {
    dispute: { resolution_ref: '안건 9' },
  })
  const adminTarget = await newMember('dra', { admin: true })
  const toAdmin = await adjust(admin, adminTarget, 30, { targetIsAdmin: true })
  // 기준 240분을 넘는 한 건
  const big = await adjust(admin, await newMember('drc'), 270)
  // 차감(회원 → coop)도 대상을 바르게 찾는다
  const debitTarget = await newMember('drd', { admin: true })
  await seedBalance(debitTarget, 600)
  const debit = await adjust(admin, debitTarget, 30, { direction: 'debit', targetIsAdmin: true })
  for (const row of [disputed, toAdmin, big, debit]) assert.equal(row.status, 'pending')

  const reasons = new Map(
    (await ledger.listPendingAdjustments()).map(r => [r.id, r.dual_approval_reason])
  )
  assert.equal(reasons.get(disputed.id), 'dispute')
  assert.equal(reasons.get(toAdmin.id), 'admin_target')
  assert.equal(reasons.get(big.id), 'cumulative_limit')
  assert.equal(reasons.get(debit.id), 'admin_target')
})

// ── 목록·집계 ───────────────────────────────────────────────────────────────

test('listPendingFor·listTransfersFor·listStalePending', async () => {
  const a = await newMember('list')
  const b = await newMember('list')
  const mine = await record(a, b)
  const theirs = await record(b, a)
  const p = await ledger.listPendingFor(a)
  assert.deepEqual(
    p.awaiting_other.map(r => r.id),
    [mine.id]
  )
  assert.deepEqual(
    p.to_confirm.map(r => r.id),
    [theirs.id]
  )

  await confirm(mine.id, b)
  const page1 = await ledger.listTransfersFor({ memberId: a, limit: 1, offset: 0 })
  assert.equal(page1.rows.length, 1)
  assert.equal(page1.has_next, true)
  const all = await ledger.listTransfersFor({ memberId: a, limit: 10, offset: 0 })
  assert.equal(all.rows.length, 2)
  assert.equal(all.has_next, false)
  const onlyGrant = await ledger.listTransfersFor({
    memberId: a,
    kinds: ['signup_grant'],
    limit: 10,
    offset: 0,
  })
  assert.equal(onlyGrant.rows.length, 0)

  const old = await insertRow({
    from_account: a,
    to_account: b,
    minutes: 30,
    kind: 'exchange',
    status: 'pending',
    created_by: a,
    counterparty_id: b,
    created_at: Date.now() - 8 * 86_400_000,
  })
  const stale = await ledger.listStalePending(7)
  assert.ok(stale.some(r => r.id === old))
  assert.ok(!stale.some(r => r.id === theirs.id))
})

test('monthlyOversight: 발행·회수·발행잔액·조합 업무 회원별·조정 전 건', async () => {
  const month = '2031-03'
  const at = Date.parse('2031-03-10T03:00:00Z')
  const m = await newMember('ov')
  const admin = await newMember('adm', { admin: true })
  await insertRow({
    from_account: 'coop',
    to_account: m,
    minutes: 120,
    kind: 'signup_grant',
    decided_at: at,
    created_at: at,
  })
  await insertRow({
    from_account: 'coop',
    to_account: m,
    minutes: 90,
    kind: 'coop_task',
    ref_type: 'listing',
    ref_id: 'ov-task',
    to_name: '오브',
    decided_at: at,
    created_at: at,
  })
  await insertRow({
    from_account: m,
    to_account: 'coop',
    minutes: 60,
    kind: 'adjustment',
    memo: '정정',
    created_by: admin,
    decided_by: admin,
    decided_at: at,
    created_at: at,
  })
  const o = await ledger.monthlyOversight(month)
  assert.equal(o.month, month)
  assert.equal(o.issued.signup_grant, 120)
  assert.equal(o.issued.coop_task, 90)
  assert.equal(o.issued.total, 210)
  assert.equal(o.retired.adjustment_debit, 60)
  assert.equal(o.retired.total, 60)
  assert.equal(typeof o.outstanding_minutes, 'number')
  assert.deepEqual(o.coop_task_by_member, [{ member_id: m, name: '오브', minutes: 90 }])
  assert.equal(o.adjustments.length, 1)
  assert.equal(o.adjustments[0].memo, '정정')
})

test('participationStats: 인원 2명 구간은 null로 숨긴다', async () => {
  const month = '2031-05'
  const at = Date.parse('2031-05-10T03:00:00Z')
  const a = await newMember('st')
  const b = await newMember('st')
  await insertRow({
    from_account: a,
    to_account: b,
    minutes: 60,
    kind: 'exchange',
    created_by: a,
    counterparty_id: b,
    decided_by: b,
    decided_at: at,
    created_at: at,
  })
  const s = await ledger.participationStats(month, SETTINGS)
  assert.equal(s.month, month)
  assert.equal(s.exchange_count, 1)
  assert.equal(s.exchange_minutes, 60)
  assert.equal(s.participants, null, '2명은 3명 미만')
  assert.equal(s.bidirectional_participants, null)
})

test('outstandingTrend: 각 달 말 기준 발행잔액을 받은 순서대로', async () => {
  const m = await newMember('tr')
  const base = await ledger.outstandingTrend(['2033-01', '2033-02', '2033-03'])
  await insertRow({
    from_account: 'coop',
    to_account: m,
    minutes: 120,
    kind: 'signup_grant',
    decided_at: Date.parse('2033-02-10T03:00:00Z'),
  })
  await insertRow({
    from_account: m,
    to_account: 'coop',
    minutes: 30,
    kind: 'redeem',
    decided_at: Date.parse('2033-03-10T03:00:00Z'),
  })
  const trend = await ledger.outstandingTrend(['2033-01', '2033-02', '2033-03'])
  assert.deepEqual(
    trend.map(r => r.month),
    ['2033-01', '2033-02', '2033-03']
  )
  assert.equal(trend[0].outstanding_minutes - base[0].outstanding_minutes, 0)
  assert.equal(trend[1].outstanding_minutes - base[1].outstanding_minutes, 120)
  assert.equal(trend[2].outstanding_minutes - base[2].outstanding_minutes, 90)
  const o = await ledger.monthlyOversight('2033-03')
  assert.equal(o.outstanding_minutes, trend[2].outstanding_minutes)
})
