import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  nextStatus,
  actorFor,
  editScope,
  CONTENT_ONLY_FIELDS,
  PUBLIC_CAMPAIGN_STATUSES,
} from '../../src/lib/funding/transitions.ts'

test('전이표: 허용된 전이만 다음 상태를 준다', () => {
  assert.equal(nextStatus('draft', 'submit'), 'submitted')
  assert.equal(nextStatus('submitted', 'approve'), 'active')
  assert.equal(nextStatus('submitted', 'reject'), 'draft')
  assert.equal(nextStatus('submitted', 'withdraw'), 'draft')
  assert.equal(nextStatus('active', 'close'), 'closed')
  assert.equal(nextStatus('closed', 'settle'), 'settled')
})

test('전이표: 역행과 건너뛰기는 null', () => {
  assert.equal(nextStatus('draft', 'approve'), null)
  assert.equal(nextStatus('active', 'reject'), null)
  assert.equal(nextStatus('active', 'submit'), null)
  assert.equal(nextStatus('closed', 'close'), null)
  assert.equal(nextStatus('settled', 'settle'), null)
})

test('심사·정산은 관리자만', () => {
  assert.equal(actorFor('approve'), 'admin')
  assert.equal(actorFor('reject'), 'admin')
  assert.equal(actorFor('settle'), 'admin')
  assert.equal(actorFor('submit'), 'owner_or_admin')
  assert.equal(actorFor('withdraw'), 'owner_or_admin')
  assert.equal(actorFor('close'), 'owner_or_admin')
})

test('편집 범위: draft 전체, active 본문만, 나머지 없음', () => {
  assert.equal(editScope('draft'), 'all')
  assert.equal(editScope('active'), 'contentOnly')
  assert.equal(editScope('submitted'), 'none')
  assert.equal(editScope('closed'), 'none')
  assert.deepEqual([...CONTENT_ONLY_FIELDS].sort(), ['cover_image', 'end_at', 'og_image', 'story', 'summary'])
})

test('공개 상태는 active·closed·settled', () => {
  assert.deepEqual([...PUBLIC_CAMPAIGN_STATUSES], ['active', 'closed', 'settled'])
})
