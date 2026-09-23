import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toReviewDetail } from '../../src/app/[locale]/admin/funding/reviewDetail.ts'

/** `GET /api/mypage/funding/campaigns/[id]`가 실제로 주는 모양. 개설자 화면을
 *  위해 만든 응답이라 후원자 명단이 함께 들어 있다. */
const response = {
  campaign: {
    id: 'c1',
    title: '첫 음반',
    summary: '요약',
    story: '## 우리 이야기\n\n본문입니다.',
    status: 'submitted',
    updated_at: '2026-09-23T01:02:03.004Z',
  },
  rewards: [
    {
      id: 'r1',
      campaign_id: 'c1',
      title: 'CD 한 장',
      description: '사인 포함',
      amount: 30000,
      total_quantity: 50,
      requires_shipping: true,
      estimated_delivery: '2026-12',
      image_url: '/images/cd.jpg',
      sort_order: 0,
      locked_at: '2026-09-20T00:00:00.000Z',
    },
    {
      id: 'r2',
      campaign_id: 'c1',
      title: '온라인 감상회',
      description: null,
      amount: 10000,
      total_quantity: null,
      requires_shipping: false,
      estimated_delivery: null,
      image_url: null,
      sort_order: 1,
      locked_at: null,
    },
  ],
  progress: { raised_amount: 30000, backer_count: 1 },
  pledges: [
    {
      id: 'p1',
      pledge_code: 'GGAC-1',
      backer_name: '홍길동',
      backer_email: 'hong@example.kr',
      shipping_name: '홍길동',
      shipping_phone: '010-0000-0000',
      shipping_postcode: '13529',
      shipping_address1: '경기도 성남시 …',
      shipping_address2: '101동 1001호',
      shipping_memo: '부재 시 경비실',
      supporter_message: '응원합니다',
    },
  ],
  edit_scope: 'none',
}

test('심사 화면은 본문과 리워드를 판정에 필요한 만큼 싣는다', () => {
  const detail = toReviewDetail(response)
  assert.equal(detail.story, '## 우리 이야기\n\n본문입니다.')
  assert.equal(detail.version, '2026-09-23T01:02:03.004Z')
  assert.equal(detail.rewards.length, 2)
  assert.deepEqual(detail.rewards[0], {
    id: 'r1',
    title: 'CD 한 장',
    description: '사인 포함',
    amount: 30000,
    total_quantity: 50,
    requires_shipping: true,
    estimated_delivery: '2026-12',
    image_url: '/images/cd.jpg',
  })
  assert.equal(detail.rewards[1].total_quantity, null)
  assert.equal(detail.rewards[1].requires_shipping, false)
  // 사진 없는 리워드는 null이어야 한다 — 빈 문자열이 넘어가면 화면이
  // "사진 없음" 대신 깨진 이미지를 그린다.
  assert.equal(detail.rewards[1].image_url, null)
})

test('후원자 정보는 심사 화면으로 한 글자도 넘어가지 않는다', () => {
  const detail = toReviewDetail(response)
  const dumped = JSON.stringify(detail)
  for (const secret of [
    'pledges',
    '홍길동',
    'hong@example.kr',
    '010-0000-0000',
    '13529',
    '경기도 성남시',
    '101동 1001호',
    '부재 시 경비실',
    '응원합니다',
    'GGAC-1',
  ]) {
    assert.equal(dumped.includes(secret), false, `심사 화면에 '${secret}'이(가) 실렸다`)
  }
  assert.equal('pledges' in detail, false)
  assert.equal('progress' in detail, false)
})

test('응답에 키가 늘어도 저절로 새지 않는다 — 싣는 목록이 정본이다', () => {
  const detail = toReviewDetail({
    ...response,
    campaign: { ...response.campaign, internal_review_memo: '개설자에게 보이면 안 되는 메모' },
    rewards: [{ ...response.rewards[0], secret_cost: 12345 }],
    bank_account: '123-456-789',
  })
  assert.deepEqual(Object.keys(detail).sort(), ['rewards', 'story', 'version'])
  assert.deepEqual(Object.keys(detail.rewards[0]).sort(), [
    'amount',
    'description',
    'estimated_delivery',
    'id',
    'image_url',
    'requires_shipping',
    'title',
    'total_quantity',
  ])
  assert.equal(JSON.stringify(detail).includes('12345'), false)
  assert.equal(JSON.stringify(detail).includes('123-456-789'), false)
})

test('사진은 심사 화면으로 넘어간다 — 관리자가 보지 못한 것을 승인으로 얼리지 않는다', () => {
  const detail = toReviewDetail(response)
  assert.equal(detail.rewards[0].image_url, '/images/cd.jpg')
  // 빈 문자열은 사진이 아니다.
  const blank = toReviewDetail({
    ...response,
    rewards: [{ ...response.rewards[0], image_url: '' }],
  })
  assert.equal(blank.rewards[0].image_url, null)
})

test('본문이 비어 있거나 리워드가 없어도 모양이 무너지지 않는다', () => {
  const detail = toReviewDetail({ campaign: { updated_at: 'v1' } })
  assert.deepEqual(detail, { story: '', rewards: [], version: 'v1' })
  assert.deepEqual(toReviewDetail(null), { story: '', rewards: [], version: '' })
})
