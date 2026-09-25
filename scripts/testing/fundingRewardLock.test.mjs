import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateRewardPatch,
  canDeleteReward,
  deliveryChangesToLog,
  rewardPatchChangesNothing,
} from '../../src/lib/funding/rewardLock.ts'

const unlocked = {
  title: '리워드',
  description: '설명',
  amount: 10000,
  requires_shipping: false,
  total_quantity: 10,
  image_url: '/images/reward.jpg',
  locked_at: null,
}
const locked = { ...unlocked, locked_at: '2026-09-21T00:00:00.000Z' }

test('잠기지 않은 리워드는 무엇이든 바꾼다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 500, total_quantity: 1 }), { ok: true })
  assert.equal(canDeleteReward(unlocked), true)
})

test('잠긴 리워드는 금액·배송 여부를 못 바꾸고 삭제도 안 된다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 20000 }), {
    ok: false,
    reason: 'locked_amount',
  })
  assert.deepEqual(evaluateRewardPatch(locked, { requires_shipping: true }), {
    ok: false,
    reason: 'locked_shipping',
  })
  assert.equal(canDeleteReward(locked), false)
})

test('잠긴 리워드의 수량은 늘리기만 된다(무제한→한정도 감소)', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 20 }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 5 }), {
    ok: false,
    reason: 'quantity_decrease',
  })
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: null }), { ok: true })
  assert.deepEqual(
    evaluateRewardPatch({ ...locked, total_quantity: null }, { total_quantity: 100 }),
    { ok: false, reason: 'quantity_decrease' }
  )
})

test('같은 값으로 덮는 것은 변경이 아니다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { amount: 10000, requires_shipping: false }), {
    ok: true,
  })
})

test('공개 중(contentOnly)인 기존 리워드는 결제 여부와 무관하게 이름·설명·금액·배송이 잠긴다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { requires_shipping: true }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { title: '새 이름' }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { description: '새 설명' }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_field',
  })
})

test('공개 중이어도 수량 증가·같은 값 유지는 막지 않는다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: 20 }, 'contentOnly'), {
    ok: true,
  })
  assert.deepEqual(
    evaluateRewardPatch(
      unlocked,
      { amount: 10000, requires_shipping: false, title: '리워드' },
      'contentOnly'
    ),
    { ok: true }
  )
})

test('scope를 안 주거나 all이면 공개 중 잠금이 걸리지 않는다(초안 등)', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(unlocked, { amount: 20000 }, 'all'), { ok: true })
})

// 화면(`rewardsActiveNotice`)이 "공개된 뒤에는 리워드를 추가하거나 수량을 늘릴
// 수만 있습니다"라고 약속한다. 결제가 아직 없는 리워드의 수량 축소가 그
// 약속을 뚫고 지나가던 구멍을 막았다 — 아래 두 테스트가 양쪽 방향을 다 본다.
test('공개 중에는 결제가 없어도 기존 리워드의 수량을 줄일 수 없다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: 3 }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_quantity_decrease',
  })
  // 무제한(null)은 어떤 유한값보다 크다 — null→유한은 감소다.
  assert.deepEqual(
    evaluateRewardPatch(
      { ...unlocked, total_quantity: null },
      { total_quantity: 100 },
      'contentOnly'
    ),
    { ok: false, reason: 'content_only_quantity_decrease' }
  )
})

test('공개 중에도 수량 증가·무제한 전환·같은 값 유지는 그대로 통과한다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: 11 }, 'contentOnly'), {
    ok: true,
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: null }, 'contentOnly'), {
    ok: true,
  })
  assert.deepEqual(evaluateRewardPatch(unlocked, { total_quantity: 10 }, 'contentOnly'), {
    ok: true,
  })
  // 수량을 아예 안 보내는 patch는 수량 규칙을 건드리지 않는다.
  assert.deepEqual(evaluateRewardPatch(unlocked, {}, 'contentOnly'), { ok: true })
})

test('공개 중 결제까지 있는 리워드의 수량 축소는 결제 잠금이 아니라 공개 잠금으로 먼저 걸린다', () => {
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 5 }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_quantity_decrease',
  })
  // 초안(all)에서는 결제 잠금만 남는다 — 이유 문장이 사실과 맞아야 한다.
  assert.deepEqual(evaluateRewardPatch(locked, { total_quantity: 5 }, 'all'), {
    ok: false,
    reason: 'quantity_decrease',
  })
})

// --- 2026-09-23 감사: 잠금 판정이 모르던 세 컬럼 -----------------------------

test('공개 중에는 기존 리워드의 사진을 바꿀 수 없다(결제 유무와 무관)', () => {
  assert.deepEqual(
    evaluateRewardPatch(unlocked, { image_url: '/images/다른.jpg' }, 'contentOnly'),
    {
      ok: false,
      reason: 'content_only_image',
    }
  )
  assert.deepEqual(evaluateRewardPatch(unlocked, { image_url: null }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_image',
  })
  assert.deepEqual(evaluateRewardPatch(locked, { image_url: '/images/다른.jpg' }, 'contentOnly'), {
    ok: false,
    reason: 'content_only_image',
  })
})

test('같은 사진을 그대로 다시 보내는 것은 변경이 아니다 — 매번 전체를 보내는 화면이 막히면 안 된다', () => {
  assert.deepEqual(
    evaluateRewardPatch(unlocked, { image_url: '/images/reward.jpg' }, 'contentOnly'),
    { ok: true }
  )
  assert.deepEqual(
    evaluateRewardPatch({ ...unlocked, image_url: null }, { image_url: null }, 'contentOnly'),
    { ok: true }
  )
})

test('초안(all)에서는 사진을 자유롭게 바꾼다', () => {
  assert.deepEqual(evaluateRewardPatch(unlocked, { image_url: '/images/다른.jpg' }), { ok: true })
  assert.deepEqual(evaluateRewardPatch(unlocked, { image_url: '/images/다른.jpg' }, 'all'), {
    ok: true,
  })
})

test('예상 전달월과 정렬 순서는 어느 가지에서도 막지 않는다', () => {
  for (const scope of ['all', 'contentOnly']) {
    assert.deepEqual(
      evaluateRewardPatch(unlocked, { estimated_delivery: '2027-01', sort_order: 5 }, scope),
      { ok: true }
    )
    assert.deepEqual(
      evaluateRewardPatch(locked, { estimated_delivery: '2027-01', sort_order: 5 }, scope),
      { ok: true }
    )
  }
})

test('예상 전달월 변경은 이전 값·새 값과 함께 기록거리로 뽑힌다', () => {
  const existing = [
    { id: 'r1', title: '리워드1', estimated_delivery: '2026-11' },
    { id: 'r2', title: '리워드2', estimated_delivery: null },
  ]
  assert.deepEqual(
    deliveryChangesToLog(existing, [
      { id: 'r1', title: '리워드1', estimated_delivery: '2027-03' },
      { id: 'r2', title: '리워드2', estimated_delivery: null },
      { title: '새 리워드', estimated_delivery: '2027-05' },
    ]),
    [{ reward_id: 'r1', reward_title: '리워드1', from: '2026-11', to: '2027-03' }]
  )
  // null↔값 양방향도 변경이다.
  assert.deepEqual(
    deliveryChangesToLog(existing, [{ id: 'r2', title: '리워드2', estimated_delivery: '2027-01' }]),
    [{ reward_id: 'r2', reward_title: '리워드2', from: null, to: '2027-01' }]
  )
  assert.deepEqual(
    deliveryChangesToLog(existing, [{ id: 'r1', title: '리워드1', estimated_delivery: null }]),
    [{ reward_id: 'r1', reward_title: '리워드1', from: '2026-11', to: null }]
  )
  // 바뀐 것이 없으면 아무것도 남기지 않는다.
  assert.deepEqual(
    deliveryChangesToLog(existing, [{ id: 'r1', title: '리워드1', estimated_delivery: '2026-11' }]),
    []
  )
})

// ── 사진이 NULL인 행 하나가 그 캠페인의 리워드 저장을 통째로 막던 것 ────────

test('빈 값과 값 없음은 같은 것으로 본다 — 사진·설명이 NULL인 행이 저장을 막지 않는다', () => {
  // 화면이 보내는 값은 `parseRewardList`를 지나 빈 입력칸이 `''`가 된다.
  // 표에는 NULL이 들어 있을 수 있다(시드·수기 보정). 둘 다 "없음"이다.
  const existing = {
    title: '음반',
    description: null,
    amount: 30000,
    requires_shipping: true,
    total_quantity: 10,
    image_url: null,
    locked_at: null,
  }
  const patch = {
    title: '음반',
    description: '',
    amount: 30000,
    requires_shipping: true,
    total_quantity: 10,
    image_url: '',
  }
  assert.deepEqual(evaluateRewardPatch(existing, patch, 'contentOnly'), { ok: true })
  // 반대 방향도 같다.
  assert.deepEqual(
    evaluateRewardPatch(
      { ...existing, description: '', image_url: '' },
      { ...patch, description: null, image_url: null },
      'contentOnly'
    ),
    { ok: true }
  )
  // 진짜로 사진이 바뀌는 것은 여전히 막는다.
  assert.deepEqual(
    evaluateRewardPatch(existing, { ...patch, image_url: 'https://x/y.webp' }, 'contentOnly'),
    { ok: false, reason: 'content_only_image' }
  )
})

// ── 값이 그대로인 리워드는 쓰지 않는다 ─────────────────────────────────────

/**
 * 화면은 목록을 통째로 보낸다 — 스무 개를 띄워 놓고 하나만 고쳐도 스무 개가
 * 올라온다. 그걸 그대로 UPDATE 스무 문장으로 만들면, 원격 Turso에서 문장 하나가
 * 왕복 하나라 그동안 사이트 전체의 쓰기가 멈춘다(결제 확정 포함).
 */
const saved = {
  title: '음반',
  description: '설명',
  amount: 30000,
  requires_shipping: true,
  total_quantity: 50,
  image_url: '/images/album.jpg',
  estimated_delivery: '2026-12',
  sort_order: 2,
}

test('한 칸도 달라지지 않은 패치는 쓸 것이 없다', () => {
  assert.equal(rewardPatchChangesNothing(saved, { ...saved }), true)
})

test('칸 하나만 달라져도 써야 한다', () => {
  const cases = [
    { title: '음반 (재발매)' },
    { description: '다른 설명' },
    { amount: 35000 },
    { requires_shipping: false },
    { total_quantity: 60 },
    { total_quantity: null },
    { image_url: '/images/other.jpg' },
    { estimated_delivery: '2027-01' },
    { sort_order: 3 },
  ]
  for (const diff of cases) {
    assert.equal(
      rewardPatchChangesNothing(saved, { ...saved, ...diff }),
      false,
      `${Object.keys(diff)[0]} 변경을 못 잡았다`
    )
  }
})

test('빈 값과 없음은 같게 본다 — 건드린 적 없는 칸이 매번 UPDATE를 부르지 않게', () => {
  const blank = { ...saved, description: null, image_url: null, estimated_delivery: null }
  assert.equal(
    rewardPatchChangesNothing(blank, {
      ...blank,
      description: '',
      image_url: '',
      estimated_delivery: '',
    }),
    true
  )
})

test('패치에 없는 칸은 비교하지 않는다', () => {
  assert.equal(rewardPatchChangesNothing(saved, { title: saved.title }), true)
  assert.equal(rewardPatchChangesNothing(saved, {}), true)
})
