import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toPublicReward } from '../../src/lib/funding/publicReward.ts'

const row = {
  id: 'r1',
  campaign_id: 'c1',
  title: 'CD 한 장',
  description: '친필 사인',
  amount: 30000,
  total_quantity: 50,
  requires_shipping: true,
  requires_credit_name: true,
  estimated_delivery: '2026-12',
  image_url: '/images/cd.webp',
  sort_order: 2,
  locked_at: '2026-09-20T05:11:42.318Z',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-20T05:11:42.318Z',
}

test('공개 리워드는 locked_at을 싣지 않는다', () => {
  // 공개 후원자 명단의 `paid_at`과 밀리초까지 같은 값이라, 남으면 이름이 걸린
  // 후원자를 특정 리워드 금액에 묶을 수 있다.
  assert.equal('locked_at' in toPublicReward(row), false)
})

test('공개 리워드는 화면이 쓰는 필드만 싣는다', () => {
  assert.deepEqual(toPublicReward(row), {
    id: 'r1',
    title: 'CD 한 장',
    description: '친필 사인',
    amount: 30000,
    total_quantity: 50,
    requires_shipping: true,
    requires_credit_name: true,
    estimated_delivery: '2026-12',
    image_url: '/images/cd.webp',
  })
})

test('표에 컬럼이 늘어도 저절로 새지 않는다', () => {
  const pub = toPublicReward({ ...row, internal_memo: '대외비' })
  assert.equal('internal_memo' in pub, false)
  assert.equal('campaign_id' in pub, false)
  assert.equal('sort_order' in pub, false)
})
