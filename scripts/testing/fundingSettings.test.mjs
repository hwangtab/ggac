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

// ------------------------------------------------- 스위치가 무엇을 막는가

/**
 * 스위치를 내리는 것은 **"새로 시작되는 것을 멈춘다"**는 뜻이다. 이미 받은
 * 돈을 돌려주고 정산을 맞추는 사무국의 뒷정리까지 함께 닫으면, 펀딩을 잠시
 * 멈춘 날 환불 요청이 들어와도 남는 수단이 토스 콘솔뿐이 된다 — 콘솔에서
 * 나간 환불은 원장이 모르고, 정산은 이미 돌려준 돈까지 지급하라고 말한다.
 *
 * 관리자 설정 화면의 설명이 이 갈래를 그대로 적는다. 갈래가 바뀌면 문장도
 * 함께 바뀌어야 하므로 두 쪽을 한자리에서 못박는다.
 */
const GATED = [
  'src/app/api/admin/funding/campaigns/route.ts',
  'src/app/api/admin/funding/campaigns/[id]/transition/route.ts',
  'src/app/api/mypage/funding/campaigns/route.ts',
  'src/app/api/mypage/funding/campaigns/[id]/route.ts',
  'src/app/api/mypage/funding/campaigns/[id]/rewards/route.ts',
  'src/app/api/mypage/funding/campaigns/[id]/transition/route.ts',
]

const UNGATED = [
  'src/app/api/admin/funding/pledges/[id]/refund/route.ts',
  'src/app/api/admin/funding/campaigns/[id]/settlement/route.ts',
  'src/app/api/admin/funding/campaigns/[id]/fulfillment/route.ts',
]

test('새로 시작되는 경로만 펀딩 스위치를 본다', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of GATED) {
    const src = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.match(src, /isFundingEnabled\(\)/, `${file}: 스위치 검사가 사라졌다`)
  }
})

test('사무국의 뒷정리는 펀딩 스위치를 보지 않는다', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of UNGATED) {
    const src = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(
      src,
      /isFundingEnabled/,
      `${file}: 환불·정산·이행 되돌리기를 스위치가 막으면 사무국에게 남는 길이 토스 콘솔뿐이다`
    )
    // 대신 사무국 경계는 그대로 있어야 한다.
    assert.match(src, /requireAdmin\(\)/, `${file}: 관리자 게이트가 없다`)
  }
})

test('설정 화면 설명이 그 갈래를 그대로 적는다', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(
    new URL('../../src/app/[locale]/admin/settings/page.tsx', import.meta.url),
    'utf8'
  )
  const at = screen.indexOf('펀딩 기능 —')
  assert.ok(at > 0, '펀딩 스위치 칸을 찾지 못했다')
  const block = screen.slice(at, at + 2000)
  // 막히는 것과 막히지 않는 것을 둘 다 말해야 한다.
  assert.match(block, /개설/, '무엇이 막히는지 적혀 있지 않다')
  assert.match(block, /환불/, '뒷정리가 계속 된다는 말이 없다')
  assert.match(block, /정산/)
})
