import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toPublicCampaign } from '../../src/lib/funding/publicCampaign.ts'

const row = {
  id: 'c1',
  slug: 'my-album',
  title: '앨범',
  status: 'active',
  owner_user_id: 'u1',
  platform_fee_rate: 500,
  review_note: '사진 해상도가 낮아 반려했습니다.',
}

test('공개 응답은 소유자 id·수수료율·심사 메모를 싣지 않는다', () => {
  const pub = toPublicCampaign(row)
  assert.equal('owner_user_id' in pub, false)
  assert.equal('platform_fee_rate' in pub, false)
  assert.equal('review_note' in pub, false)
})

test('공개 응답은 나머지 필드를 그대로 남긴다', () => {
  const pub = toPublicCampaign(row)
  assert.deepEqual(pub, { id: 'c1', slug: 'my-album', title: '앨범', status: 'active' })
})

test('원본은 바뀌지 않는다', () => {
  toPublicCampaign(row)
  assert.equal(row.review_note, '사진 해상도가 낮아 반려했습니다.')
})
