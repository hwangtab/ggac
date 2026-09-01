import test from 'node:test'
import assert from 'node:assert/strict'

const CONSTANTS = new URL('../../src/constants/memberProfile.ts', import.meta.url)

test('탈퇴 상태 두 개가 상태 목록에 있다', async () => {
  const { REGISTRATION_STATUSES } = await import(CONSTANTS.href)
  assert.ok(REGISTRATION_STATUSES.includes('withdrawal_requested'))
  assert.ok(REGISTRATION_STATUSES.includes('withdrawn'))
  // 기존 값이 사라지면 승인·거부 흐름이 통째로 깨진다.
  for (const existing of ['pending', 'approved', 'rejected']) {
    assert.ok(REGISTRATION_STATUSES.includes(existing), `${existing}가 사라졌다`)
  }
})

test('자리표시자 이메일은 회원마다 다르고 실제 도메인이 아니다', async () => {
  const { withdrawnEmailFor } = await import(CONSTANTS.href)
  assert.equal(withdrawnEmailFor('abc'), 'withdrawn+abc@ggac.invalid')
  assert.notEqual(withdrawnEmailFor('a'), withdrawnEmailFor('b'))
  // `member_profiles_email_idx`가 UNIQUE라 두 탈퇴자가 충돌하면 안 된다.
  // `.invalid`는 RFC 2606이 예약한 도메인이라 실제로 메일이 가지 않는다.
  assert.match(withdrawnEmailFor('x'), /@ggac\.invalid$/)
})

test('탐지기의 상태 목록이 앱 상수와 정확히 같다', async () => {
  const { readFile } = await import('node:fs/promises')
  const { REGISTRATION_STATUSES } = await import(CONSTANTS.href)
  const src = await readFile(
    new URL('../../scripts/turso/check-invariants.mjs', import.meta.url),
    'utf8'
  )
  const block = src.slice(src.indexOf('member_profiles_registration_status_check'))
  for (const status of REGISTRATION_STATUSES) {
    assert.ok(
      block.includes(`'${status}'`),
      `탐지기에 ${status}가 없다 — 정상 데이터를 위반으로 보고한다`
    )
  }
})
