import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 정산금을 **어디로 보내는가** — 실제 SQLite 파일 DB를 상대로 검증한다.
 * 스키마는 `src/db/migrations/`를 그대로 실행해 만든다
 * (`scripts/testing/queriesProfiles.test.mjs`와 같은 패턴).
 *
 * 가장 중요한 경우는 **계좌를 한 번도 등록하지 않은 개설자**다. 그 사람의
 * 정산을 지급 완료로 기록하면 "보낸 적 없는 곳으로 보냈다"는 기록이 남는데,
 * 정산 기능은 바로 그런 기록을 막으려고 만든 것이다. 그래서 여기서 못박는
 * 것은 둘이다 —
 *
 * ① 계좌가 비었다는 사실을 쿼리 계층이 **정확히** 알려 주는가(공백만 적힌
 *    칸을 "있다"로 세지 않는가),
 * ② 계좌를 읽는 함수가 **계좌 세 칸 말고는 아무것도 실어 오지 않는가** —
 *    실명·전화번호·생년월일이 딸려 오면 그 객체가 응답에 실릴 여지가 생긴다.
 */

const DB_PATH = 'scripts/testing/.funding-payout-account-test.db'
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

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

const { getPayoutAccount } = await import(PROFILES_MODULE_URL.href)
const { isPayoutAccountRegistered, isPayoutAccountHolderMissing, PAYOUT_ACCOUNT_SETTINGS_PATH } =
  await import('../../src/lib/funding/payoutAccount.ts')
const { buildSettlementPreparedNotice } = await import('../../src/lib/funding/notifyContent.ts')

/** 계좌 칸만 골라 넣고 나머지는 NOT NULL을 채우는 최소값으로 둔다. */
async function seedProfile(id, { bank = null, account = null, holder = null } = {}) {
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, real_name, phone_number, birth_date,
             bank_name, account_number, account_holder)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      `개설자-${id}`,
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

// ---------------------------------------------------------------- 계좌가 없는 개설자

test('계좌를 한 번도 등록하지 않은 개설자 — 세 칸이 전부 null이고 "등록되지 않음"이다', async () => {
  await seedProfile('creator-no-account')
  const account = await getPayoutAccount('creator-no-account')
  assert.deepEqual(account, {
    bank_name: null,
    account_number: null,
    account_holder: null,
  })
  assert.equal(isPayoutAccountRegistered(account), false)
})

test('공백만 적힌 칸은 등록된 계좌가 아니다 — 화면에는 값이 있는 것처럼 보이지만 이체할 수 없다', async () => {
  await seedProfile('creator-blank-account', { bank: '   ', account: '\t\n ', holder: ' ' })
  const account = await getPayoutAccount('creator-blank-account')
  assert.equal(account.bank_name, null)
  assert.equal(account.account_number, null)
  assert.equal(account.account_holder, null)
  assert.equal(isPayoutAccountRegistered(account), false)
})

test('은행만 있고 계좌번호가 없으면 등록된 것이 아니다 — 둘이 짝이다', async () => {
  await seedProfile('creator-bank-only', { bank: '국민은행' })
  assert.equal(isPayoutAccountRegistered(await getPayoutAccount('creator-bank-only')), false)
  await seedProfile('creator-number-only', { account: '123456-01-789012' })
  assert.equal(isPayoutAccountRegistered(await getPayoutAccount('creator-number-only')), false)
})

test('프로필 자체가 없으면(임자 없는 캠페인) null이고, 그 또한 등록되지 않음이다', async () => {
  const account = await getPayoutAccount('00000000-0000-4000-8000-000000000000')
  assert.equal(account, null)
  assert.equal(isPayoutAccountRegistered(account), false)
})

// ---------------------------------------------------------------- 등록된 계좌

test('은행·계좌번호·예금주가 있으면 그 셋을 그대로 돌려준다 — 앞뒤 공백은 다듬는다', async () => {
  await seedProfile('creator-full', {
    bank: ' 국민은행 ',
    account: ' 123456-01-789012 ',
    holder: ' 김개설 ',
  })
  const account = await getPayoutAccount('creator-full')
  assert.deepEqual(account, {
    bank_name: '국민은행',
    account_number: '123456-01-789012',
    account_holder: '김개설',
  })
  assert.equal(isPayoutAccountRegistered(account), true)
  assert.equal(isPayoutAccountHolderMissing(account), false)
})

test('예금주만 비어 있어도 지급은 막지 않는다 — 프로필 저장 경로가 요구한 적이 없다', async () => {
  await seedProfile('creator-no-holder', { bank: '신한은행', account: '110-123-456789' })
  const account = await getPayoutAccount('creator-no-holder')
  assert.equal(isPayoutAccountRegistered(account), true)
  assert.equal(isPayoutAccountHolderMissing(account), true)
})

// ---------------------------------------------------------------- 딸려 나오면 안 되는 것

test('계좌 조회는 계좌 세 칸 말고는 아무것도 실어 오지 않는다 — 실명·전화번호·생년월일이 따라오면 응답에 실릴 여지가 생긴다', async () => {
  await seedProfile('creator-narrow', {
    bank: '하나은행',
    account: '333-9999-11111',
    holder: '박개설',
  })
  const account = await getPayoutAccount('creator-narrow')
  assert.deepEqual(Object.keys(account).sort(), ['account_holder', 'account_number', 'bank_name'])
  const serialized = JSON.stringify(account)
  for (const leaked of ['주민등록상이름', '010-0000-0000', '1990-01-01', 'test.local']) {
    assert.equal(serialized.includes(leaked), false, `${leaked}가 계좌 조회에 딸려 왔다`)
  }
})

// ---------------------------------------------------------------- 개설자에게 가는 말

const SETTLEMENT = {
  gross_amount: 1_000_000,
  refund_amount: 0,
  pg_fee_amount: 30_000,
  platform_fee_amount: 0,
  payout_amount: 970_000,
}

test('계좌가 없는 개설자에게는 정산 준비 알림이 그 사실과 고치러 갈 자리를 함께 말한다', () => {
  const notice = buildSettlementPreparedNotice(
    { id: 'c-1', title: '첫 정규 앨범' },
    SETTLEMENT,
    'https://ggac.kr',
    { payoutAccountMissing: true }
  )
  assert.match(notice.message, /계좌가 등록되어 있지 않습니다/)
  assert.ok(notice.message.includes(`https://ggac.kr${PAYOUT_ACCOUNT_SETTINGS_PATH}`))
})

test('계좌가 있으면 알림은 계좌 이야기를 꺼내지 않는다 — 없는 문제를 만들지 않는다', () => {
  const notice = buildSettlementPreparedNotice(
    { id: 'c-1', title: '첫 정규 앨범' },
    SETTLEMENT,
    'https://ggac.kr'
  )
  assert.equal(/계좌/.test(notice.message), false)
})

test('알림에는 계좌 값이 어떤 형태로도 실리지 않는다 — "비어 있다"까지가 알림이 할 말이다', async () => {
  await seedProfile('creator-notify', {
    bank: '우리은행',
    account: '1002-555-777888',
    holder: '최개설',
  })
  const account = await getPayoutAccount('creator-notify')
  const notice = buildSettlementPreparedNotice(
    { id: 'c-2', title: '두 번째 앨범' },
    SETTLEMENT,
    'https://ggac.kr',
    { payoutAccountMissing: isPayoutAccountRegistered(account) === false }
  )
  const serialized = JSON.stringify(notice)
  for (const value of [account.bank_name, account.account_number, account.account_holder]) {
    assert.equal(serialized.includes(value), false, `${value}가 알림에 실렸다`)
  }
})
