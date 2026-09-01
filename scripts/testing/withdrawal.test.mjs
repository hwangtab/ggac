import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const CONSTANTS = new URL('../../src/constants/memberProfile.ts', import.meta.url)

/**
 * `src/db/queries/withdrawal.ts`가 쓰는 `src/db/client.ts`의 `db`는 모듈
 * 수준 지연 Proxy라, 처음 실제로 접근하는 시점의 `TURSO_DATABASE_URL`로 연결을
 * 고정해 프로세스 안에서 재사용한다(`cachedRawClient`). 그래서 이 env를 **그
 * 모듈을 처음 import하기 전에** 파일 스코프에서 직접 설정해야 한다 — 실행자가
 * 셸에서 손으로 넘겨주는 값에만 기대면(운영 자격증명이 셸에 남은 채
 * `npm run test:unit`을 돌리는 경우) 이 테스트가 실제로 운영 DB에 UPDATE를
 * 쏠 수 있다. `scripts/testing/queriesProfiles.test.mjs`를 비롯한
 * `queries*.test.mjs` 전부가 이 패턴을 쓴다 — 새 방식을 발명하지 않는다.
 */
const DB_PATH = 'scripts/testing/.withdrawal-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const WITHDRAWAL_MODULE_URL = new URL('../../src/db/queries/withdrawal.ts', import.meta.url)

/** 승인·활성 조합원 한 명을 심는다. */
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

async function statusOf(client, id) {
  const result = await client.execute({
    sql: 'SELECT registration_status s FROM member_profiles WHERE id=?',
    args: [id],
  })
  return result.rows[0]?.s
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

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

test('신청·취소가 조건부 UPDATE로 승인↔신청 상태를 오가고, 다른 조합원은 건드리지 않는다', async () => {
  // m1만 신청·취소를 거치고, m2는 승인 상태 그대로 남아야 한다 — id 술어가
  // 빠지면(리뷰 지적) 승인 상태 조합원 전원이 함께 바뀌는데, 조합원이 한 명뿐인
  // 픽스처로는 그 결함이 드러나지 않는다.
  await seedMember(setupClient, { id: 'm1' })
  await seedMember(setupClient, { id: 'm2' })

  const { requestWithdrawal, cancelWithdrawal } = await import(WITHDRAWAL_MODULE_URL.href)

  assert.equal(await requestWithdrawal('m1'), true)
  assert.equal(await statusOf(setupClient, 'm1'), 'withdrawal_requested')
  assert.equal(await statusOf(setupClient, 'm2'), 'approved')

  // 두 번째 신청은 이미 신청 상태라 false — 조건부 UPDATE의 rowsAffected 판정.
  assert.equal(await requestWithdrawal('m1'), false)

  assert.equal(await cancelWithdrawal('m1'), true)
  assert.equal(await statusOf(setupClient, 'm1'), 'approved')
  assert.equal(await statusOf(setupClient, 'm2'), 'approved')

  // 승인 상태에서 또 취소하면 false
  assert.equal(await cancelWithdrawal('m1'), false)
})
