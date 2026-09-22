import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

// fundingAuth.ts는 `@/lib/server/authz` 같은 tsconfig 경로 별칭을 정적
// import한다. 플레인 `node --test`의 ESM 리졸버는 번들러 전용 별칭인 `@/*`를
// 풀지 못하므로, 공용 해석 훅(memberAuth.test.mjs가 처음 만든 것과 같은
// 내용)을 여기서 등록한다.
registerAliasResolveHook(import.meta.url)

const { canManageCampaign, canReviewCampaign, canViewPledge } = await import(
  '../../src/lib/server/fundingAuth.ts'
)

const member = { registration_status: 'approved', is_active: true, is_admin: false }
const admin = { ...member, is_admin: true }
const pending = { registration_status: 'pending', is_active: false, is_admin: false }
const campaign = { owner_user_id: 'owner' }

test('소유자이면서 승인·활성이어야 관리한다', () => {
  assert.equal(canManageCampaign(member, 'owner', campaign), true)
  assert.equal(canManageCampaign(member, 'other', campaign), false)
  assert.equal(canManageCampaign(pending, 'owner', campaign), false)
  assert.equal(canManageCampaign(null, 'owner', campaign), false)
})

test('관리자는 소유자가 아니어도 관리하고, 심사는 관리자만', () => {
  assert.equal(canManageCampaign(admin, 'other', campaign), true)
  assert.equal(canReviewCampaign(admin), true)
  assert.equal(canReviewCampaign(member), false)
})

test('후원 열람은 본인만(비회원 후원은 세션으로 못 본다)', () => {
  assert.equal(canViewPledge('u1', { user_id: 'u1' }), true)
  assert.equal(canViewPledge('u1', { user_id: 'u2' }), false)
  assert.equal(canViewPledge('u1', { user_id: null }), false)
  assert.equal(canViewPledge(null, { user_id: null }), false)
})
