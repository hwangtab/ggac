import { test } from 'node:test'
import assert from 'node:assert/strict'

import { proxyOwnerVerdict } from '../../src/lib/funding/proxyOwner.ts'
import {
  MEMBER_FEE_RATE_BP,
  NONMEMBER_FEE_RATE_BP,
  platformFeeRateFor,
} from '../../src/lib/funding/feeRate.ts'

const rates = { member_bp: MEMBER_FEE_RATE_BP, nonmember_bp: NONMEMBER_FEE_RATE_BP }

test('대리 개설: 승인·활성 조합원은 개설자가 되고 승인 때 3.3%가 붙는다', () => {
  const profile = { registration_status: 'approved', is_active: true }
  assert.deepEqual(proxyOwnerVerdict(profile), { ok: true, is_member: true })
  assert.equal(platformFeeRateFor(rates, profile).rate_bp, 330)
})

test('대리 개설: 조합원이 아닌 회원도 개설자가 되고 승인 때 5.5%가 붙는다', () => {
  for (const profile of [
    { registration_status: 'pending', is_active: true },
    { registration_status: 'approved', is_active: false },
    { registration_status: 'rejected', is_active: true },
  ]) {
    assert.deepEqual(proxyOwnerVerdict(profile), { ok: true, is_member: false })
    assert.equal(platformFeeRateFor(rates, profile).rate_bp, 550)
  }
})

test('대리 개설: 없는 회원과 탈퇴한 회원은 개설자가 될 수 없다', () => {
  assert.equal(proxyOwnerVerdict(null).ok, false)
  assert.equal(proxyOwnerVerdict({ registration_status: 'withdrawn', is_active: false }).ok, false)
  assert.equal(
    proxyOwnerVerdict({
      registration_status: 'approved',
      is_active: true,
      withdrawn_at: '2026-09-01',
    }).ok,
    false
  )
})
