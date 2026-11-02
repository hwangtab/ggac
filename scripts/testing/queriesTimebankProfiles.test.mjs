import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 타임뱅크 프로필·동의·재가입 승계(`src/db/queries/timebankProfiles.ts`, 스펙 §3·§9.3·§9.4)를
 * **마이그레이션을 적용한 파일 DB**로 검증한다. 테스트마다 새 회원을 만든다.
 *
 * 재가입 키는 테스트 전용 비밀값으로 만든다 — 실제 `BETTER_AUTH_SECRET`에 기대지 않는다.
 */

const DB_PATH = 'scripts/testing/.queries-timebank-profiles-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const SECRET = 'test-secret-not-real-profiles'
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
let profiles
let ledger
let keysFor
let db
let upsertProfile
let seq = 0

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  profiles = await import('../../src/db/queries/timebankProfiles.ts')
  ledger = await import('../../src/db/queries/timebankLedger.ts')
  ;({ rejoinKeysFor: keysFor } = await import('../../src/lib/timebank/rejoinKey.ts'))
  ;({ db } = await import('../../src/db/client.ts'))
  ;({ upsertProfile } = await import('../../src/db/queries/profiles.ts'))
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

async function newMember(label = 'm', extra = {}) {
  seq += 1
  const id = `${label}-${seq}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: `${label}${seq}`,
    registration_status: 'approved',
    is_active: true,
    ...extra,
  })
  return id
}

const keys = (email, phone = null) => keysFor({ email, phone }, SECRET)

const agree = (memberId, rejoinKeys = [], termsVersion = TERMS, settings = SETTINGS) =>
  profiles.agreeToTerms({ memberId, termsVersion, rejoinKeys, settings })

async function transfersOf(memberId) {
  const r = await client.execute({
    sql: `SELECT kind, from_account, to_account, minutes, status FROM timebank_transfers
          WHERE from_account = ? OR to_account = ? ORDER BY created_at`,
    args: [memberId, memberId],
  })
  return r.rows.map(row => ({ ...row }))
}

async function recordKeys(rejoinKeys, balance, at = new Date()) {
  await db.transaction(tx => profiles.recordWithdrawnKeys(tx, rejoinKeys, balance, at))
}

// ── 동의와 가입 크레딧 ─────────────────────────────────────────────────────────

test('첫 동의 → signup_grant 120, 잔액 120, 프로필은 기본 비공개', async () => {
  const id = await newMember('first')
  const res = await agree(id)
  assert.equal(res.granted, 'signup_grant')
  assert.equal(res.profile.member_id, id)
  assert.equal(res.profile.terms_version, TERMS)
  assert.equal(typeof res.profile.agreed_at, 'string')
  assert.equal(res.profile.visible, false)
  assert.deepEqual(res.profile.categories, [])
  assert.equal(await ledger.balanceOf(id), 120)
  const rows = await transfersOf(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'signup_grant')
  assert.equal(rows[0].from_account, 'coop')
  assert.equal(rows[0].status, 'confirmed')
})

test('재동의(판 변경) → granted none, 잔액 그대로, terms_version 갱신', async () => {
  const id = await newMember('reagree')
  await agree(id)
  const res = await agree(id, [], '2027-01')
  assert.equal(res.granted, 'none')
  assert.equal(res.profile.terms_version, '2027-01')
  assert.equal(await ledger.balanceOf(id), 120)
  assert.equal((await transfersOf(id)).length, 1)
})

test('같은 판 재동의도 아무것도 주지 않는다', async () => {
  const id = await newMember('same')
  await agree(id)
  const res = await agree(id)
  assert.equal(res.granted, 'none')
  assert.equal(await ledger.balanceOf(id), 120)
})

test('가입 크레딧 설정이 0이면 none', async () => {
  const id = await newMember('zero')
  const res = await agree(id, [], TERMS, { ...SETTINGS, signup_grant_minutes: 0 })
  assert.equal(res.granted, 'none')
  assert.equal(await ledger.balanceOf(id), 0)
  assert.equal((await transfersOf(id)).length, 0)
})

test('동시 첫 동의 두 번 → 가입 크레딧 한 번', async () => {
  const id = await newMember('race')
  const results = await Promise.allSettled([agree(id), agree(id)])
  for (const r of results) assert.equal(r.status, 'fulfilled', String(r.reason))
  const granted = results.map(r => r.value.granted).sort()
  assert.deepEqual(granted, ['none', 'signup_grant'])
  assert.equal(await ledger.balanceOf(id), 120)
})

test('프로필 행이 사라졌어도(관리 실수) 이미 받은 가입 크레딧은 다시 주지 않는다', async () => {
  const id = await newMember('regrant')
  await agree(id)
  await client.execute({ sql: 'DELETE FROM timebank_profiles WHERE member_id = ?', args: [id] })
  const res = await agree(id)
  assert.equal(res.granted, 'none')
  assert.equal(await ledger.balanceOf(id), 120)
})

// ── 재가입 승계 ──────────────────────────────────────────────────────────────

test('키 기록(−300)이 있는 상태에서 새 id로 동의 → carryover 300, 잔액 −300, grant 없음', async () => {
  const email = `neg-${Date.now()}@example.com`
  await recordKeys(keys(email, '010-5555-0001'), -300)
  const id = await newMember('rejoin-neg')
  // 이메일은 대소문자가 달라도 같은 키다.
  const res = await agree(id, keys(email.toUpperCase(), null))
  assert.equal(res.granted, 'carryover')
  assert.equal(await ledger.balanceOf(id), -300)
  const rows = await transfersOf(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'carryover')
  assert.equal(rows[0].from_account, id)
  assert.equal(rows[0].to_account, 'coop')
  assert.equal(rows[0].minutes, 300)

  // 재동의해도 승계는 다시 들어가지 않는다.
  const again = await agree(id, keys(email), '2027-01')
  assert.equal(again.granted, 'none')
  assert.equal(await ledger.balanceOf(id), -300)
})

test('전화 키로만 일치해도 승계한다', async () => {
  await recordKeys(keys(null, '010-7777-1234'), -90)
  const id = await newMember('rejoin-phone')
  const res = await agree(id, keys(`other-${seq}@example.com`, '01077771234'))
  assert.equal(res.granted, 'carryover')
  assert.equal(await ledger.balanceOf(id), -90)
})

test('키 기록(+200)이면 → none, 잔액 0', async () => {
  const email = `pos-${Date.now()}@example.com`
  await recordKeys(keys(email), 200)
  const id = await newMember('rejoin-pos')
  const res = await agree(id, keys(email))
  assert.equal(res.granted, 'none')
  assert.equal(await ledger.balanceOf(id), 0)
  assert.equal((await transfersOf(id)).length, 0)
})

test('키 기록(0)이면 → none', async () => {
  const email = `zero-${Date.now()}@example.com`
  await recordKeys(keys(email), 0)
  const id = await newMember('rejoin-zero')
  const res = await agree(id, keys(email))
  assert.equal(res.granted, 'none')
  assert.equal(await ledger.balanceOf(id), 0)
})

test('여러 키가 일치하면 가장 최근 탈퇴의 잔액을 본다', async () => {
  const email = `multi-${Date.now()}@example.com`
  const phone = '010-3333-4444'
  await recordKeys(keys(email), -120, new Date('2026-01-01T00:00:00Z'))
  await recordKeys(keys(null, phone), 60, new Date('2026-06-01T00:00:00Z'))
  const id = await newMember('rejoin-multi')
  const res = await agree(id, keys(email, phone))
  assert.equal(res.granted, 'none', '최근 탈퇴(+60)가 기준이다')
  assert.equal(await ledger.balanceOf(id), 0)
})

test('recordWithdrawnKeys 같은 키 두 번 → 1행, 최신 잔액·일자', async () => {
  const email = `twice-${Date.now()}@example.com`
  const k = keys(email)
  await recordKeys(k, -60, new Date('2026-02-01T00:00:00Z'))
  await recordKeys(k, -240, new Date('2026-03-01T00:00:00Z'))
  const r = await client.execute({
    sql: 'SELECT balance_minutes, withdrawn_at FROM timebank_withdrawn_keys WHERE key_hash = ?',
    args: [k[0]],
  })
  assert.equal(r.rows.length, 1)
  assert.equal(Number(r.rows[0].balance_minutes), -240)
  assert.equal(Number(r.rows[0].withdrawn_at), Date.parse('2026-03-01T00:00:00Z'))
})

test('recordWithdrawnKeys는 원문을 남기지 않고, 빈 키 목록은 아무것도 하지 않는다', async () => {
  const before = await client.execute('SELECT count(*) AS n FROM timebank_withdrawn_keys')
  await recordKeys([], -30)
  const afterEmpty = await client.execute('SELECT count(*) AS n FROM timebank_withdrawn_keys')
  assert.equal(Number(afterEmpty.rows[0].n), Number(before.rows[0].n))

  const email = `raw-${Date.now()}@example.com`
  await recordKeys(keys(email, '010-1212-3434'), -30)
  const all = await client.execute('SELECT key_hash FROM timebank_withdrawn_keys')
  for (const row of all.rows) {
    assert.match(String(row.key_hash), /^[0-9a-f]{64}$/)
    assert.ok(!String(row.key_hash).includes('@'))
  }
})

// ── 프로필 ───────────────────────────────────────────────────────────────────

test('getTimebankProfile: 없으면 null', async () => {
  const id = await newMember('none')
  assert.equal(await profiles.getTimebankProfile(id), null)
})

test('upsertTimebankProfile: 만들고 고친다. 미동의 행은 terms_version null, visible 기본 false', async () => {
  const id = await newMember('edit')
  const created = await profiles.upsertTimebankProfile(id, {
    offers: '  기타 레슨  ',
    needs: '이사 도움',
    categories: ['lesson', 'moving', 'lesson'],
  })
  assert.equal(created.member_id, id)
  assert.equal(created.offers, '기타 레슨')
  assert.equal(created.needs, '이사 도움')
  assert.deepEqual(created.categories, ['lesson', 'moving'])
  assert.equal(created.visible, false)
  assert.equal(created.terms_version, null)
  assert.equal(created.agreed_at, null)
  assert.deepEqual(Object.keys(created).sort(), [
    'agreed_at',
    'categories',
    'created_at',
    'member_id',
    'needs',
    'offers',
    'terms_version',
    'updated_at',
    'visible',
  ])

  const updated = await profiles.upsertTimebankProfile(id, { visible: true })
  assert.equal(updated.visible, true)
  assert.equal(updated.offers, '기타 레슨', '주지 않은 칸은 그대로')
  assert.deepEqual(await profiles.getTimebankProfile(id), updated)
})

test('upsertTimebankProfile은 동의 상태를 건드리지 않는다', async () => {
  const id = await newMember('keep')
  const { profile } = await agree(id)
  const updated = await profiles.upsertTimebankProfile(id, { offers: '사진 촬영' })
  assert.equal(updated.terms_version, profile.terms_version)
  assert.equal(updated.agreed_at, profile.agreed_at)
})

test('upsertTimebankProfile: 길이·분류·형식이 틀리면 TimebankProfileInputError', async () => {
  const id = await newMember('bad')
  const long = 'x'.repeat(1001)
  const cases = [
    [{ offers: long }, 'offers'],
    [{ needs: long }, 'needs'],
    [{ offers: 3 }, 'offers'],
    [{ categories: ['lesson', 'hacking'] }, 'categories'],
    [{ categories: 'lesson' }, 'categories'],
    [{ visible: 'yes' }, 'visible'],
  ]
  for (const [fields, field] of cases) {
    await assert.rejects(profiles.upsertTimebankProfile(id, fields), err => {
      assert.equal(err.name, 'TimebankProfileInputError', err.message)
      assert.equal(err.field, field)
      return true
    })
  }
  assert.equal(await profiles.getTimebankProfile(id), null, '실패한 입력은 아무것도 만들지 않는다')
  // 정확히 상한 길이는 받는다.
  const ok = await profiles.upsertTimebankProfile(id, { offers: 'y'.repeat(1000) })
  assert.equal(ok.offers.length, 1000)
})

// ── 목록 ─────────────────────────────────────────────────────────────────────

test('listParticipants: 현재 판 동의자만, (id, display_name)만', async () => {
  const current = await newMember('cur')
  const old = await newMember('old')
  const never = await newMember('never')
  const suspended = await newMember('susp')
  const leaving = await newMember('leaving')
  await agree(current)
  await agree(old, [], '2025-01')
  await profiles.upsertTimebankProfile(never, { offers: 'x' })
  await agree(suspended)
  await agree(leaving)
  await client.execute({
    sql: 'UPDATE member_profiles SET is_suspended = 1, is_active = 0 WHERE id = ?',
    args: [suspended],
  })
  await client.execute({
    sql: 'UPDATE member_profiles SET withdrawal_requested_at = ? WHERE id = ?',
    args: [Date.now(), leaving],
  })

  const list = await profiles.listParticipants(TERMS)
  const ids = list.map(r => r.id)
  assert.ok(ids.includes(current))
  for (const excluded of [old, never, suspended, leaving]) assert.ok(!ids.includes(excluded))
  for (const row of list) assert.deepEqual(Object.keys(row).sort(), ['display_name', 'id'])
  assert.equal(list.find(r => r.id === current).display_name, `cur${current.split('-')[1]}`)
})

test('listDirectory: 현재 판 동의자 중 visible = true만, 공개 칸만', async () => {
  const shown = await newMember('shown')
  const hidden = await newMember('hidden')
  await agree(shown)
  await agree(hidden)
  await profiles.upsertTimebankProfile(shown, {
    offers: '녹음 도움',
    needs: '',
    categories: ['production_help'],
    visible: true,
  })
  await profiles.upsertTimebankProfile(hidden, { offers: '비밀', visible: false })

  // 공개로 둔 채 옛 판에만 동의한 회원 — 지금 판에 동의하기 전에는 보이지 않는다
  const stale = await newMember('stale')
  await agree(stale, [], '2025-01')
  await profiles.upsertTimebankProfile(stale, { offers: '옛 판', visible: true })

  const dir = await profiles.listDirectory(TERMS)
  const ids = dir.map(r => r.id)
  assert.ok(ids.includes(shown))
  assert.ok(!ids.includes(hidden))
  assert.ok(!ids.includes(stale), '현재 판 동의자만(listParticipants와 같은 기준)')
  const row = dir.find(r => r.id === shown)
  assert.deepEqual(Object.keys(row).sort(), ['categories', 'display_name', 'id', 'needs', 'offers'])
  assert.deepEqual(row.categories, ['production_help'])
  assert.equal(row.offers, '녹음 도움')
})
