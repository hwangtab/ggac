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

// ------------------------------------------------------------------- 정산 지급

test('결제된 후원이 남았는데 정산서가 아직 없으면 막는다', () => {
  for (const status of ['closed', 'settled']) {
    const v = campaignWithdrawalVerdict([
      { status, paid_pledge_count: 4, undelivered_pledge_count: 0, settlement_status: null },
    ])
    assert.equal(v.blocked, true, status)
    assert.equal(v.reason, 'settlement_unpaid')
    assert.match(v.message, /1건/)
    assert.match(v.message, /계좌/, '왜 막는지를 말해야 한다 — 계좌가 함께 지워진다')
    assert.match(v.message, /사무국/)
  }
})

test('정산서가 있어도 아직 지급 전(pending)이면 막는다', () => {
  const v = campaignWithdrawalVerdict([
    { status: 'settled', paid_pledge_count: 2, settlement_status: 'pending' },
  ])
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'settlement_unpaid')
})

test('결제된 후원이 하나도 없고 정산서도 없으면 보낼 돈이 없다 — 지나간다', () => {
  assert.equal(
    campaignWithdrawalVerdict([
      { status: 'closed', paid_pledge_count: 0, settlement_status: null },
      { status: 'settled', paid_pledge_count: 0, settlement_status: null },
    ]).blocked,
    false
  )
})

test('환불로 남은 후원이 0이 됐어도 정산서가 지급 전이면 막는다', () => {
  // 정산서가 만들어졌다는 것은 사무국이 이 프로젝트의 돈을 아직 정리하는
  // 중이라는 뜻이다 — 남은 후원 건수만 보고 열어 주면 안 된다.
  const v = campaignWithdrawalVerdict([
    { status: 'closed', paid_pledge_count: 0, settlement_status: 'pending' },
  ])
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'settlement_unpaid')
})

test('지급이 끝난(paid) 정산서는 막지 않는다', () => {
  assert.equal(
    campaignWithdrawalVerdict([
      { status: 'settled', paid_pledge_count: 9, settlement_status: 'paid' },
    ]).blocked,
    false
  )
})

test('전달 완료로 눌러 리워드 검사를 비켜서도 정산 검사가 잡는다', () => {
  // 이 가드가 노리는 우회다. `fulfillment_status`는 개설자가 스스로 누르는
  // 값이라 탈퇴 직전에 전부 '전달 완료'로 바꿀 수 있다 — 그러면 예전 규칙은
  // 그대로 열렸다. 정산서의 `'paid'`는 사무국만 찍으므로 움직이지 않는다.
  const v = campaignWithdrawalVerdict([
    {
      status: 'closed',
      paid_pledge_count: 12,
      undelivered_pledge_count: 0,
      settlement_status: 'pending',
    },
  ])
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'settlement_unpaid')
})

test('정산이 먼저다 — 리워드도 남았으면 정산 쪽을 말한다', () => {
  const v = campaignWithdrawalVerdict([
    {
      status: 'closed',
      paid_pledge_count: 3,
      undelivered_pledge_count: 3,
      settlement_status: 'pending',
    },
  ])
  assert.equal(v.reason, 'settlement_unpaid')
})

test('진행 중인 프로젝트가 정산보다 먼저다', () => {
  const v = campaignWithdrawalVerdict([
    { status: 'closed', paid_pledge_count: 3, settlement_status: 'pending' },
    { status: 'active' },
  ])
  assert.equal(v.reason, 'in_progress')
})

test('지급이 끝났어도 전달하지 않은 리워드가 남으면 막는다', () => {
  const v = campaignWithdrawalVerdict([
    {
      status: 'settled',
      paid_pledge_count: 5,
      undelivered_pledge_count: 5,
      settlement_status: 'paid',
    },
  ])
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'undelivered')
})

test('미정산 프로젝트 수는 가로질러 센다', () => {
  const v = campaignWithdrawalVerdict([
    { status: 'closed', paid_pledge_count: 1, settlement_status: null },
    { status: 'settled', paid_pledge_count: 1, settlement_status: 'pending' },
    { status: 'settled', paid_pledge_count: 1, settlement_status: 'paid' },
  ])
  assert.equal(v.blocked, true)
  assert.match(v.message, /2건/)
})

test('진행 전 상태는 정산 검사에도 걸리지 않는다', () => {
  assert.equal(
    campaignWithdrawalVerdict([
      { status: 'draft', paid_pledge_count: 7, settlement_status: 'pending' },
    ]).blocked,
    false
  )
})
