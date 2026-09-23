import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isTempId,
  withSequentialSortOrder,
  moveReward,
  computeRewardLockState,
  isQuantityBelowMin,
  clampQuantityToMin,
  buildRewardsPayload,
  formatAmountDisplay,
  parseAmountInput,
  parseQuantityInput,
} from '../../src/app/[locale]/mypage/funding/[id]/edit/rewardsTabHelpers.ts'

function row(overrides = {}) {
  return {
    id: 'r1',
    title: '리워드',
    description: null,
    amount: 10000,
    total_quantity: 10,
    requires_shipping: false,
    estimated_delivery: null,
    image_url: null,
    sort_order: 0,
    locked_at: null,
    ...overrides,
  }
}

test('temp id는 temp: 로 시작하는 것만 골라낸다', () => {
  assert.equal(isTempId('temp:abc'), true)
  assert.equal(isTempId('abc123'), false)
})

test('sort_order를 배열 위치에 맞춘다', () => {
  const rows = [row({ id: 'a', sort_order: 5 }), row({ id: 'b', sort_order: 5 })]
  const next = withSequentialSortOrder(rows)
  assert.deepEqual(
    next.map(r => r.sort_order),
    [0, 1]
  )
})

test('moveReward는 경계를 넘으면 그대로 돌려준다', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]
  assert.equal(moveReward(rows, 0, -1), rows)
  assert.equal(moveReward(rows, 2, 1), rows)
})

test('moveReward는 두 자리를 바꾸고 sort_order를 다시 맞춘다', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]
  const next = moveReward(rows, 0, 1)
  assert.deepEqual(
    next.map(r => r.id),
    ['b', 'a', 'c']
  )
  assert.deepEqual(
    next.map(r => r.sort_order),
    [0, 1, 2]
  )
})

test('결제 잠금은 금액·배송·삭제를 막지만 이름·설명은 그대로 둔다', () => {
  const state = computeRewardLockState({ locked_at: '2026-09-01T00:00:00Z' }, false, 'all', 10)
  assert.equal(state.amountShippingDisabled, true)
  assert.equal(state.nameDescDisabled, false)
  assert.equal(state.deleteHidden, true)
  assert.equal(state.quantityMin, 10)
  assert.equal(state.showLockedReason, true)
})

test('공개 중(contentOnly)의 기존 리워드는 이름·설명·금액·배송·삭제를 모두 잠근다', () => {
  const state = computeRewardLockState({ locked_at: null }, false, 'contentOnly', 5)
  assert.equal(state.amountShippingDisabled, true)
  assert.equal(state.nameDescDisabled, true)
  assert.equal(state.deleteHidden, true)
  assert.equal(state.quantityMin, 5)
  // 결제 때문이 아니라 공개 상태 때문이므로 결제 잠금 문장은 보이지 않는다.
  assert.equal(state.showLockedReason, false)
})

test('공개 중에 이번 세션에서 새로 추가한 리워드는 잠기지 않는다', () => {
  const state = computeRewardLockState({ locked_at: null }, true, 'contentOnly', null)
  assert.equal(state.amountShippingDisabled, false)
  assert.equal(state.nameDescDisabled, false)
  assert.equal(state.deleteHidden, false)
  assert.equal(state.quantityMin, null)
})

test('편집 불가(none)면 전부 잠기고 결제 잠금 문장은 보이지 않는다', () => {
  const state = computeRewardLockState({ locked_at: '2026-09-01T00:00:00Z' }, false, 'none', 10)
  assert.equal(state.amountShippingDisabled, true)
  assert.equal(state.nameDescDisabled, true)
  assert.equal(state.deleteHidden, true)
  assert.equal(state.showLockedReason, false)
})

test('draft(all)에서 잠기지 않은 리워드는 아무것도 막지 않는다', () => {
  const state = computeRewardLockState({ locked_at: null }, false, 'all', null)
  assert.equal(state.amountShippingDisabled, false)
  assert.equal(state.nameDescDisabled, false)
  assert.equal(state.deleteHidden, false)
  assert.equal(state.quantityMin, null)
})

test('수량 감소 판정 — 무제한(null)은 어떤 유한값보다 크다', () => {
  assert.equal(isQuantityBelowMin(5, 10), true)
  assert.equal(isQuantityBelowMin(10, 10), false)
  assert.equal(isQuantityBelowMin(20, 10), false)
  assert.equal(isQuantityBelowMin(null, 10), false) // 유한→null은 증가
  assert.equal(isQuantityBelowMin(5, null), false) // 하한 없음
})

test('하한 아래로 내려가면 즉시 하한으로 끌어올린다', () => {
  assert.equal(clampQuantityToMin(5, 10), 10)
  assert.equal(clampQuantityToMin(15, 10), 15)
  assert.equal(clampQuantityToMin(null, 10), null)
  assert.equal(clampQuantityToMin(5, null), 5)
})

test('PUT 본문 — 기존 리워드는 id를 싣고 새 리워드는 id를 뺀다', () => {
  const rows = [row({ id: 'real-1' }), row({ id: 'temp:abc', title: '새 리워드' })]
  const payload = buildRewardsPayload(rows)
  assert.equal(payload[0].id, 'real-1')
  assert.equal(Object.hasOwn(payload[1], 'id'), false)
  assert.equal(payload[1].title, '새 리워드')
})

test('금액 표시 — 0은 빈 문자열, 그 밖엔 천 단위 콤마', () => {
  assert.equal(formatAmountDisplay(0), '')
  assert.equal(formatAmountDisplay(15000), '15,000')
})

test('금액 입력 파싱 — 숫자만 남긴다', () => {
  assert.equal(parseAmountInput('15,000'), 15000)
  assert.equal(parseAmountInput(''), 0)
  assert.equal(parseAmountInput('abc'), 0)
})

test('수량 입력 파싱 — 빈 문자열은 무제한(null)', () => {
  assert.equal(parseQuantityInput('10'), 10)
  assert.equal(parseQuantityInput(''), null)
})
