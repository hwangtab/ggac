import { test } from 'node:test'
import assert from 'node:assert/strict'

const { campaignWithdrawalVerdict } = await import('../../src/lib/funding/withdrawalGuard.ts')

test('벌여 놓은 것이 없으면 지나간다', () => {
  assert.equal(campaignWithdrawalVerdict([]).blocked, false)
  assert.equal(campaignWithdrawalVerdict(null).blocked, false)
  assert.equal(campaignWithdrawalVerdict(undefined).blocked, false)
  // 초안은 아무에게도 약속한 것이 없다 — 막지 않는다.
  assert.equal(campaignWithdrawalVerdict([{ status: 'draft' }]).blocked, false)
})

test('심사 중이거나 모금 중이면 막는다', () => {
  for (const status of ['submitted', 'active']) {
    const v = campaignWithdrawalVerdict([{ status }])
    assert.equal(v.blocked, true, status)
    assert.equal(v.reason, 'in_progress')
    assert.match(v.message, /사무국/, '어디로 가야 하는지 말해야 한다')
    assert.match(v.message, /1건/)
  }
})

test('마감·정산됐어도 전달하지 않은 리워드가 남으면 막는다', () => {
  for (const status of ['closed', 'settled']) {
    const v = campaignWithdrawalVerdict([{ status, undelivered_pledge_count: 3 }])
    assert.equal(v.blocked, true, status)
    assert.equal(v.reason, 'undelivered')
    assert.match(v.message, /3건/)
    assert.match(v.message, /사무국/)
  }
})

test('전달이 끝난 마감·정산 프로젝트는 막지 않는다', () => {
  assert.equal(
    campaignWithdrawalVerdict([
      { status: 'closed', undelivered_pledge_count: 0 },
      { status: 'settled', undelivered_pledge_count: 0 },
      { status: 'draft', undelivered_pledge_count: 0 },
    ]).blocked,
    false
  )
})

test('남은 건수는 프로젝트를 가로질러 합친다', () => {
  const v = campaignWithdrawalVerdict([
    { status: 'closed', undelivered_pledge_count: 2 },
    { status: 'settled', undelivered_pledge_count: 5 },
  ])
  assert.equal(v.blocked, true)
  assert.match(v.message, /7건/)
})

test('둘 다 걸리면 진행 중인 쪽을 먼저 말한다 — 사람이 할 일의 순서다', () => {
  const v = campaignWithdrawalVerdict([
    { status: 'closed', undelivered_pledge_count: 4 },
    { status: 'active' },
  ])
  assert.equal(v.reason, 'in_progress')
})

test('건수가 숫자가 아니거나 음수여도 없는 것으로 센다', () => {
  assert.equal(
    campaignWithdrawalVerdict([
      { status: 'closed', undelivered_pledge_count: undefined },
      { status: 'closed', undelivered_pledge_count: -3 },
      { status: 'settled', undelivered_pledge_count: Number.NaN },
    ]).blocked,
    false
  )
})

test('모르는 상태는 막지 않는다 — 막을 근거가 표에 없다', () => {
  assert.equal(
    campaignWithdrawalVerdict([{ status: 'whatever', undelivered_pledge_count: 9 }]).blocked,
    false
  )
})
