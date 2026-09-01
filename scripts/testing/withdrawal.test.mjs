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

test('탐지기의 상태 목록이 앱 상수와 정확히 같다(양방향)', async () => {
  // 문자열 slice로 "어디서부터 어디까지"를 정하면 이 뒤에 새 불변식이 늘 때마다
  // 경계가 조용히 넓어진다(리뷰 지적: 이벤트 신청용 notIn('status', [...])이
  // 뒤에 있어서 registration_status 블록에서 'pending'을 지워도 이 검사가
  // 여전히 통과했다). 그래서 텍스트를 훑는 대신 `CHECK_INVARIANTS` 배열에서
  // 해당 항목의 `where` 절을 직접 파싱해 배열 대 배열로 비교한다 —
  // `missingCheckConstraints.test.mjs`가 이미 이 모듈을 임포트해 쓰는
  // 선례를 따른다.
  const { REGISTRATION_STATUSES } = await import(CONSTANTS.href)
  const { CHECK_INVARIANTS } = await import(
    new URL('../../scripts/turso/check-invariants.mjs', import.meta.url).href
  )

  const invariant = CHECK_INVARIANTS.find(
    i => i.constraint === 'member_profiles_registration_status_check'
  )
  assert.ok(invariant, 'CHECK_INVARIANTS에서 member_profiles_registration_status_check를 못 찾았다')

  const match = invariant.where.match(/NOT IN \(([^)]*)\)/)
  assert.ok(match, `탐지기 where 절 형식이 바뀌었다: ${invariant.where}`)
  const detectorStatuses = match[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))

  // 양방향: 앱에만 있는 값(탐지기 누락 = 정상 데이터를 위반으로 오탐)과
  // 탐지기에만 있는 값(앱에 없는 잉여 = 반대로 실제 위반을 놓침) 둘 다 잡는다.
  assert.deepEqual(
    [...detectorStatuses].sort(),
    [...REGISTRATION_STATUSES].sort(),
    '탐지기 상태 목록과 앱 상수(REGISTRATION_STATUSES)가 어긋난다'
  )
})
