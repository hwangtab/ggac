import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

// settings.ts는 `@/utils/systemSettings`를 정적 import하므로 별칭 해석 훅을
// 등록한 뒤 동적 import한다(fundingSettings.test.mjs와 같은 이유).
registerAliasResolveHook(import.meta.url)

const { normalizeTimebankSettings, TIMEBANK_DEFAULTS } = await import(
  '../../src/lib/timebank/settings.ts'
)

test('기본값은 스펙 §9.1 그대로이고 전부 꺼져 있다', () => {
  assert.deepEqual(TIMEBANK_DEFAULTS, {
    enabled: false,
    coop_tasks_enabled: false,
    redeem_tickets_enabled: false,
    redeem_rewards_enabled: false,
    market_time_enabled: false,
    terms_version: '2026-11',
    signup_grant_minutes: 120,
    min_balance_minutes: -600,
    soft_max_minutes: 1800,
    low_balance_flag_minutes: -480,
    coop_task_monthly_cap_minutes: 480,
    redeem_monthly_cap_minutes: 480,
    market_item_max_minutes: 240,
    adjustment_dual_approval_minutes: 240,
  })
})

test('null·undefined는 기본값이고 enabled === false', () => {
  assert.deepEqual(normalizeTimebankSettings(null), TIMEBANK_DEFAULTS)
  assert.deepEqual(normalizeTimebankSettings(undefined), TIMEBANK_DEFAULTS)
  assert.equal(normalizeTimebankSettings(null).enabled, false)
})

test('스위치는 === true일 때만 참이다', () => {
  const s = normalizeTimebankSettings({
    enabled: 'true',
    coop_tasks_enabled: 1,
    redeem_tickets_enabled: 'yes',
    redeem_rewards_enabled: {},
    market_time_enabled: true,
  })
  assert.equal(s.enabled, false)
  assert.equal(s.coop_tasks_enabled, false)
  assert.equal(s.redeem_tickets_enabled, false)
  assert.equal(s.redeem_rewards_enabled, false)
  assert.equal(s.market_time_enabled, true)
  assert.equal(normalizeTimebankSettings({ enabled: true }).enabled, true)
})

test('min_balance_minutes는 −1200~0, 30 배수만 받는다', () => {
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: -1500 }).min_balance_minutes, -600)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: 45 }).min_balance_minutes, -600)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: -630 }).min_balance_minutes, -630)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: -1200 }).min_balance_minutes, -1200)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: 0 }).min_balance_minutes, 0)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: 30 }).min_balance_minutes, -600)
  assert.equal(normalizeTimebankSettings({ min_balance_minutes: '-630' }).min_balance_minutes, -600)
  assert.equal(
    normalizeTimebankSettings({ low_balance_flag_minutes: -1230 }).low_balance_flag_minutes,
    -480
  )
  assert.equal(
    normalizeTimebankSettings({ low_balance_flag_minutes: -300 }).low_balance_flag_minutes,
    -300
  )
})

test('상한류는 0~2400, 30 배수만 받는다', () => {
  const keys = [
    'signup_grant_minutes',
    'soft_max_minutes',
    'coop_task_monthly_cap_minutes',
    'redeem_monthly_cap_minutes',
    'market_item_max_minutes',
    'adjustment_dual_approval_minutes',
  ]
  for (const key of keys) {
    const def = TIMEBANK_DEFAULTS[key]
    assert.equal(normalizeTimebankSettings({ [key]: 2430 })[key], def, `${key} 2430`)
    assert.equal(normalizeTimebankSettings({ [key]: -30 })[key], def, `${key} -30`)
    assert.equal(normalizeTimebankSettings({ [key]: 45 })[key], def, `${key} 45`)
    assert.equal(normalizeTimebankSettings({ [key]: 60.5 })[key], def, `${key} 60.5`)
    assert.equal(normalizeTimebankSettings({ [key]: Number.NaN })[key], def, `${key} NaN`)
    assert.equal(normalizeTimebankSettings({ [key]: 2400 })[key], 2400, `${key} 2400`)
    assert.equal(normalizeTimebankSettings({ [key]: 0 })[key], 0, `${key} 0`)
    assert.equal(normalizeTimebankSettings({ [key]: 90 })[key], 90, `${key} 90`)
  }
})

test('terms_version은 빈 문자열·공백·비문자열이면 기본값', () => {
  assert.equal(normalizeTimebankSettings({ terms_version: '' }).terms_version, '2026-11')
  assert.equal(normalizeTimebankSettings({ terms_version: '   ' }).terms_version, '2026-11')
  assert.equal(normalizeTimebankSettings({ terms_version: 202612 }).terms_version, '2026-11')
  assert.equal(normalizeTimebankSettings({ terms_version: '2027-03' }).terms_version, '2027-03')
})

test('배열·문자열·숫자 입력에도 던지지 않고 기본값으로 떨어진다', () => {
  for (const raw of [[], [1, 2], 'enabled', 42, true, () => {}]) {
    assert.deepEqual(normalizeTimebankSettings(raw), TIMEBANK_DEFAULTS)
  }
})

test('칸별로 따로 본다 — 한 칸이 깨져도 다른 칸은 유지', () => {
  const s = normalizeTimebankSettings({
    enabled: true,
    min_balance_minutes: 'oops',
    soft_max_minutes: 1200,
  })
  assert.equal(s.enabled, true)
  assert.equal(s.min_balance_minutes, -600)
  assert.equal(s.soft_max_minutes, 1200)
})
