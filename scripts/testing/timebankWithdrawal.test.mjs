import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 탈퇴 트랜잭션의 타임뱅크 단계(스펙 §9.3, 계획 Task 10)를 **마이그레이션을 적용한
 * 파일 DB**(트리거 포함)에서 실제 `withdrawMember`로 검증한다.
 *
 * - 7단계의 결과(pending 취소·정산·키·프로필·글·자원·이름 묘비)
 * - 순서 주의: 재가입 키는 묘비 이메일이 아니라 **원래** 이메일·전화로 만든다
 * - 음수 탈퇴 → `timebankNegativeMinutes`, 같은 이메일 재가입 → carryover
 * - 탈퇴가 실패하면(마지막 관리자, 타임뱅크 단계 **뒤**의 실패, 비밀값 없음) 전부 롤백
 * - `check-invariants.mjs`의 타임뱅크 불변식: 정상 0, 인위적 위반 ≥ 1
 *
 * 다른 `queries*.test.mjs`처럼 `TURSO_DATABASE_URL`을 모듈 import 전에 파일 스코프에서
 * 고정한다(운영 자격증명이 셸에 남아 있어도 운영에 쓰지 않게).
 */

const DB_PATH = 'scripts/testing/.timebank-withdrawal-test.db'
const INV_DB_PATH = 'scripts/testing/.timebank-withdrawal-invariants-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
const SECRET = 'test-secret-not-real-withdrawal'
process.env.BETTER_AUTH_SECRET = SECRET

const TOMBSTONE = '탈퇴한 조합원'
const TERMS = '2026-11'
const SETTINGS = Object.freeze({
  enabled: true,
  coop_tasks_enabled: false,
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
let withdrawal
let ledger
let profiles
let keysFor
let invariants
let seq = 0

before(async () => {
  for (const p of [DB_PATH, INV_DB_PATH]) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${p}${suffix}`, { force: true })
  }
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  withdrawal = await import('../../src/db/queries/withdrawal.ts')
  ledger = await import('../../src/db/queries/timebankLedger.ts')
  profiles = await import('../../src/db/queries/timebankProfiles.ts')
  ;({ rejoinKeysFor: keysFor } = await import('../../src/lib/timebank/rejoinKey.ts'))
  invariants = await import('../turso/check-invariants.mjs')
})

after(() => {
  client?.close()
  for (const p of [DB_PATH, INV_DB_PATH]) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${p}${suffix}`, { force: true })
  }
})

// ── 시드 ─────────────────────────────────────────────────────────────────────

async function seedMember(
  c,
  { label = 'm', requested = false, isAdmin = false, phone = null } = {}
) {
  seq += 1
  const id = `${label}-${seq}`
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, phone_number, registration_status, withdrawal_requested_at,
             is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'approved', ?, 1, ?, ?, ?)`,
    args: [
      id,
      `${id}@Example.Test`,
      `이름${seq}`,
      phone,
      requested ? now : null,
      isAdmin ? 1 : 0,
      now,
      now,
    ],
  })
  return id
}

async function seedProfile(c, memberId) {
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO timebank_profiles (member_id, offers, needs, categories, visible, terms_version, agreed_at, created_at, updated_at)
          VALUES (?, '요리', '수리', '[]', 1, ?, ?, ?, ?)`,
    args: [memberId, TERMS, now, now, now],
  })
}

/** 원장 행 하나. 트리거는 UPDATE·DELETE만 막으므로 INSERT로 바로 심는다. */
async function seedTransfer(
  c,
  {
    from,
    to,
    minutes,
    kind = 'exchange',
    status = 'confirmed',
    createdBy = from,
    counterparty = null,
    fromName = null,
    toName = null,
  }
) {
  const id = randomUUID()
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO timebank_transfers
            (id, from_account, to_account, minutes, kind, status, created_by, counterparty_id,
             decided_by, decided_at, memo, from_name, to_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      from,
      to,
      minutes,
      kind,
      status,
      createdBy,
      counterparty,
      status === 'pending' ? null : createdBy,
      status === 'pending' ? null : now,
      kind === 'adjustment' ? '조정 사유' : null,
      fromName,
      toName,
      now,
      now,
    ],
  })
  return id
}

async function seedListing(c, authorId) {
  const id = randomUUID()
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO timebank_listings (id, author_id, kind, category, title, description, status, is_deleted, created_at, updated_at)
          VALUES (?, ?, 'offer', 'lesson', '반찬 나눔', '본문', 'open', 0, ?, ?)`,
    args: [id, authorId, now, now],
  })
  return id
}

async function seedVolunteer(c, listingId, memberId) {
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO timebank_task_volunteers (id, listing_id, member_id, volunteered_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), listingId, memberId, now, now, now],
  })
}

const rows = async (sql, args = []) => (await client.execute({ sql, args })).rows
const one = async (sql, args = []) => (await rows(sql, args))[0]
const count = async (sql, args = []) => Number((await one(sql, args)).n)

async function keyRow(keyHash) {
  return one(
    'SELECT balance_minutes b, withdrawn_at w FROM timebank_withdrawn_keys WHERE key_hash = ?',
    [keyHash]
  )
}

/**
 * 참여자 한 명(+상대 한 명 +관리자 한 명)과 타임뱅크 흔적 전부. 잔액은 `balance`가
 * 되도록 확정 행을 심는다(양수: 상대 → 나, 음수: 나 → 상대).
 */
async function seedParticipant({ balance = 90, phone = '+82 10-1234-5678' } = {}) {
  const me = await seedMember(client, { label: 'tb', requested: true, phone })
  const other = await seedMember(client, { label: 'peer' })
  const admin = await seedMember(client, { label: 'adm', isAdmin: true })
  await seedProfile(client, me)
  await seedProfile(client, other)

  if (balance > 0) {
    await seedTransfer(client, {
      from: other,
      to: me,
      minutes: balance,
      fromName: '상대',
      toName: '나',
    })
  } else if (balance < 0) {
    await seedTransfer(client, {
      from: me,
      to: other,
      minutes: -balance,
      fromName: '나',
      toName: '상대',
    })
  }
  // 상쇄되는 확정 두 건 — 이름 덮기가 from·to 양쪽에서 일어나는지 본다.
  await seedTransfer(client, { from: me, to: other, minutes: 60, fromName: '나', toName: '상대' })
  await seedTransfer(client, { from: other, to: me, minutes: 60, fromName: '상대', toName: '나' })

  const pending = {
    // 내가 기록, 상대가 확인할 차례
    mine: await seedTransfer(client, {
      from: me,
      to: other,
      minutes: 30,
      status: 'pending',
      counterparty: other,
      fromName: '나',
      toName: '상대',
    }),
    // 상대가 기록, 내가 확인할 차례
    theirs: await seedTransfer(client, {
      from: other,
      to: me,
      minutes: 30,
      status: 'pending',
      createdBy: other,
      counterparty: me,
      fromName: '상대',
      toName: '나',
    }),
    // 나를 대상으로 한 조정(관리자 기록, 두 번째 승인 대기)
    adjustment: await seedTransfer(client, {
      from: 'coop',
      to: me,
      minutes: 300,
      kind: 'adjustment',
      status: 'pending',
      createdBy: admin,
      toName: '나',
    }),
    // 나와 무관한 pending — 그대로 남아야 한다
    unrelated: await seedTransfer(client, {
      from: other,
      to: admin,
      minutes: 30,
      status: 'pending',
      createdBy: other,
      counterparty: admin,
      fromName: '상대',
      toName: '관리자',
    }),
  }

  const listing = await seedListing(client, me)
  const otherListing = await seedListing(client, other)
  await seedVolunteer(client, otherListing, me)

  const email = `${me}@Example.Test`
  return { me, other, admin, pending, listing, otherListing, email, phone }
}

async function snapshot(me) {
  return {
    transfers: await rows(
      `SELECT id, status, from_name, to_name, decided_by FROM timebank_transfers
        WHERE from_account = ? OR to_account = ? OR counterparty_id = ? ORDER BY id`,
      [me, me, me]
    ),
    profiles: await count('SELECT count(*) n FROM timebank_profiles WHERE member_id = ?', [me]),
    listings: await rows(
      'SELECT id, is_deleted FROM timebank_listings WHERE author_id = ? ORDER BY id',
      [me]
    ),
    volunteers: await rows(
      'SELECT id, withdrawn_at FROM timebank_task_volunteers WHERE member_id = ?',
      [me]
    ),
    keys: await count('SELECT count(*) n FROM timebank_withdrawn_keys'),
    status: (await one('SELECT registration_status s FROM member_profiles WHERE id = ?', [me])).s,
  }
}

// ── 7단계 ────────────────────────────────────────────────────────────────────

test('탈퇴 확정: pending 취소·정산·프로필·글·자원·이름 묘비가 한 번에 된다', async () => {
  const s = await seedParticipant({ balance: 90 })
  const outcome = await withdrawal.withdrawMember(s.me)
  assert.equal(outcome.ok, true)
  // 양수 잔액은 이사회 보고 대상이 아니다.
  assert.equal(outcome.timebankNegativeMinutes, undefined)

  // 1. 당사자인 pending(양쪽 + 조정) 전부 canceled, 무관한 pending은 그대로
  for (const id of [s.pending.mine, s.pending.theirs, s.pending.adjustment]) {
    const r = await one(
      'SELECT status, decided_by, decided_at FROM timebank_transfers WHERE id = ?',
      [id]
    )
    assert.equal(r.status, 'canceled', id)
    assert.equal(r.decided_by, s.me)
    assert.ok(r.decided_at != null)
  }
  assert.equal(
    (await one('SELECT status FROM timebank_transfers WHERE id = ?', [s.pending.unrelated])).status,
    'pending'
  )

  // 3. 잔액 0, 정산 1행(회원 → coop, 90분)
  assert.equal(await ledger.balanceOf(s.me), 0)
  const settlements = await rows(
    `SELECT from_account, to_account, minutes, status, memo FROM timebank_transfers
      WHERE kind = 'withdrawal_settlement' AND (from_account = ? OR to_account = ?)`,
    [s.me, s.me]
  )
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].from_account, s.me)
  assert.equal(settlements[0].to_account, 'coop')
  assert.equal(Number(settlements[0].minutes), 90)
  assert.equal(settlements[0].status, 'confirmed')
  assert.ok(settlements[0].memo)

  // 6. 프로필 없음, 글 soft delete, 자원 철회. 상대 글은 그대로.
  assert.equal(
    await count('SELECT count(*) n FROM timebank_profiles WHERE member_id = ?', [s.me]),
    0
  )
  assert.equal(
    await count('SELECT count(*) n FROM timebank_profiles WHERE member_id = ?', [s.other]),
    1
  )
  assert.equal(
    Number((await one('SELECT is_deleted d FROM timebank_listings WHERE id = ?', [s.listing])).d),
    1
  )
  assert.equal(
    Number(
      (await one('SELECT is_deleted d FROM timebank_listings WHERE id = ?', [s.otherListing])).d
    ),
    0
  )
  assert.ok(
    (await one('SELECT withdrawn_at w FROM timebank_task_volunteers WHERE member_id = ?', [s.me]))
      .w != null
  )

  // 7. 이 회원 쪽 이름만 묘비, 상대 쪽 이름은 그대로
  const named = await rows(
    'SELECT from_account, to_account, from_name, to_name FROM timebank_transfers WHERE from_account = ? OR to_account = ?',
    [s.me, s.me]
  )
  assert.ok(named.length >= 5)
  for (const r of named) {
    if (r.from_account === s.me) assert.equal(r.from_name, TOMBSTONE)
    if (r.to_account === s.me) assert.equal(r.to_name, TOMBSTONE)
    if (r.from_account === s.other) assert.equal(r.from_name, '상대')
    if (r.to_account === s.other) assert.equal(r.to_name, '상대')
  }
})

test('재가입 키는 원래 이메일·전화로 만든다 — 묘비 이메일의 키는 없다(순서 회귀 방지)', async () => {
  const s = await seedParticipant({ balance: 120, phone: '010-9999-0001' })
  assert.equal((await withdrawal.withdrawMember(s.me)).ok, true)

  const [emailKey, phoneKey] = keysFor({ email: s.email, phone: s.phone }, SECRET)
  assert.ok(emailKey && phoneKey)
  for (const k of [emailKey, phoneKey]) {
    const r = await keyRow(k)
    assert.ok(r, '원래 이메일·전화의 키가 있어야 한다')
    // 정산 **전** 잔액
    assert.equal(Number(r.b), 120)
  }

  const tombstoneEmail = (await one('SELECT email FROM member_profiles WHERE id = ?', [s.me])).email
  assert.match(tombstoneEmail, /^withdrawn\+.*@ggac\.invalid$/)
  const [tombKey] = keysFor({ email: tombstoneEmail, phone: null }, SECRET)
  assert.equal(
    await keyRow(tombKey),
    undefined,
    '묘비 이메일로 키를 만들면 승계가 조용히 무력화된다'
  )
})

test('같은 키가 이미 있으면(재가입 후 재탈퇴) 최신 잔액·일자로 덮는다', async () => {
  const s = await seedParticipant({ balance: 30, phone: null })
  const [emailKey] = keysFor({ email: s.email, phone: null }, SECRET)
  await client.execute({
    sql: 'INSERT INTO timebank_withdrawn_keys (key_hash, balance_minutes, withdrawn_at) VALUES (?, -600, 1)',
    args: [emailKey],
  })
  assert.equal((await withdrawal.withdrawMember(s.me)).ok, true)
  const r = await keyRow(emailKey)
  assert.equal(Number(r.b), 30)
  assert.ok(Number(r.w) > 1)
})

test('음수 잔액 −300 탈퇴 → timebankNegativeMinutes 300, 조합이 떠안고, 같은 이메일 재가입은 carryover 300', async () => {
  const s = await seedParticipant({ balance: -300, phone: null })
  const outcome = await withdrawal.withdrawMember(s.me)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.timebankNegativeMinutes, 300)
  assert.equal(await ledger.balanceOf(s.me), 0)

  const [settle] = await rows(
    `SELECT from_account, to_account, minutes FROM timebank_transfers
      WHERE kind = 'withdrawal_settlement' AND to_account = ?`,
    [s.me]
  )
  assert.equal(settle.from_account, 'coop')
  assert.equal(Number(settle.minutes), 300)
  assert.equal(Number((await keyRow(keysFor({ email: s.email, phone: null }, SECRET)[0])).b), -300)

  // 이사회 보고(§7.4) — 마이너스 탈퇴 정산은 월 보고에 잡힌다.
  const { kstMonthKey } = await import('../../src/lib/timebank/month.ts')
  const report = await ledger.monthlyOversight(kstMonthKey(new Date()))
  assert.ok(report.negative_withdrawals.some(r => r.member_id === s.me && r.minutes === 300))

  // 같은 이메일로 새 계정(묘비가 이메일 칸을 비워 줬다) → 동의 시 승계
  const fresh = `rejoin-${++seq}`
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO member_profiles (id, email, display_name, registration_status, is_active, created_at, updated_at)
          VALUES (?, ?, '다시 온 사람', 'approved', 1, ?, ?)`,
    args: [fresh, s.email.toLowerCase(), now, now],
  })
  const { granted } = await profiles.agreeToTerms({
    memberId: fresh,
    termsVersion: TERMS,
    rejoinKeys: keysFor({ email: s.email.toLowerCase(), phone: null }, SECRET),
    settings: SETTINGS,
  })
  assert.equal(granted, 'carryover')
  const [carry] = await rows(
    "SELECT minutes FROM timebank_transfers WHERE kind = 'carryover' AND from_account = ?",
    [fresh]
  )
  assert.equal(Number(carry.minutes), 300)
  assert.equal(await ledger.balanceOf(fresh), -300)
})

test('타임뱅크에 참여하지 않은 회원(프로필·잔액 없음)은 키를 남기지 않고, 비밀값 없이도 탈퇴된다', async () => {
  const me = await seedMember(client, { label: 'plain', requested: true })
  const keysBefore = await count('SELECT count(*) n FROM timebank_withdrawn_keys')
  const saved = process.env.BETTER_AUTH_SECRET
  delete process.env.BETTER_AUTH_SECRET
  try {
    const outcome = await withdrawal.withdrawMember(me)
    assert.equal(outcome.ok, true)
    assert.equal(outcome.timebankNegativeMinutes, undefined)
  } finally {
    process.env.BETTER_AUTH_SECRET = saved
  }
  assert.equal(await count('SELECT count(*) n FROM timebank_withdrawn_keys'), keysBefore)
})

// ── 롤백 ─────────────────────────────────────────────────────────────────────

test('마지막 관리자라 실패하면 타임뱅크도 그대로다(pending 유지)', async () => {
  // 이 테스트 동안 다른 승인 관리자가 없어야 한다 — 앞 테스트의 관리자들을 잠시 내린다.
  const admins = (
    await rows(
      "SELECT id FROM member_profiles WHERE is_admin = 1 AND registration_status = 'approved'"
    )
  ).map(r => r.id)
  await client.execute(
    `UPDATE member_profiles SET is_admin = 0 WHERE id IN (${admins.map(() => '?').join(',')})`,
    admins
  )
  try {
    const s = await seedParticipant({ balance: 90 })
    await client.execute({
      sql: 'UPDATE member_profiles SET is_admin = 0 WHERE id = ?',
      args: [s.admin],
    })
    await client.execute({
      sql: 'UPDATE member_profiles SET is_admin = 1 WHERE id = ?',
      args: [s.me],
    })
    const before = await snapshot(s.me)
    assert.deepEqual(await withdrawal.withdrawMember(s.me), { ok: false, reason: 'last_admin' })
    assert.deepEqual(await snapshot(s.me), before)
    assert.equal(await ledger.balanceOf(s.me), 90)
  } finally {
    await client.execute(
      `UPDATE member_profiles SET is_admin = 1 WHERE id IN (${admins.map(() => '?').join(',')})`,
      admins
    )
  }
})

test('타임뱅크 단계 **뒤**에서 실패해도 타임뱅크 변경이 전부 롤백된다', async () => {
  const s = await seedParticipant({ balance: -120, phone: '010-5555-0002' })
  const now = Date.now()
  // Better Auth user 행 묘비 덮기(타임뱅크 단계보다 뒤)를 강제로 실패시킨다.
  await client.execute({
    sql: `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, '나', ?, 1, ?, ?)`,
    args: [s.me, s.email, now, now],
  })
  await client.execute(`CREATE TRIGGER test_fail_user_update BEFORE UPDATE ON user
    BEGIN SELECT RAISE(ABORT, 'forced failure after timebank steps'); END`)
  const before = await snapshot(s.me)
  try {
    await assert.rejects(
      () => withdrawal.withdrawMember(s.me),
      err => /forced failure/.test(`${err?.message} ${err?.cause?.message}`)
    )
  } finally {
    await client.execute('DROP TRIGGER test_fail_user_update')
  }
  assert.deepEqual(await snapshot(s.me), before)
  assert.equal(await ledger.balanceOf(s.me), -120)
  assert.equal(
    await count(
      "SELECT count(*) n FROM timebank_transfers WHERE kind = 'withdrawal_settlement' AND (from_account = ? OR to_account = ?)",
      [s.me, s.me]
    ),
    0
  )
  for (const k of keysFor({ email: s.email, phone: s.phone }, SECRET))
    assert.equal(await keyRow(k), undefined)
  assert.equal(before.status, 'approved')
})

test('BETTER_AUTH_SECRET이 없으면 참여자의 탈퇴는 실패하고(키를 건너뛰지 않는다) 전부 롤백된다', async () => {
  const s = await seedParticipant({ balance: 60 })
  const before = await snapshot(s.me)
  const saved = process.env.BETTER_AUTH_SECRET
  delete process.env.BETTER_AUTH_SECRET
  try {
    await assert.rejects(() => withdrawal.withdrawMember(s.me), /BETTER_AUTH_SECRET/)
  } finally {
    process.env.BETTER_AUTH_SECRET = saved
  }
  assert.deepEqual(await snapshot(s.me), before)
  assert.equal(await ledger.balanceOf(s.me), 60)
})

// ── 불변식 ───────────────────────────────────────────────────────────────────

const TIMEBANK_INVARIANTS = [
  'timebank_withdrawn_have_zero_balance',
  'timebank_withdrawn_have_no_pending',
  'timebank_withdrawn_have_no_profile',
  'timebank_withdrawn_names_tombstoned',
  'timebank_ledger_sums_to_zero',
  'timebank_transfers_core_immutable_present',
  'timebank_transfers_final_immutable_present',
  'timebank_transfers_no_delete_present',
]

const pick = names => invariants.allInvariants().filter(i => names.includes(i.constraint))

test('타임뱅크 불변식: 실제 탈퇴 뒤 DB에서 전부 0건', async () => {
  const list = pick(TIMEBANK_INVARIANTS)
  assert.deepEqual(list.map(i => i.constraint).sort(), [...TIMEBANK_INVARIANTS].sort())
  const results = await invariants.checkInvariants(client, list)
  for (const r of results) assert.equal(r.status, 'ok', `${r.constraint}: ${r.violations}`)
})

test('타임뱅크 불변식: 각각 인위적 위반에서 1건 이상, 마이그레이션 전 DB에서는 건너뛴다', async () => {
  const c = createClient({ url: `file:${INV_DB_PATH}` })
  try {
    await applyMigrations(c)
    const alive = await seedMember(c, { label: 'alive' })
    const gone = await seedMember(c, { label: 'gone' })
    await c.execute({
      sql: `UPDATE member_profiles SET registration_status = 'withdrawn', display_name = ? WHERE id = ?`,
      args: [TOMBSTONE, gone],
    })
    await seedProfile(c, alive)
    // 정상 상태: 탈퇴자 흔적은 묘비 이름 + 잔액 0(들어오고 나감)
    await seedTransfer(c, {
      from: 'coop',
      to: gone,
      minutes: 60,
      kind: 'signup_grant',
      toName: TOMBSTONE,
    })
    await seedTransfer(c, {
      from: gone,
      to: 'coop',
      minutes: 60,
      kind: 'withdrawal_settlement',
      fromName: TOMBSTONE,
    })
    await seedTransfer(c, {
      from: 'coop',
      to: alive,
      minutes: 120,
      kind: 'signup_grant',
      toName: '산 사람',
    })

    const run = async name => (await invariants.checkInvariants(c, pick([name])))[0]
    for (const name of TIMEBANK_INVARIANTS) assert.equal((await run(name)).status, 'ok', name)

    const expectViolation = async (name, sql, args = []) => {
      await c.execute({ sql, args })
      const r = await run(name)
      assert.equal(r.status, 'violated', name)
      assert.ok(r.violations >= 1, name)
    }

    await expectViolation(
      'timebank_withdrawn_have_zero_balance',
      `INSERT INTO timebank_transfers (id, from_account, to_account, minutes, kind, status, from_name, to_name)
       VALUES ('v-bal', 'coop', ?, 30, 'coop_task', 'confirmed', NULL, ?)`,
      [gone, TOMBSTONE]
    )
    await expectViolation(
      'timebank_withdrawn_have_no_pending',
      `INSERT INTO timebank_transfers (id, from_account, to_account, minutes, kind, status, counterparty_id, from_name, to_name)
       VALUES ('v-pend', ?, ?, 30, 'exchange', 'pending', ?, '산 사람', ?)`,
      [alive, gone, gone, TOMBSTONE]
    )
    await expectViolation(
      'timebank_withdrawn_have_no_profile',
      `INSERT INTO timebank_profiles (member_id, terms_version, agreed_at) VALUES (?, '2026-11', 1)`,
      [gone]
    )
    await expectViolation(
      'timebank_withdrawn_names_tombstoned',
      `INSERT INTO timebank_transfers (id, from_account, to_account, minutes, kind, status, from_name, to_name)
       VALUES ('v-name', ?, ?, 30, 'exchange', 'canceled', '실명', '산 사람')`,
      [gone, alive]
    )
    // 회원도 coop도 아닌 계좌로 간 확정 이동 — 합계가 회원·조합 안에서 닫히지 않는다.
    await expectViolation(
      'timebank_ledger_sums_to_zero',
      `INSERT INTO timebank_transfers (id, from_account, to_account, minutes, kind, status)
       VALUES ('v-ghost', 'coop', 'ghost-account', 30, 'coop_task', 'confirmed')`
    )
    for (const trig of ['core_immutable', 'final_immutable', 'no_delete']) {
      await expectViolation(
        `timebank_transfers_${trig}_present`,
        `DROP TRIGGER timebank_transfers_${trig}`
      )
    }
  } finally {
    c.close()
  }

  // 타임뱅크 표가 없는 DB(이 마이그레이션 적용 전 운영 덤프)에서는 위반이 아니다.
  const bare = createClient({ url: ':memory:' })
  try {
    await bare.execute(
      'CREATE TABLE member_profiles (id TEXT PRIMARY KEY, registration_status TEXT)'
    )
    await bare.execute("INSERT INTO member_profiles VALUES ('x', 'approved')")
    const results = await invariants.checkInvariants(bare, pick(TIMEBANK_INVARIANTS))
    for (const r of results) assert.notEqual(r.status, 'violated', r.constraint)
  } finally {
    bare.close()
  }
})

// ── 라우트 ───────────────────────────────────────────────────────────────────

test('관리자 탈퇴 확정 라우트는 커밋 뒤에 음수 탈퇴를 이사에게 알린다', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/app/api/admin/member-action/route.ts', 'utf8')
  const commitAt = src.indexOf('await withdrawMember(')
  const notifyAt = src.indexOf('await notifyNegativeWithdrawal(')
  assert.ok(commitAt >= 0 && notifyAt >= 0, '두 호출을 찾지 못했다')
  assert.ok(commitAt < notifyAt, '알림은 탈퇴 트랜잭션 뒤에 있어야 한다')
  assert.match(src, /getDirectorRoster\(\)/)
  assert.match(src, /outcome\.timebankNegativeMinutes/)
})
