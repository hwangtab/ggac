import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

// `settingsValidation.ts`는 `@/lib/funding/feeRate`를 정적 import한다 —
// 플레인 `node --test`가 그 별칭을 풀 수 있게 훅을 먼저 등록하고, 등록보다
// 먼저 끌어올려지지 않도록 동적 import로 가져온다(fundingSettings.test.mjs와
// 같은 관례).
registerAliasResolveHook(import.meta.url)

const { FEE_RATE_RANGE_MESSAGE, feeRatePercentToBp, formatFeeRatePercent, MAX_FEE_RATE_BP } =
  await import('../../src/lib/funding/feeRate.ts')
const { SETTING_MAPPINGS, applyFundingFeatureField, seedSettingGroup } = await import(
  '../../src/lib/server/systemSettingsMapping.ts'
)
const { validateFundingFeeRates } = await import('../../src/utils/settingsValidation.ts')

/**
 * 관리자 화면에서 **수수료율을 실제로 고칠 수 있는가**를 확인한다.
 *
 * 세 자리를 한 파일에서 본다 — 셋이 어긋나면 화면은 저장했다고 말하는데 값은
 * 다른 것이 들어간다.
 *   1. 사무국이 치는 퍼센트 ↔ 저장 단위(bp) 변환
 *   2. 저장된 행 → 화면 값(`SETTING_MAPPINGS`)
 *   3. 화면 값 → 저장할 JSON(`applyFundingFeatureField`)
 */

// ------------------------------------------------- 사무국이 치는 것은 퍼센트다

test('퍼센트를 저장 단위로 옮긴다 — 조합이 정한 두 숫자가 그대로 나온다', () => {
  assert.equal(feeRatePercentToBp('3.3'), 330)
  assert.equal(feeRatePercentToBp('5.5'), 550)
  assert.equal(feeRatePercentToBp(0), 0)
  assert.equal(feeRatePercentToBp('30'), MAX_FEE_RATE_BP)
  // 한 자리(1bp)가 0.01%라 둘째 자리까지는 옮겨진다.
  assert.equal(feeRatePercentToBp('3.33'), 333)
})

test('화면이 보여 주는 것과 사무국이 치는 것이 같은 숫자다', () => {
  for (const bp of [0, 1, 330, 550, 333, MAX_FEE_RATE_BP]) {
    assert.equal(feeRatePercentToBp(formatFeeRatePercent(bp)), bp)
  }
})

// ------------------------------------------------- 범위 밖은 말을 하고 멈춘다

test('범위 밖·빈 칸·옮길 수 없는 자릿수는 저장 가능한 다른 값으로 바뀌지 않는다', () => {
  // 범위 밖
  assert.equal(feeRatePercentToBp('30.01'), null)
  assert.equal(feeRatePercentToBp('-0.1'), null)
  assert.equal(feeRatePercentToBp(100), null)
  // 빈 칸·없음 — `Number('')`도 `Number(null)`도 0이라 그냥 두면 0%가 저장된다.
  assert.equal(feeRatePercentToBp(''), null)
  assert.equal(feeRatePercentToBp('   '), null)
  assert.equal(feeRatePercentToBp(null), null)
  assert.equal(feeRatePercentToBp(undefined), null)
  // 숫자가 아님
  assert.equal(feeRatePercentToBp('삼점삼'), null)
  assert.equal(feeRatePercentToBp('3.3%'), null)
  // 셋째 자리는 bp로 옮길 수 없다 — 반올림해서 다른 값을 저장하지 않는다.
  assert.equal(feeRatePercentToBp('3.333'), null)
})

test('거절 문구가 범위를 숫자로 말한다', () => {
  assert.match(FEE_RATE_RANGE_MESSAGE, /0%/)
  assert.match(FEE_RATE_RANGE_MESSAGE, /30%/)
})

test('저장 직전 검증도 같은 범위를 지킨다', () => {
  assert.deepEqual(validateFundingFeeRates({ member_bp: 330, nonmember_bp: 550 }), [])
  // 보내지 않은 칸은 탓하지 않는다(부분 페이로드).
  assert.deepEqual(validateFundingFeeRates({ member_bp: undefined, nonmember_bp: undefined }), [])

  const errors = validateFundingFeeRates({ member_bp: 3001, nonmember_bp: -1 })
  assert.equal(errors.length, 2)
  assert.equal(errors[0].field, 'funding_fee_rate_member_bp')
  assert.equal(errors[0].category, 'features')
  assert.equal(errors[1].field, 'funding_fee_rate_nonmember_bp')
  for (const error of errors) assert.match(error.message, /30%/)
})

// ------------------------------------------------- 저장된 행 → 화면

test('저장된 두 요율이 화면 값으로 그대로 올라온다', () => {
  const stored = {
    enabled: true,
    platform_fee_rate_member_bp: 200,
    platform_fee_rate_nonmember_bp: 700,
  }
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_member_bp.transform(stored), 200)
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_nonmember_bp.transform(stored), 700)
})

test('새 칸이 없는 운영 행은 조합이 정한 기본 요율로 보인다 — 0%가 아니다', () => {
  // 오늘 운영 행의 모양: 옛 키 하나만 있고 새 두 칸이 없다.
  const legacy = { enabled: false, platform_fee_rate_bp: 0, hold_minutes: 10 }
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_member_bp.transform(legacy), 330)
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_nonmember_bp.transform(legacy), 550)
})

test('깨진 값도 화면을 0%로 만들지 않는다', () => {
  const broken = { platform_fee_rate_member_bp: '많이', platform_fee_rate_nonmember_bp: 99999 }
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_member_bp.transform(broken), 330)
  assert.equal(SETTING_MAPPINGS.features.funding_fee_rate_nonmember_bp.transform(broken), 550)
})

// ------------------------------------------------- 화면 → 저장할 JSON

test('요율을 저장해도 펀딩 스위치가 켜지지 않는다', () => {
  // 예전 묶음 처리(`{...seed, enabled: frontendValue}`)를 그대로 썼다면
  // `330`이 `enabled`에 들어가 truthy가 됐다. 켜면 돈이 움직이는 스위치다.
  const seed = seedSettingGroup({ enabled: false, hold_minutes: 10 })
  const next = applyFundingFeatureField(seed, 'funding_fee_rate_member_bp', 330)
  assert.equal(next.enabled, false)
  assert.equal(next.platform_fee_rate_member_bp, 330)
  assert.equal(next.hold_minutes, 10)
})

test('한 요율만 저장해도 나머지 칸이 사라지지 않는다', () => {
  const stored = {
    enabled: true,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 550,
    hold_minutes: 10,
  }
  const next = applyFundingFeatureField(
    seedSettingGroup(stored),
    'funding_fee_rate_nonmember_bp',
    500
  )
  assert.deepEqual(next, {
    enabled: true,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 500,
    hold_minutes: 10,
  })
})

test('스위치는 여전히 스위치 칸에만 쓴다', () => {
  const next = applyFundingFeatureField(
    seedSettingGroup({ platform_fee_rate_member_bp: 330 }),
    'funding_enabled',
    true
  )
  assert.equal(next.enabled, true)
  assert.equal(next.platform_fee_rate_member_bp, 330)
})

test('저장값을 씨앗으로 받아도 원본을 건드리지 않는다', () => {
  const stored = { enabled: true, platform_fee_rate_member_bp: 330 }
  applyFundingFeatureField(seedSettingGroup(stored), 'funding_fee_rate_member_bp', 100)
  assert.equal(stored.platform_fee_rate_member_bp, 330)
})
