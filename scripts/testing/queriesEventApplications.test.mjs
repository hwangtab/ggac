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
