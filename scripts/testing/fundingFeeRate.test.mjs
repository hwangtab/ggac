import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 두 요율(조합원 3.3% / 비조합원 5.5%) — **진짜 로컬 DB**를 상대로 한다.
 *
 * 여기서 확인하려는 것은 네 가지다.
 *
 * ① 설정에서 두 요율이 각각 읽히고, 범위 밖 값은 조합이 정한 기본값으로
 *    떨어진다(만분율 0~3000, 기존과 같은 상한).
 * ② 운영 DB에 남아 있는 **옛 한 칸짜리 행**(`platform_fee_rate_bp`)을 만나도
 *    아무것도 터지지 않고 기본 요율로 읽힌다 — 마이그레이션 없이 넘어가는
 *    길이 실제로 되는지를 못박는다.
 * ③ 개설자가 조합원인지의 판정이 `is_member`·`membership_type`이 아니라 가입
 *    승인 상태를 본다. 두 컬럼은 오늘 모든 행에 기본값이 박혀 있어 신호가
 *    없고, 그대로 믿으면 승인 대기자가 조합원 요율을 받는다.
 * ④ 승인 시점에 새긴 요율은 **그 뒤 설정이 바뀌어도 움직이지 않는다.**
 *
 * 한 가지 더: 조합원 판정이 사이트의 다른 조합원 경계(`isApprovedActive`)와
 * 갈라지지 않는지를 **진짜 함수를 불러** 대조한다. 같은 판정을 두 군데 적어
 * 둔 이유는 `feeRate.ts` 주석에 있다.
 */

const DB_PATH = 'scripts/testing/.funding-fee-rate-test.db'

process.env.SETTINGS_CACHE_TTL_MS = '0'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

registerAliasResolveHook(import.meta.url)

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  // 개설자 셋 — 승인·활성 조합원, 승인 대기, 승인됐지만 비활성.
  // 셋 다 `is_member`·`membership_type`은 스키마 기본값 그대로다(운영과 같다).
  for (const [id, status, active] of [
    ['member', 'approved', 1],
    ['pending', 'pending', 1],
    ['inactive', 'approved', 0],
  ]) {
    await client.execute({
      sql: `INSERT INTO member_profiles (id, display_name, email, registration_status, is_active)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@x.kr`, status, active],
    })
  }
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

beforeEach(async () => {
  await client.execute(`DELETE FROM system_settings WHERE category = 'features'`)
})

let rowSeq = 0
async function putFundingSettings(value) {
  await client.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'features', 'funding_features', ?, 0, ?, ?)`,
    args: [`fee-rate-test-${++rowSeq}`, JSON.stringify(value), Date.now(), Date.now()],
  })
}

const {
  isFeeMember,
  platformFeeRateFor,
  formatFeeRatePercent,
  feeRateLabel,
  MEMBER_FEE_RATE_BP,
  NONMEMBER_FEE_RATE_BP,
} = await import('../../src/lib/funding/feeRate.ts')
const { normalizeFundingSettings, getFundingSettings, feeRatesOf } = await import(
  '../../src/lib/funding/settings.ts'
)
const { resolveCampaignFeeRate } = await import('../../src/lib/server/fundingFeeRate.ts')
const { isApprovedActive } = await import('../../src/lib/server/authz.ts')
const fq = await import('../../src/db/queries/funding.ts')
const { platformFeeFor } = await import('../../src/lib/funding/settlement.ts')

// ------------------------------------------------------------------ 요율 판정

test('조합원은 3.3%, 비조합원은 5.5% — 둘 다 부가세를 포함한 전액 요율', () => {
  assert.equal(MEMBER_FEE_RATE_BP, 330)
  assert.equal(NONMEMBER_FEE_RATE_BP, 550)
  const rates = { member_bp: MEMBER_FEE_RATE_BP, nonmember_bp: NONMEMBER_FEE_RATE_BP }

  assert.deepEqual(
    platformFeeRateFor(rates, { registration_status: 'approved', is_active: true }),
    {
      rate_bp: 330,
      is_member: true,
    }
  )
  assert.deepEqual(platformFeeRateFor(rates, { registration_status: 'pending', is_active: true }), {
    rate_bp: 550,
    is_member: false,
  })
  assert.deepEqual(platformFeeRateFor(rates, null), { rate_bp: 550, is_member: false })

  // 사무국이 읽는 자리에는 부가세가 포함이라는 말이 늘 붙는다.
  assert.equal(formatFeeRatePercent(330), '3.3')
  assert.equal(formatFeeRatePercent(550), '5.5')
  assert.equal(feeRateLabel(330, true), '3.3% (조합원 · 부가세 포함)')
  assert.equal(feeRateLabel(550, false), '5.5% (비조합원 · 부가세 포함)')
})

test('조합원 판정은 is_member·membership_type이 아니라 가입 승인 상태를 본다', () => {
  // 운영 23행 전부가 이 모양이다 — 승인 대기 중인 행까지 포함해서.
  const pendingButFlagged = {
    is_member: true,
    membership_type: 'regular',
    registration_status: 'pending',
    is_active: true,
  }
  assert.equal(isFeeMember(pendingButFlagged), false)
  assert.equal(
    isFeeMember({ is_member: false, registration_status: 'approved', is_active: true }),
    true
  )
  assert.equal(isFeeMember({ registration_status: 'approved', is_active: false }), false)
})

test('조합원 판정이 사이트의 다른 조합원 경계와 갈라지지 않는다', () => {
  const cases = [
    { registration_status: 'approved', is_active: true },
    { registration_status: 'approved', is_active: false },
    { registration_status: 'pending', is_active: true },
    { registration_status: 'rejected', is_active: true },
    { registration_status: null, is_active: null },
    null,
  ]
  for (const profile of cases) {
    assert.equal(
      isFeeMember(profile),
      isApprovedActive(profile),
      `${JSON.stringify(profile)}에서 두 판정이 어긋난다`
    )
  }
})

// ------------------------------------------------------------------ 설정 읽기

test('두 요율은 각각 0~3000bp로 갇히고, 범위 밖이면 조합이 정한 기본값', () => {
  assert.deepEqual(
    normalizeFundingSettings({
      enabled: true,
      platform_fee_rate_member_bp: 200,
      platform_fee_rate_nonmember_bp: 3000,
      hold_minutes: 15,
    }),
    {
      enabled: true,
      platform_fee_rate_member_bp: 200,
      platform_fee_rate_nonmember_bp: 3000,
      hold_minutes: 15,
    }
  )
  const clamped = normalizeFundingSettings({
    platform_fee_rate_member_bp: 3001,
    platform_fee_rate_nonmember_bp: -1,
  })
  assert.equal(clamped.platform_fee_rate_member_bp, 330)
  assert.equal(clamped.platform_fee_rate_nonmember_bp, 550)
  assert.equal(
    normalizeFundingSettings({ platform_fee_rate_member_bp: 12.5 }).platform_fee_rate_member_bp,
    330
  )
})

test('모양이 어긋난 설정에도 던지지 않는다 — 펀딩이 설정 한 줄로 멈추지 않는다', () => {
  for (const raw of [undefined, null, 'nope', 42, [], { platform_fee_rate_member_bp: {} }]) {
    const settings = normalizeFundingSettings(raw)
    assert.equal(settings.platform_fee_rate_member_bp, 330)
    assert.equal(settings.platform_fee_rate_nonmember_bp, 550)
    assert.equal(settings.enabled, false)
    assert.equal(settings.hold_minutes, 10)
  }
})

test('운영에 남아 있는 옛 한 칸짜리 행을 만나도 기본 요율로 읽힌다 — 마이그레이션 없음', async () => {
  // 오늘 운영 DB에 실제로 들어 있는 모양. 옛 키는 아무도 읽지 않는다.
  await putFundingSettings({ enabled: true, platform_fee_rate_bp: 250, hold_minutes: 10 })
  const settings = await getFundingSettings()
  assert.equal(settings.enabled, true, '옛 행이어도 기능 스위치는 그대로 읽혀야 한다')
  assert.equal(settings.platform_fee_rate_member_bp, 330)
  assert.equal(settings.platform_fee_rate_nonmember_bp, 550)
  assert.deepEqual(feeRatesOf(settings), { member_bp: 330, nonmember_bp: 550 })
})

test('설정에 적힌 두 요율이 개설자에 따라 각각 골라진다', async () => {
  await putFundingSettings({
    enabled: true,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 550,
    hold_minutes: 10,
  })
  assert.deepEqual(await resolveCampaignFeeRate('member'), { rate_bp: 330, is_member: true })
  assert.deepEqual(await resolveCampaignFeeRate('pending'), { rate_bp: 550, is_member: false })
  assert.deepEqual(await resolveCampaignFeeRate('inactive'), { rate_bp: 550, is_member: false })
  // 임자가 없는(수기 등록·탈퇴) 캠페인은 조합원으로 보지 않는다.
  assert.deepEqual(await resolveCampaignFeeRate(null), { rate_bp: 550, is_member: false })
  assert.deepEqual(await resolveCampaignFeeRate('없는사람'), { rate_bp: 550, is_member: false })
})

// ------------------------------------------------------------ 승인 시점의 각인

let campaignSeq = 0

/** 승인 라우트가 하는 그대로 — 요율을 골라 승인과 같은 쓰기로 새긴다. */
async function approveWithResolvedRate(ownerId) {
  const n = ++campaignSeq
  const campaign = await fq.createCampaign({
    owner_user_id: ownerId,
    title: `요율 캠페인 ${n}`,
    summary: 's',
    goal_amount: 1_000_000,
  })
  await fq.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  const feeRate = await resolveCampaignFeeRate(ownerId)
  const approved = await fq.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: `fee-rate-${n}`,
    platformFeeRate: feeRate.rate_bp,
  })
  return { approved, feeRate }
}

test('승인하면 고른 요율이 캠페인에 새겨진다 — 조합원 330bp, 비조합원 550bp', async () => {
  await putFundingSettings({
    enabled: true,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 550,
    hold_minutes: 10,
  })

  const asMember = await approveWithResolvedRate('member')
  assert.equal(asMember.feeRate.is_member, true)
  assert.equal(Number(asMember.approved.platform_fee_rate), 330)

  const asNonMember = await approveWithResolvedRate('pending')
  assert.equal(asNonMember.feeRate.is_member, false)
  assert.equal(Number(asNonMember.approved.platform_fee_rate), 550)

  // 100만원이 남았을 때 실제로 갈리는 금액. 버림 방향은 그대로다.
  assert.equal(platformFeeFor(1_000_000, Number(asMember.approved.platform_fee_rate)), 33_000)
  assert.equal(platformFeeFor(1_000_000, Number(asNonMember.approved.platform_fee_rate)), 55_000)
})

test('승인 뒤 설정을 바꿔도 이미 새겨진 요율은 움직이지 않는다', async () => {
  await putFundingSettings({
    enabled: true,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 550,
    hold_minutes: 10,
  })
  const { approved } = await approveWithResolvedRate('member')
  assert.equal(Number(approved.platform_fee_rate), 330)

  // 사무국이 요율을 올린다. 이미 승인된 캠페인과의 약속은 그대로여야 한다.
  await client.execute(`DELETE FROM system_settings WHERE category = 'features'`)
  await putFundingSettings({
    enabled: true,
    platform_fee_rate_member_bp: 1000,
    platform_fee_rate_nonmember_bp: 2000,
    hold_minutes: 10,
  })
  assert.deepEqual(await resolveCampaignFeeRate('member'), { rate_bp: 1000, is_member: true })

  const now = await fq.getCampaignById(String(approved.id))
  assert.equal(Number(now.platform_fee_rate), 330, '승인 때 새긴 요율이 설정을 따라 움직였다')
  assert.equal(platformFeeFor(1_000_000, Number(now.platform_fee_rate)), 33_000)
})
