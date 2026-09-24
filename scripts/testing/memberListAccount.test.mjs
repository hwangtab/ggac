import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 조합원 목록이 계좌를 싣지 않는가 — **실제 SQLite 파일 DB**를 상대로 본다.
 * 스키마는 `src/db/migrations/`를 그대로 실행해 만든다
 * (`scripts/testing/fundingPayoutAccount.test.mjs`와 같은 패턴).
 *
 * 소스 문자열을 훑는 검사로는 이걸 지킬 수 없다. `account_number`라는 글자가
 * 라우트에서 사라져도, 행 전체를 그대로 펼치는 한 줄이면 값은 다시 나간다.
 * 그래서 여기서는 **계좌가 채워진 조합원을 실제로 넣고**, 목록 쿼리로 읽어,
 * 응답 한 줄을 만들어, 그 JSON 안에 계좌번호가 있는지 본다.
 */

const DB_PATH = 'scripts/testing/.member-list-account-test.db'

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const { listProfiles, getPayoutAccount } = await import('../../src/db/queries/profiles.ts')
const { toMemberListRow } = await import('../../src/lib/members/memberListRow.ts')

const ACCOUNT = { bank: '국민은행', number: '123456-01-789012', holder: '김조합' }

async function seedProfile(id, { bank = null, account = null, holder = null } = {}) {
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, real_name, phone_number, birth_date,
             bank_name, account_number, account_holder, registration_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
    args: [
      id,
      `조합원-${id}`,
      `${id}@test.local`,
      '주민등록상이름',
      '010-0000-0000',
      '1990-01-01',
      bank,
      account,
      holder,
    ],
  })
}

/** 라우트가 목록을 만드는 그대로 — 쿼리 한 번, 줄마다 `toMemberListRow`. */
async function listResponseMembers() {
  const { rows } = await listProfiles({ limit: 100, offset: 0 })
  return rows.map(toMemberListRow)
}

// ---------------------------------------------------------------- 목록

test('목록 응답에는 계좌번호가 없다 — 관리자 화면 한 번이 전 조합원 계좌의 대량 조회였다', async () => {
  await seedProfile('member-with-account', {
    bank: ACCOUNT.bank,
    account: ACCOUNT.number,
    holder: ACCOUNT.holder,
  })
  const members = await listResponseMembers()
  const serialized = JSON.stringify(members)
  for (const leaked of [ACCOUNT.number, ACCOUNT.bank, ACCOUNT.holder]) {
    assert.equal(serialized.includes(leaked), false, `${leaked}가 목록 응답에 실렸다`)
  }
})

test('목록 한 줄에는 계좌 관련 키가 참·거짓 하나뿐이다', async () => {
  const [row] = await listResponseMembers()
  const keys = Object.keys(row)
  for (const forbidden of ['bank_name', 'account_number', 'account_holder']) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} 키가 목록 응답에 남아 있다`)
  }
  assert.equal(typeof row.bank_account_registered, 'boolean')
})

test('계좌가 등록된 조합원은 참, 등록하지 않은 조합원은 거짓이다', async () => {
  await seedProfile('member-no-account')
  const members = await listResponseMembers()
  const byId = new Map(members.map(m => [m.id, m]))
  assert.equal(byId.get('member-with-account').bank_account_registered, true)
  assert.equal(byId.get('member-no-account').bank_account_registered, false)
})

test('은행만 있고 계좌번호가 없으면 등록된 것이 아니다 — 정산 쪽과 같은 판정을 쓴다', async () => {
  await seedProfile('member-bank-only', { bank: '신한은행' })
  await seedProfile('member-blank', { bank: '   ', account: ' \t ' })
  const byId = new Map((await listResponseMembers()).map(m => [m.id, m]))
  assert.equal(byId.get('member-bank-only').bank_account_registered, false)
  assert.equal(byId.get('member-blank').bank_account_registered, false)
})

test('목록은 실명·전화번호 같은 기존 필드는 그대로 준다 — 화면이 조용히 비지 않아야 한다', async () => {
  const byId = new Map((await listResponseMembers()).map(m => [m.id, m]))
  const row = byId.get('member-with-account')
  assert.equal(row.real_name, '주민등록상이름')
  assert.equal(row.phone_number, '010-0000-0000')
  assert.equal(row.email, 'member-with-account@test.local')
  assert.equal(row.registration_status, 'approved')
  // 생년월일은 예전에도 목록에 없었다. 새 함수가 넓히지 않았는지 함께 본다.
  assert.equal('birth_date' in row, false)
})

// ---------------------------------------------------------------- 한 사람

test('한 사람을 지목한 조회에서는 계좌 세 칸이 그대로 나온다 — 화면이 빈 칸을 그리면 안 된다', async () => {
  const account = await getPayoutAccount('member-with-account')
  assert.deepEqual(account, {
    bank_name: ACCOUNT.bank,
    account_number: ACCOUNT.number,
    account_holder: ACCOUNT.holder,
  })
})
