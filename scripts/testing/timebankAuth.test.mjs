import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TIMEBANK_ACCESS_MESSAGES,
  classifyTimebankAccess,
  timebankRateLimitKey,
} from '../../src/lib/timebank/access.ts'

/**
 * 타임뱅크 참여 판정(`classifyTimebankAccess`, 스펙 §7.2·§9.3·§9.4). 라우트의
 * `requireTimebankReader`·`requireTimebankParticipant`가 이 표를 그대로 응답으로
 * 바꾼다. 문구는 E2E가 정확히 단정한다(계획 Task 7 표).
 */

const on = { enabled: true, terms_version: '2026-11' }
const off = { enabled: false, terms_version: '2026-11' }
const party = (over = {}) => ({
  id: 'm1',
  approved_active: true,
  withdrawal_requested: false,
  terms_current: true,
  ...over,
})
const NOT_AGREED = { agreed: false }
const OUTDATED = { agreed: true }

const run = (settings, p, mode, agreement = { agreed: true }) =>
  classifyTimebankAccess({ settings, party: p, agreed: agreement.agreed, mode })

test('read: 꺼져도·미동의여도·동결이어도 ok', () => {
  assert.equal(run(off, party(), 'read'), 'ok')
  assert.equal(run(on, party({ terms_current: false }), 'read', NOT_AGREED), 'ok')
  assert.equal(run(on, party({ withdrawal_requested: true }), 'read'), 'ok')
  assert.equal(run(on, null, 'read', NOT_AGREED), 'ok')
})

test('write: 꺼짐 → disabled', () => {
  assert.equal(run(off, party(), 'write'), 'disabled')
})

test('write: 미동의 → not_agreed, 프로필 없음도 같다', () => {
  assert.equal(run(on, party({ terms_current: false }), 'write', NOT_AGREED), 'not_agreed')
  assert.equal(run(on, null, 'write', NOT_AGREED), 'not_agreed')
})

test('write: 구판 동의 → terms_outdated', () => {
  assert.equal(run(on, party({ terms_current: false }), 'write', OUTDATED), 'terms_outdated')
})

test('write: 탈퇴 신청 중 → frozen (미동의보다 먼저)', () => {
  assert.equal(run(on, party({ withdrawal_requested: true }), 'write'), 'frozen')
  assert.equal(
    run(on, party({ withdrawal_requested: true, terms_current: false }), 'write', NOT_AGREED),
    'frozen'
  )
})

test('write: 정지·비활성 → inactive', () => {
  assert.equal(run(on, party({ approved_active: false }), 'write'), 'inactive')
})

test('write: 전부 통과 → ok', () => {
  assert.equal(run(on, party(), 'write'), 'ok')
})

test('agree: 꺼짐 → disabled, 동결 → frozen, 미동의·구판은 ok', () => {
  assert.equal(run(off, party({ terms_current: false }), 'agree', NOT_AGREED), 'disabled')
  assert.equal(run(on, party({ withdrawal_requested: true }), 'agree'), 'frozen')
  assert.equal(run(on, party({ terms_current: false }), 'agree', NOT_AGREED), 'ok')
  assert.equal(run(on, party({ terms_current: false }), 'agree', OUTDATED), 'ok')
  assert.equal(run(on, null, 'agree', NOT_AGREED), 'ok')
})

test('peer(참여자 명단·디렉터리): 꺼져도 되지만 현재 판 동의는 필요', () => {
  assert.equal(run(off, party(), 'peer'), 'ok')
  assert.equal(run(on, party({ withdrawal_requested: true }), 'peer'), 'ok')
  assert.equal(run(on, party({ terms_current: false }), 'peer', NOT_AGREED), 'not_agreed')
  assert.equal(run(on, party({ terms_current: false }), 'peer', OUTDATED), 'terms_outdated')
  assert.equal(run(on, null, 'peer', NOT_AGREED), 'not_agreed')
})

test('스위치는 === true만 켜짐으로 본다', () => {
  for (const enabled of ['true', 1, null, undefined]) {
    assert.equal(run({ enabled, terms_version: 'x' }, party(), 'write'), 'disabled')
  }
})

test('응답 문구는 계획 표 그대로', () => {
  assert.equal(TIMEBANK_ACCESS_MESSAGES.disabled, '타임뱅크가 지금 꺼져 있습니다.')
  assert.equal(TIMEBANK_ACCESS_MESSAGES.not_agreed, '타임뱅크 이용규칙에 먼저 동의해 주세요.')
  assert.equal(TIMEBANK_ACCESS_MESSAGES.terms_outdated, '바뀐 이용규칙에 다시 동의해 주세요.')
  assert.equal(TIMEBANK_ACCESS_MESSAGES.frozen, '탈퇴 신청 중에는 타임뱅크를 이용할 수 없습니다.')
  assert.equal(typeof TIMEBANK_ACCESS_MESSAGES.inactive, 'string')
})

test('레이트리밋 키는 IP가 아니라 사용자 id로 센다', () => {
  assert.equal(timebankRateLimitKey('listing', 'u-1'), 'rate_limit:timebank:listing:u-1')
  assert.notEqual(timebankRateLimitKey('listing', 'u-1'), timebankRateLimitKey('comment', 'u-1'))
  assert.notEqual(timebankRateLimitKey('listing', 'u-1'), timebankRateLimitKey('listing', 'u-2'))
})
