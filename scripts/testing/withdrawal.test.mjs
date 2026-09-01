import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const CONSTANTS = new URL('../../src/constants/memberProfile.ts', import.meta.url)

/** 승인·활성 조합원 한 명을 심고 client를 돌려준다. */
async function seedMember(client, { id = 'm1', isAdmin = false } = {}) {
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, registration_status, is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, 'approved', 1, ?, ?, ?)`,
    args: [id, `${id}@example.test`, `회원 ${id}`, isAdmin ? 1 : 0, now, now],
  })
  return id
}

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

// `requestWithdrawal`/`cancelWithdrawal`이 쓰는 `src/db/client.ts`의 `db`는
// 프로세스 안에서 연결을 한 번 열면 그 파일 경로에 고정해 재사용한다
// (`cachedRawClient`). 신청 테스트가 끝난 뒤 파일을 지우고 같은 경로에 새
// 파일을 만들면 그 캐시가 "이동된 파일"을 보게 되어 SQLITE_READONLY_DBMOVED로
// 죽는다 — 그래서 신청·취소를 별도 테스트로 나누지 않고 같은 DB 파일 위에서
// 한 테스트 안에 이어 붙인다. (`queriesProfiles.test.mjs`도 같은 이유로
// before/after에서 파일을 한 번만 만든다.)
test('신청·취소가 조건부 UPDATE로 승인↔신청 상태를 오간다', async () => {
  const path = '/tmp/wd-request.db'
  const { rmSync } = await import('node:fs')
  for (const s of ['', '-wal', '-shm']) rmSync(`${path}${s}`, { force: true })
  const c = createClient({ url: `file:${path}` })
  try {
    await applyMigrations(c)
    await seedMember(c, { id: 'm1' })

    const { requestWithdrawal, cancelWithdrawal } = await import(
      new URL('../../src/db/queries/withdrawal.ts', import.meta.url).href
    )
    // 쿼리 계층은 모듈 수준 `db`를 쓰므로 TURSO_DATABASE_URL이 이 파일을
    // 가리켜야 한다. 테스트 실행 시 env로 지정한다.
    assert.equal(await requestWithdrawal('m1'), true)

    let after = await c.execute("SELECT registration_status s FROM member_profiles WHERE id='m1'")
    assert.equal(after.rows[0].s, 'withdrawal_requested')

    // 두 번째 신청은 이미 신청 상태라 false — 조건부 UPDATE의 rowsAffected 판정.
    assert.equal(await requestWithdrawal('m1'), false)

    assert.equal(await cancelWithdrawal('m1'), true)
    after = await c.execute("SELECT registration_status s FROM member_profiles WHERE id='m1'")
    assert.equal(after.rows[0].s, 'approved')

    // 승인 상태에서 또 취소하면 false
    assert.equal(await cancelWithdrawal('m1'), false)
  } finally {
    c.close()
    for (const s of ['', '-wal', '-shm']) rmSync(`${path}${s}`, { force: true })
  }
})
