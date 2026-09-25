import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

// settings.ts는 `@/utils/systemSettings`를 정적 import하므로, 플레인
// `node --test`가 이 tsconfig 경로 별칭을 풀 수 있게 공용 해석 훅을 등록한다.
// 정적 import는 이 등록보다 먼저 끌어올려져 훅을 무력화하므로, 등록 뒤에
// 동적 import로 모듈을 가져온다.
registerAliasResolveHook(import.meta.url)

const { normalizeFundingSettings } = await import('../../src/lib/funding/settings.ts')

test('없거나 깨진 설정은 기본값(꺼짐, 조합원 330bp·비조합원 550bp, 10분)', () => {
  assert.deepEqual(normalizeFundingSettings(undefined), {
    enabled: false,
    platform_fee_rate_member_bp: 330,
    platform_fee_rate_nonmember_bp: 550,
    hold_minutes: 10,
  })
  assert.deepEqual(
    normalizeFundingSettings({
      enabled: 'yes',
      platform_fee_rate_member_bp: -5,
      platform_fee_rate_nonmember_bp: 9999,
      hold_minutes: 0,
    }),
    {
      enabled: false,
      platform_fee_rate_member_bp: 330,
      platform_fee_rate_nonmember_bp: 550,
      hold_minutes: 10,
    }
  )
})

test('정상 값은 그대로, 수수료율은 0~3000bp, 홀드는 5~30분', () => {
  assert.deepEqual(
    normalizeFundingSettings({
      enabled: true,
      platform_fee_rate_member_bp: 500,
      platform_fee_rate_nonmember_bp: 700,
      hold_minutes: 15,
    }),
    {
      enabled: true,
      platform_fee_rate_member_bp: 500,
      platform_fee_rate_nonmember_bp: 700,
      hold_minutes: 15,
    }
  )
  assert.equal(normalizeFundingSettings({ hold_minutes: 60 }).hold_minutes, 10)
})

// 두 요율이 갈리는 규칙과 옛 행 처리는 `fundingFeeRate.test.mjs`가 실제 DB로
// 확인한다 — 여기서는 모양만 본다.
