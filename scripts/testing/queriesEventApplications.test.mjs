import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `hasEventApplicationForContact`(src/db/queries/misc.ts)를 실제 SQLite 파일
 * DB로 검증한다. 운영 실측: `home-recording-mixing-workshop` 이벤트에서
 * 같은 `event_slug`+`contact_email`+`contact_phone` 조합이 2건 존재했다 —
 * insert 전에 조회조차 하지 않았기 때문이다. 이 파일은 그 회귀를 막는다.
 *
 * 패턴은 `scripts/testing/queriesProfiles.test.mjs`와 같다: 파일 스코프에서
 * `TURSO_DATABASE_URL`을 자기 파일 DB로 고정해 실행자 env에 기대지 않는다.
 */

const DB_PATH = 'scripts/testing/.queries-event-applications-test.db'
const MISC_MODULE_URL = new URL('../../src/db/queries/misc.ts', import.meta.url)

async function loadFreshMiscModule() {
  return import(`${MISC_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

function makeApplication(overrides = {}) {
  return {
    event_slug: overrides.event_slug ?? 'home-recording-mixing-workshop',
    applicant_name: overrides.applicant_name ?? '홍길동',
    contact_email: overrides.contact_email ?? null,
    contact_phone: overrides.contact_phone ?? '010-1234-5678',
    performance_info: null,
    items_to_sell: null,
    links: null,
    message: null,
    participation_type: null,
    photo_url: null,
    privacy_consent: true,
    privacy_consent_at: new Date().toISOString(),
    ...overrides,
  }
}

test('같은 이벤트에 같은 연락처로 신청한 적이 있으면 true를 돌려준다', async () => {
  const { createEventApplication, hasEventApplicationForContact } = await loadFreshMiscModule()

  await createEventApplication(
    makeApplication({ event_slug: 'evt-dup', contact_phone: '010-0000-0001' })
  )

  const result = await hasEventApplicationForContact('evt-dup', '010-0000-0001')
  assert.equal(result, true)
})

test('부정 대조: 다른 이벤트에는 막히지 않는다 (과잉 차단 방지)', async () => {
  const { createEventApplication, hasEventApplicationForContact } = await loadFreshMiscModule()

  await createEventApplication(
    makeApplication({ event_slug: 'evt-a', contact_phone: '010-0000-0002' })
  )

  const result = await hasEventApplicationForContact('evt-b', '010-0000-0002')
  assert.equal(result, false)
})

test('부정 대조: 같은 이벤트라도 다른 연락처는 막히지 않는다 (과잉 차단 방지)', async () => {
  const { createEventApplication, hasEventApplicationForContact } = await loadFreshMiscModule()

  await createEventApplication(
    makeApplication({ event_slug: 'evt-c', contact_phone: '010-0000-0003' })
  )

  const result = await hasEventApplicationForContact('evt-c', '010-9999-9999')
  assert.equal(result, false)
})

test('신청 기록이 아예 없으면 false를 돌려준다', async () => {
  const { hasEventApplicationForContact } = await loadFreshMiscModule()

  const result = await hasEventApplicationForContact('evt-never-applied', '010-0000-0000')
  assert.equal(result, false)
})

// -------------------------------------------------- 상태 전이 낙관적 잠금
//
// 관리자 둘이 거의 동시에 승인과 거부를 누르면, 조건 없는 UPDATE에서는
// 나중 쓰기가 그냥 이기고 먼저 누른 쪽은 자기 판단이 반영된 줄 안다.
// `updateEventApplicationStatus`는 `expectedStatus`를 받아 그 값이 아직
// 그대로일 때만 쓰고, 아니면 false를 돌려준다(라우트가 409로 바꾼다).

test('expectedStatus가 맞으면 갱신하고 true를 돌려준다', async () => {
  const { createEventApplication, updateEventApplicationStatus, listEventApplications } =
    await loadFreshMiscModule()

  const { id } = await createEventApplication(
    makeApplication({ event_slug: 'evt-lock-1', contact_phone: '010-1000-0001' })
  )

  assert.equal(await updateEventApplicationStatus(id, 'approved', 'pending'), true)

  const { rows } = await listEventApplications({ eventSlug: 'evt-lock-1', page: 1, limit: 10 })
  assert.equal(rows[0].status, 'approved')
})

test('그 사이 다른 관리자가 상태를 바꿨으면 쓰지 않고 false를 돌려준다', async () => {
  const { createEventApplication, updateEventApplicationStatus, listEventApplications } =
    await loadFreshMiscModule()

  const { id } = await createEventApplication(
    makeApplication({ event_slug: 'evt-lock-2', contact_phone: '010-1000-0002' })
  )

  // 관리자 A가 먼저 승인했다.
  assert.equal(await updateEventApplicationStatus(id, 'approved', 'pending'), true)

  // 관리자 B는 아직 pending 화면을 보고 있다 — 거부를 누른다.
  assert.equal(
    await updateEventApplicationStatus(id, 'rejected', 'pending'),
    false,
    '낡은 기대 상태로는 쓰지 못해야 한다'
  )

  const { rows } = await listEventApplications({ eventSlug: 'evt-lock-2', page: 1, limit: 10 })
  assert.equal(rows[0].status, 'approved', 'A의 승인이 살아 있어야 한다')
})

test('없는 신청이면 false다 (삭제된 뒤 누른 경우)', async () => {
  const { updateEventApplicationStatus } = await loadFreshMiscModule()

  const missing = '00000000-0000-4000-8000-0000000000ff'
  assert.equal(await updateEventApplicationStatus(missing, 'approved', 'pending'), false)
})

test('expectedStatus를 생략하면 조건 없이 쓴다 (기존 호출부 호환)', async () => {
  const { createEventApplication, updateEventApplicationStatus } = await loadFreshMiscModule()

  const { id } = await createEventApplication(
    makeApplication({ event_slug: 'evt-lock-3', contact_phone: '010-1000-0003' })
  )

  assert.equal(await updateEventApplicationStatus(id, 'rejected'), true)
})
