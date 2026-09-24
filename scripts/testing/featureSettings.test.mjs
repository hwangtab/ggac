import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 기능 스위치 넷(`src/lib/features/settings.ts`)을 **실제 SQLite 파일 DB**로
 * 검증한다. 소스에 헬퍼 이름이 있는지 세는 검사는 여기서 아무 쓸모가 없다 —
 * 알고 싶은 것은 "저장된 값이 판정을 실제로 바꾸는가"다.
 *
 * 라우트가 그 판정에 실제로 걸리는지는 `e2e/authz-features.spec.ts`가
 * 돌아가는 서버에 요청을 보내 확인한다. 이 파일은 판정 자체를 맡는다.
 *
 * `SETTINGS_CACHE_TTL_MS=0`: `@/utils/systemSettings`의 캐시는 기본 5분이라,
 * 끄고 바로 다시 물으면 이전 답이 돌아온다. E2E webServer도 같은 이유로 같은
 * 값을 쓴다.
 */

const DB_PATH = 'scripts/testing/.feature-settings-test.db'

process.env.SETTINGS_CACHE_TTL_MS = '0'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

registerAliasResolveHook(import.meta.url)

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

beforeEach(async () => {
  await client.execute(`DELETE FROM system_settings WHERE category = 'features'`)
})

const {
  isBoardEnabled,
  isCommentsEnabled,
  isArtistRegistrationEnabled,
  isFileUploadEnabled,
  FEATURE_DISABLED_MESSAGES,
} = await import('../../src/lib/features/settings.ts')

let rowSeq = 0
async function putFeature(settingKey, settingValue) {
  await client.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'features', ?, ?, 0, ?, ?)`,
    args: [
      `feature-test-${++rowSeq}`,
      settingKey,
      JSON.stringify(settingValue),
      Date.now(),
      Date.now(),
    ],
  })
}

// ---------------------------------------------------------------- 오늘의 동작

test('운영과 같은 상태 — 넷 다 true로 저장돼 있으면 넷 다 켜짐', async () => {
  await putFeature('board_features', { enabled: true })
  await putFeature('comment_features', { enabled: true })
  await putFeature('artist_features', { registration_enabled: true })
  await putFeature('file_upload', { enabled: true })

  assert.equal(await isBoardEnabled(), true)
  assert.equal(await isCommentsEnabled(), true)
  assert.equal(await isArtistRegistrationEnabled(), true)
  assert.equal(await isFileUploadEnabled(), true)
})

// ---------------------------------------------------------------- 끄면 꺼진다

test('저장된 값이 false면 꺼짐으로 읽는다', async () => {
  await putFeature('board_features', { enabled: false })
  await putFeature('comment_features', { enabled: false })
  await putFeature('artist_features', { registration_enabled: false })
  await putFeature('file_upload', { enabled: false })

  assert.equal(await isBoardEnabled(), false)
  assert.equal(await isCommentsEnabled(), false)
  assert.equal(await isArtistRegistrationEnabled(), false)
  assert.equal(await isFileUploadEnabled(), false)
})

test('스위치는 서로 독립이다 — 게시판만 꺼도 나머지는 켜져 있다', async () => {
  await putFeature('board_features', { enabled: false })
  await putFeature('comment_features', { enabled: true })
  await putFeature('artist_features', { registration_enabled: true })
  await putFeature('file_upload', { enabled: true })

  assert.equal(await isBoardEnabled(), false)
  assert.equal(await isCommentsEnabled(), true)
  assert.equal(await isArtistRegistrationEnabled(), true)
  assert.equal(await isFileUploadEnabled(), true)
})

test('아티스트는 `enabled`가 아니라 `registration_enabled`를 본다', async () => {
  // 이 행만 키 이름이 다르다. `enabled: false`를 넣어도 등록은 켜져 있어야
  // 한다 — 엉뚱한 칸을 읽으면 이 단정이 깨진다.
  await putFeature('artist_features', { enabled: false, registration_enabled: true })
  assert.equal(await isArtistRegistrationEnabled(), true)
})

// ---------------------------------------------------------------- 모르면 켜짐

test('행이 아예 없으면 넷 다 켜짐(fail-open)', async () => {
  assert.equal(await isBoardEnabled(), true)
  assert.equal(await isCommentsEnabled(), true)
  assert.equal(await isArtistRegistrationEnabled(), true)
  assert.equal(await isFileUploadEnabled(), true)
})

test('값이 깨져 있어도 켜짐 — 끄는 것은 명시적인 false뿐이다', async () => {
  await putFeature('board_features', { enabled: 'no' })
  await putFeature('comment_features', {})
  await putFeature('artist_features', { registration_enabled: 0 })
  await putFeature('file_upload', { enabled: null })

  assert.equal(await isBoardEnabled(), true)
  assert.equal(await isCommentsEnabled(), true)
  assert.equal(await isArtistRegistrationEnabled(), true)
  assert.equal(await isFileUploadEnabled(), true)
})

test('DB에 닿지 못해도 켜짐 — Turso 순단이 조합의 게시판을 닫지 않는다', async () => {
  await putFeature('board_features', { enabled: true })
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-flags/broken.db'
  try {
    assert.equal(await isBoardEnabled(), true)
    assert.equal(await isCommentsEnabled(), true)
    assert.equal(await isArtistRegistrationEnabled(), true)
    assert.equal(await isFileUploadEnabled(), true)
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 거절 문구

test('거절 문구는 무슨 일인지와 누구에게 물어야 하는지를 함께 말한다', () => {
  for (const message of Object.values(FEATURE_DISABLED_MESSAGES)) {
    assert.match(message, /contact@ggac\.kr/)
    assert.match(message, /꺼져 있습니다/)
  }
})
