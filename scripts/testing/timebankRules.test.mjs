import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  directionFor,
  evaluateTransfer,
  floorFor,
  pairBlocked,
  validMinutes,
} from '../../src/lib/timebank/rules.ts'
import { formatMinutes } from '../../src/lib/timebank/format.ts'
import { TIMEBANK_KINDS, MEMBER_TO_MEMBER_KINDS } from '../../src/constants/timebank.ts'

// settings.ts는 별칭 import가 있어 여기선 기본값을 손으로 적는다(스펙 §9.1).
const SETTINGS = {
  enabled: true,
  coop_tasks_enabled: false,
  redeem_tickets_enabled: false,
  redeem_rewards_enabled: false,
  market_time_enabled: true,
  terms_version: '2026-11',
  signup_grant_minutes: 120,
  min_balance_minutes: -600,
  soft_max_minutes: 1800,
  low_balance_flag_minutes: -480,
  coop_task_monthly_cap_minutes: 480,
  redeem_monthly_cap_minutes: 480,
  market_item_max_minutes: 240,
  adjustment_dual_approval_minutes: 240,
}

const party = (id, over = {}) => ({
  id,
  approved_active: true,
  withdrawal_requested: false,
  terms_current: true,
  ...over,
})

const A = party('A')
const B = party('B')

/** A가 B에게 도움을 받고 60분을 기록한다(A → B). */
function exchangeInput(over = {}) {
  return {
    draft: { kind: 'exchange', from: 'A', to: 'B', minutes: 60, recorder_id: 'A', ...over.draft },
    payer: over.payer ?? A,
    payee: over.payee ?? B,
    payerBalanceAfter: over.payerBalanceAfter ?? -540,
    payeeBalanceAfter: over.payeeBalanceAfter ?? 60,
    settings: over.settings ?? SETTINGS,
  }
}

const reject = reason => ({ ok: false, reason })

test('정상 exchange(받은 사람 −540)는 ok', () => {
  assert.deepEqual(evaluateTransfer(exchangeInput()), { ok: true, flags: [] })
})

test('하한 −600을 넘는 확정(−630)은 below_floor, 딱 −600은 ok', () => {
  assert.deepEqual(
    evaluateTransfer(exchangeInput({ payerBalanceAfter: -630 })),
    reject('below_floor')
  )
  assert.equal(evaluateTransfer(exchangeInput({ payerBalanceAfter: -600 })).ok, true)
})

test('자기 자신에게는 self', () => {
  assert.deepEqual(
    evaluateTransfer(exchangeInput({ draft: { to: 'A' }, payee: A })),
    reject('self')
  )
})

test('기록자가 당사자가 아니면 recorder_not_party', () => {
  assert.deepEqual(
    evaluateTransfer(exchangeInput({ draft: { recorder_id: 'C' } })),
    reject('recorder_not_party')
  )
})

test('45·0·510·음수·소수 분은 bad_minutes', () => {
  for (const minutes of [45, 0, 510, -60, 60.5, Number.NaN]) {
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ draft: { minutes } })),
      reject('bad_minutes'),
      String(minutes)
    )
  }
  for (const minutes of [30, 480]) {
    assert.equal(evaluateTransfer(exchangeInput({ draft: { minutes } })).ok, true, String(minutes))
  }
})

test('판정 1: 기록자 쪽이 자격이 없으면 not_participant', () => {
  for (const over of [
    { withdrawal_requested: true },
    { terms_current: false },
    { approved_active: false },
  ]) {
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ payer: party('A', over) })),
      reject('not_participant'),
      JSON.stringify(over)
    )
    // 받는 쪽(B)이 기록자일 때도 기록자 쪽이 기준이다
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ draft: { recorder_id: 'B' }, payee: party('B', over) })),
      reject('not_participant'),
      JSON.stringify(over)
    )
  }
})

test('판정 1: 상대 쪽이 자격이 없으면 counterparty_not_participant', () => {
  for (const over of [
    { withdrawal_requested: true },
    { terms_current: false },
    { approved_active: false },
  ]) {
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ payee: party('B', over) })),
      reject('counterparty_not_participant'),
      JSON.stringify(over)
    )
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ draft: { recorder_id: 'B' }, payer: party('A', over) })),
      reject('counterparty_not_participant'),
      JSON.stringify(over)
    )
  }
})

test('받는 쪽 잔액이 soft max(1800)를 넘으면 ok + over_soft_max', () => {
  assert.deepEqual(evaluateTransfer(exchangeInput({ payeeBalanceAfter: 1830 })), {
    ok: true,
    flags: ['over_soft_max'],
  })
  assert.deepEqual(evaluateTransfer(exchangeInput({ payeeBalanceAfter: 1800 })), {
    ok: true,
    flags: [],
  })
})

test('조합원 사이 kind가 아니면 kind_not_allowed', () => {
  for (const kind of TIMEBANK_KINDS) {
    if (MEMBER_TO_MEMBER_KINDS.includes(kind)) continue
    assert.deepEqual(
      evaluateTransfer(exchangeInput({ draft: { kind } })),
      reject('kind_not_allowed'),
      kind
    )
  }
})

// ── reversal ───────────────────────────────────────────────
// 원 이동: A → B 60분(confirmed). 되돌림: B → A 60분.
function reversalInput(over = {}) {
  const reverses = {
    kind: 'exchange',
    status: 'confirmed',
    from: 'A',
    to: 'B',
    minutes: 60,
    ...over.reverses,
  }
  return {
    draft: {
      kind: 'reversal',
      from: 'B',
      to: 'A',
      minutes: 60,
      recorder_id: 'A',
      reverses,
      ...over.draft,
    },
    payer: B,
    payee: A,
    payerBalanceAfter: over.payerBalanceAfter ?? 0,
    payeeBalanceAfter: 0,
    settings: SETTINGS,
  }
}

test('확정된 exchange·market의 되돌림은 ok', () => {
  assert.deepEqual(evaluateTransfer(reversalInput()), { ok: true, flags: [] })
  assert.deepEqual(evaluateTransfer(reversalInput({ reverses: { kind: 'market' } })), {
    ok: true,
    flags: [],
  })
})

test('원 kind가 coop_task·reversal 등이면 not_reversible', () => {
  for (const kind of ['coop_task', 'reversal', 'redeem', 'adjustment', 'signup_grant']) {
    assert.deepEqual(
      evaluateTransfer(reversalInput({ reverses: { kind } })),
      reject('not_reversible'),
      kind
    )
  }
})

test('원이 confirmed가 아니면 not_reversible, 원이 없어도 not_reversible', () => {
  for (const status of ['pending', 'rejected', 'canceled']) {
    assert.deepEqual(
      evaluateTransfer(reversalInput({ reverses: { status } })),
      reject('not_reversible'),
      status
    )
  }
  const input = reversalInput()
  input.draft.reverses = null
  assert.deepEqual(evaluateTransfer(input), reject('not_reversible'))
})

test('방향이 원과 반대가 아니면 reverse_mismatch', () => {
  // 원과 같은 방향
  assert.deepEqual(
    evaluateTransfer(reversalInput({ reverses: { from: 'B', to: 'A' } })),
    reject('reverse_mismatch')
  )
  // 다른 사람이 끼어든 원 이동
  assert.deepEqual(
    evaluateTransfer(reversalInput({ reverses: { from: 'A', to: 'C' } })),
    reject('reverse_mismatch')
  )
})

test('minutes가 원과 다르면 reverse_mismatch', () => {
  assert.deepEqual(
    evaluateTransfer(reversalInput({ draft: { minutes: 30 } })),
    reject('reverse_mismatch')
  )
})

test('market의 되돌림은 하한 0, exchange의 되돌림은 −600', () => {
  assert.deepEqual(
    evaluateTransfer(reversalInput({ reverses: { kind: 'market' }, payerBalanceAfter: -30 })),
    reject('below_floor')
  )
  assert.equal(evaluateTransfer(reversalInput({ payerBalanceAfter: -30 })).ok, true)
  assert.equal(evaluateTransfer(reversalInput({ payerBalanceAfter: -600 })).ok, true)
  assert.deepEqual(
    evaluateTransfer(reversalInput({ payerBalanceAfter: -630 })),
    reject('below_floor')
  )
})

// ── market ────────────────────────────────────────────────
function marketInput(over = {}) {
  return {
    draft: {
      kind: 'market',
      from: 'A',
      to: 'B',
      minutes: 120,
      recorder_id: 'B',
      listing_minutes: 120,
      ...over.draft,
    },
    payer: A,
    payee: B,
    payerBalanceAfter: over.payerBalanceAfter ?? 0,
    payeeBalanceAfter: 120,
    settings: SETTINGS,
  }
}

test('market은 글 값과 같아야 하고 구매자 잔액은 0 이상', () => {
  assert.deepEqual(evaluateTransfer(marketInput()), { ok: true, flags: [] })
  assert.deepEqual(evaluateTransfer(marketInput({ draft: { minutes: 90 } })), reject('bad_minutes'))
  assert.deepEqual(
    evaluateTransfer(marketInput({ draft: { listing_minutes: null } })),
    reject('bad_minutes')
  )
  assert.deepEqual(evaluateTransfer(marketInput({ payerBalanceAfter: -30 })), reject('below_floor'))
})

// ── 보조 함수 ─────────────────────────────────────────────
test('floorFor', () => {
  assert.equal(floorFor('exchange', SETTINGS), -600)
  assert.equal(floorFor('market', SETTINGS), 0)
  assert.equal(floorFor('reversal', SETTINGS, 'exchange'), -600)
  assert.equal(floorFor('reversal', SETTINGS, 'market'), 0)
  assert.equal(floorFor('redeem', SETTINGS), 0)
  assert.equal(floorFor('adjustment', SETTINGS), -600)
  assert.equal(floorFor('exchange', { ...SETTINGS, min_balance_minutes: -1200 }), -1200)
})

test('validMinutes — kind별 범위', () => {
  const ctx = { settings: SETTINGS }
  assert.equal(validMinutes('exchange', 30, ctx), true)
  assert.equal(validMinutes('exchange', 45, ctx), false)
  assert.equal(validMinutes('coop_task', 480, ctx), true)
  assert.equal(validMinutes('coop_task', 510, ctx), false)
  assert.equal(validMinutes('adjustment', 990, ctx), true)
  assert.equal(validMinutes('adjustment', 0, ctx), false)
  assert.equal(validMinutes('market', 60, { ...ctx, listingMinutes: 60 }), true)
  assert.equal(validMinutes('market', 60, { ...ctx, listingMinutes: 90 }), false)
  assert.equal(validMinutes('reversal', 60, { ...ctx, reversesMinutes: 60 }), true)
  assert.equal(validMinutes('reversal', 60, ctx), false)
  assert.equal(validMinutes('signup_grant', 120, ctx), true)
  assert.equal(validMinutes('signup_grant', 60, ctx), false)
  assert.equal(validMinutes('withdrawal_settlement', 15, ctx), true)
  assert.equal(validMinutes('withdrawal_settlement', 0, ctx), false)
})

test('directionFor — 받은 사람이 낸다', () => {
  assert.deepEqual(directionFor('received', 'me', 'cp'), { from: 'me', to: 'cp' })
  assert.deepEqual(directionFor('gave', 'me', 'cp'), { from: 'cp', to: 'me' })
})

test('pairBlocked — 30일 안 거절 3회부터 막힌다', () => {
  assert.equal(pairBlocked(3), true)
  assert.equal(pairBlocked(4), true)
  assert.equal(pairBlocked(2), false)
  assert.equal(pairBlocked(0), false)
})

test('formatMinutes — 분을 "N시간 M분"으로', () => {
  assert.equal(formatMinutes(0), '0분')
  assert.equal(formatMinutes(30), '30분')
  assert.equal(formatMinutes(60), '1시간')
  assert.equal(formatMinutes(90), '1시간 30분')
  assert.equal(formatMinutes(-600), '−10시간')
  assert.equal(formatMinutes(-90), '−1시간 30분')
})
