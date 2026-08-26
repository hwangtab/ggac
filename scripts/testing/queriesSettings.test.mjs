import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/settings.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesActivities.test.mjs`(단계 4 Task 3)와 동일.
 *
 * 이 모듈은 `get_user_settings` RPC 대체와 `system_settings`의 트리거 2종
 * (update_system_settings_updated_at, log_system_settings_change) 재현을
 * 담당한다 — 둘 다 부정 대조가 필요하다(task-4-brief.md Step 4).
 */

const DB_PATH = 'scripts/testing/.queries-settings-test.db'
const SETTINGS_MODULE_URL = new URL('../../src/db/queries/settings.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshSettingsModule() {
  return import(`${SETTINGS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: updateSystemSetting이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { updateSystemSetting } = await loadFreshSettingsModule()
    await assert.rejects(() =>
      updateSystemSetting({
        category: 'site',
        settingKey: 'site_title',
        settingValue: { value: 'x' },
        actorId: 'any-user',
      })
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `settings-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '설정테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function insertSystemSetting({ category, settingKey, settingValue, isSensitive = false }) {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      category,
      settingKey,
      JSON.stringify(settingValue),
      isSensitive ? 1 : 0,
      Date.now(),
      Date.now(),
    ],
  })
  return id
}

async function insertDefaultSetting({ category, settingKey, defaultValue, description = null }) {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `INSERT INTO default_settings (id, category, setting_key, default_value, description, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, category, settingKey, JSON.stringify(defaultValue), description, Date.now()],
  })
  return id
}

async function countHistoryRows(settingId) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM system_settings_history WHERE setting_id = ?',
    args: [settingId],
  })
  return Number(result.rows[0].c)
}

// -------------------------------------------------------------- get_user_settings RPC 대체

test('getUserSettings: default_settings만 있고 user_settings 오버라이드가 없으면 is_default=true, 기본값을 돌려준다', async () => {
  const userId = await seedProfile()
  await insertDefaultSetting({
    category: 'interface',
    settingKey: 'theme',
    defaultValue: { mode: 'light' },
    description: '테마 설정',
  })

  const { getUserSettings } = await loadFreshSettingsModule()
  const rows = await getUserSettings(userId)
  const themeRow = rows.find(r => r.category === 'interface' && r.setting_key === 'theme')
  assert.ok(themeRow, 'theme 설정 행이 있어야 한다')
  assert.equal(themeRow.is_default, true)
  assert.deepEqual(themeRow.setting_value, { mode: 'light' })
  assert.equal(themeRow.description, '테마 설정')
})

test('getUserSettings: user_settings 오버라이드가 있으면 is_default=false, 오버라이드 값을 돌려준다(다른 사용자 값은 섞이지 않는다)', async () => {
  const userA = await seedProfile()
  const userB = await seedProfile()
  await insertDefaultSetting({
    category: 'notification',
    settingKey: 'email_notifications',
    defaultValue: { enabled: true },
  })

  const { getUserSettings, upsertUserSetting } = await loadFreshSettingsModule()
  await upsertUserSetting({
    userId: userA,
    category: 'notification',
    settingKey: 'email_notifications',
    settingValue: { enabled: false },
  })

  const rowsA = await getUserSettings(userA)
  const overrideRow = rowsA.find(
    r => r.category === 'notification' && r.setting_key === 'email_notifications'
  )
  assert.equal(overrideRow.is_default, false)
  assert.deepEqual(overrideRow.setting_value, { enabled: false })

  // 부정 대조: userB는 오버라이드를 넣지 않았으므로 여전히 기본값이어야 한다
  // (스코프 필터가 빠지면 userA의 오버라이드가 userB에게도 보인다).
  const rowsB = await getUserSettings(userB)
  const defaultRow = rowsB.find(
    r => r.category === 'notification' && r.setting_key === 'email_notifications'
  )
  assert.equal(defaultRow.is_default, true)
  assert.deepEqual(defaultRow.setting_value, { enabled: true })
})

test('getUserSettings: category, setting_key 오름차순으로 정렬된다', async () => {
  const userId = await seedProfile()
  await insertDefaultSetting({ category: 'security', settingKey: 'two_factor', defaultValue: {} })
  await insertDefaultSetting({ category: 'preference', settingKey: 'auto_save', defaultValue: {} })

  const { getUserSettings } = await loadFreshSettingsModule()
  const rows = await getUserSettings(userId)
  const categories = rows.map(r => r.category)
  const sorted = [...categories].sort()
  assert.deepEqual(categories, sorted)
})

test('upsertUserSetting: 같은 (user, category, key)로 두 번 호출하면 갱신된다(행이 늘지 않는다)', async () => {
  const userId = await seedProfile()
  await insertDefaultSetting({
    category: 'privacy',
    settingKey: 'profile_visibility',
    defaultValue: {},
  })

  const { upsertUserSetting } = await loadFreshSettingsModule()
  const id1 = await upsertUserSetting({
    userId,
    category: 'privacy',
    settingKey: 'profile_visibility',
    settingValue: { level: 'members' },
  })
  const id2 = await upsertUserSetting({
    userId,
    category: 'privacy',
    settingKey: 'profile_visibility',
    settingValue: { level: 'private' },
  })
  assert.equal(id1, id2)

  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM user_settings WHERE user_id = ? AND category = ? AND setting_key = ?',
    args: [userId, 'privacy', 'profile_visibility'],
  })
  assert.equal(Number(result.rows[0].c), 1)
})

test('resetUserSettings: userId로만 스코프된다 — 다른 사용자의 설정은 지우지 않는다', async () => {
  const userA = await seedProfile()
  const userB = await seedProfile()
  await insertDefaultSetting({
    category: 'preference',
    settingKey: 'content_filter',
    defaultValue: {},
  })

  const { upsertUserSetting, resetUserSettings } = await loadFreshSettingsModule()
  await upsertUserSetting({
    userId: userA,
    category: 'preference',
    settingKey: 'content_filter',
    settingValue: { x: 1 },
  })
  await upsertUserSetting({
    userId: userB,
    category: 'preference',
    settingKey: 'content_filter',
    settingValue: { x: 2 },
  })

  const deleted = await resetUserSettings({ userId: userA })
  assert.equal(deleted.length, 1)

  const remaining = await setupClient.execute({
    sql: 'SELECT user_id FROM user_settings WHERE category = ? AND setting_key = ?',
    args: ['preference', 'content_filter'],
  })
  assert.equal(remaining.rows.length, 1)
  assert.equal(remaining.rows[0].user_id, userB)
})

// -------------------------------------------------------------- system_settings 트리거 재현

test('updateSystemSetting: setting_value/updated_at/updated_by를 갱신한다(BEFORE UPDATE 트리거 재현)', async () => {
  const actorId = await seedProfile()
  const settingId = await insertSystemSetting({
    category: 'site',
    settingKey: 'site_title',
    settingValue: { value: '원본' },
  })

  const { updateSystemSetting } = await loadFreshSettingsModule()
  const before1 = Date.now()
  await updateSystemSetting({
    category: 'site',
    settingKey: 'site_title',
    settingValue: { value: '수정됨' },
    actorId,
  })

  const row = await setupClient.execute({
    sql: 'SELECT setting_value, updated_at, updated_by FROM system_settings WHERE id = ?',
    args: [settingId],
  })
  assert.deepEqual(JSON.parse(row.rows[0].setting_value), { value: '수정됨' })
  assert.equal(row.rows[0].updated_by, actorId)
  assert.ok(Number(row.rows[0].updated_at) >= before1)
})

test('updateSystemSetting: updated_by는 트리거가 auth.uid()로 덮어쓰지 않고 앱이 명시한 actorId 그대로 남는다', async () => {
  // 이 테스트가 바로 20260824040000 교정판(COALESCE(NEW.updated_by,
  // auth.uid()))의 재현을 검증한다 — actorId가 항상 명시되므로 COALESCE의
  // "이미 값이 있다" 분기만 살아남는다.
  const actorId = await seedProfile()
  const otherActor = await seedProfile()
  const settingId = await insertSystemSetting({
    category: 'security',
    settingKey: 'session_config',
    settingValue: { timeout_minutes: 60 },
  })

  const { updateSystemSetting } = await loadFreshSettingsModule()
  await updateSystemSetting({
    category: 'security',
    settingKey: 'session_config',
    settingValue: { timeout_minutes: 120 },
    actorId,
  })
  await updateSystemSetting({
    category: 'security',
    settingKey: 'session_config',
    settingValue: { timeout_minutes: 240 },
    actorId: otherActor,
  })

  const row = await setupClient.execute({
    sql: 'SELECT updated_by FROM system_settings WHERE id = ?',
    args: [settingId],
  })
  assert.equal(row.rows[0].updated_by, otherActor)
})

/**
 * 삭제된 `scripts/testing/systemSettingsWrite.test.mjs`의 4번째 케이스
 * ("category와 setting_key로 대상을 정확히 좁힌다 — 같은 카테고리의 다른
 * 키까지 건드리지 않는다")를 새 구현에 맞춰 되살린다(단계 4 리뷰 1회차
 * Important 6). 옛 파일은 stub 호출을 세는 방식이었지만 여기서는 실제
 * SQLite에 형제 키를 심어 **값이 안 변했음**을 직접 본다.
 *
 * 스코프가 category 하나로 넓어지면 관리자가 한 설정을 저장할 때마다 같은
 * 카테고리의 나머지 설정이 통째로 덮어써진다 — 이 파일 자체가 그
 * "관리자 설정 저장 불가" 운영 회귀를 고치려고 만든 것이다.
 */
test('updateSystemSetting: 같은 카테고리의 형제 키는 값·updated_at·updated_by·이력 전부 불변이다', async () => {
  const actorId = await seedProfile()
  const targetId = await insertSystemSetting({
    category: 'features',
    settingKey: 'target_key',
    settingValue: { value: '대상-원본' },
  })
  const siblingId = await insertSystemSetting({
    category: 'features',
    settingKey: 'sibling_key',
    settingValue: { value: '형제-원본' },
  })

  const siblingBefore = await setupClient.execute({
    sql: 'SELECT setting_value, updated_at, updated_by FROM system_settings WHERE id = ?',
    args: [siblingId],
  })

  const { updateSystemSetting } = await loadFreshSettingsModule()
  await updateSystemSetting({
    category: 'features',
    settingKey: 'target_key',
    settingValue: { value: '대상-수정됨' },
    actorId,
  })

  const target = await setupClient.execute({
    sql: 'SELECT setting_value FROM system_settings WHERE id = ?',
    args: [targetId],
  })
  assert.deepEqual(JSON.parse(target.rows[0].setting_value), { value: '대상-수정됨' })

  const siblingAfter = await setupClient.execute({
    sql: 'SELECT setting_value, updated_at, updated_by FROM system_settings WHERE id = ?',
    args: [siblingId],
  })
  assert.deepEqual(
    JSON.parse(siblingAfter.rows[0].setting_value),
    { value: '형제-원본' },
    '같은 카테고리의 다른 키 값이 덮어써지면 안 된다'
  )
  assert.equal(
    siblingAfter.rows[0].updated_at,
    siblingBefore.rows[0].updated_at,
    '형제 키의 updated_at도 건드리면 안 된다'
  )
  assert.equal(
    siblingAfter.rows[0].updated_by,
    siblingBefore.rows[0].updated_by,
    '형제 키의 updated_by도 건드리면 안 된다'
  )
  assert.equal(
    await countHistoryRows(siblingId),
    0,
    '건드리지 않은 설정에 변경 이력이 생기면 이력 자체가 거짓이 된다'
  )
  assert.equal(await countHistoryRows(targetId), 1)
})

test('updateSystemSetting: 존재하지 않는 category/settingKey면 SettingNotFoundError를 던진다(UPSERT가 아니다)', async () => {
  const actorId = await seedProfile()
  const { updateSystemSetting, SettingNotFoundError } = await loadFreshSettingsModule()
  await assert.rejects(
    () =>
      updateSystemSetting({
        category: 'features',
        settingKey: 'does_not_exist',
        settingValue: {},
        actorId,
      }),
    SettingNotFoundError
  )

  const rows = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM system_settings WHERE category = ? AND setting_key = ?',
    args: ['features', 'does_not_exist'],
  })
  assert.equal(Number(rows.rows[0].c), 0, '존재하지 않는 설정을 새로 만들면 안 된다(UPDATE 전용)')
})

test('updateSystemSetting: system_settings_history에 old_value/new_value/changed_by를 기록한다(AFTER UPDATE 트리거 재현) — 유일한 변경 이력', async () => {
  const actorId = await seedProfile()
  const settingId = await insertSystemSetting({
    category: 'email',
    settingKey: 'smtp_config',
    settingValue: { host: 'old.example.com' },
  })

  const { updateSystemSetting } = await loadFreshSettingsModule()
  await updateSystemSetting({
    category: 'email',
    settingKey: 'smtp_config',
    settingValue: { host: 'new.example.com' },
    actorId,
  })

  const history = await setupClient.execute({
    sql: 'SELECT old_value, new_value, changed_by, category, setting_key FROM system_settings_history WHERE setting_id = ?',
    args: [settingId],
  })
  assert.equal(history.rows.length, 1, '변경 1회당 이력 1건이어야 한다')
  assert.deepEqual(JSON.parse(history.rows[0].old_value), { host: 'old.example.com' })
  assert.deepEqual(JSON.parse(history.rows[0].new_value), { host: 'new.example.com' })
  assert.equal(history.rows[0].changed_by, actorId)
  assert.equal(history.rows[0].category, 'email')
  assert.equal(history.rows[0].setting_key, 'smtp_config')
})

test('부정 대조: 히스토리 기록이 없으면 "누가 언제 바꿨는지" 알 수 없다는 것을 이 테스트가 스스로 증명한다(카운트가 0이면 실패)', async () => {
  const actorId = await seedProfile()
  const settingId = await insertSystemSetting({
    category: 'features',
    settingKey: 'board_features',
    settingValue: { enabled: true },
  })
  assert.equal(await countHistoryRows(settingId), 0, '변경 전에는 이력이 없어야 한다')

  const { updateSystemSetting } = await loadFreshSettingsModule()
  await updateSystemSetting({
    category: 'features',
    settingKey: 'board_features',
    settingValue: { enabled: false },
    actorId,
  })

  const count = await countHistoryRows(settingId)
  assert.ok(count > 0, '변경 후에는 이력이 1건 이상 있어야 한다 — 0이면 로그가 유실된 것')
})

test('updateSystemSetting: 연속 2회 변경하면 이력도 2건 쌓인다(누적, 덮어쓰지 않는다)', async () => {
  const actorId = await seedProfile()
  const settingId = await insertSystemSetting({
    category: 'site',
    settingKey: 'max_members',
    settingValue: { value: 100 },
  })

  const { updateSystemSetting } = await loadFreshSettingsModule()
  await updateSystemSetting({
    category: 'site',
    settingKey: 'max_members',
    settingValue: { value: 200 },
    actorId,
  })
  await updateSystemSetting({
    category: 'site',
    settingKey: 'max_members',
    settingValue: { value: 300 },
    actorId,
  })

  assert.equal(await countHistoryRows(settingId), 2)
})

// -------------------------------------------------------------- listSystemSettings / 마스킹

test('listSystemSettings(includeSensitive=false): is_sensitive=true 행은 마스킹되고, 아닌 행은 그대로다', async () => {
  await insertSystemSetting({
    category: 'email',
    settingKey: 'smtp_config_2',
    settingValue: { password: 'secret' },
    isSensitive: true,
  })
  await insertSystemSetting({
    category: 'site',
    settingKey: 'site_title_2',
    settingValue: { value: '공개값' },
    isSensitive: false,
  })

  const { listSystemSettings } = await loadFreshSettingsModule()
  const rows = await listSystemSettings(false)
  const sensitiveRow = rows.find(r => r.setting_key === 'smtp_config_2')
  const publicRow = rows.find(r => r.setting_key === 'site_title_2')
  assert.deepEqual(sensitiveRow.setting_value, {
    masked: true,
    description: '민감한 정보는 관리자만 조회할 수 있습니다',
  })
  assert.deepEqual(publicRow.setting_value, { value: '공개값' })
})

test('listSystemSettings(includeSensitive=true): is_sensitive=true 행도 실제 값을 그대로 돌려준다', async () => {
  await insertSystemSetting({
    category: 'email',
    settingKey: 'smtp_config_3',
    settingValue: { password: 'secret3' },
    isSensitive: true,
  })

  const { listSystemSettings } = await loadFreshSettingsModule()
  const rows = await listSystemSettings(true)
  const sensitiveRow = rows.find(r => r.setting_key === 'smtp_config_3')
  assert.deepEqual(sensitiveRow.setting_value, { password: 'secret3' })
})

// -------------------------------------------------------------- 소스 가드

test('updateSystemSetting은 db.transaction()으로 읽기-후-쓰기를 원자적으로 묶는다(소스 가드)', () => {
  const src = readFileSync('src/db/queries/settings.ts', 'utf8')
  const match = src.match(/export async function updateSystemSetting\([\s\S]*?\n\}\n/)
  assert.ok(match, 'updateSystemSetting 함수 본문을 찾지 못했다')
  assert.match(match[0], /db\.transaction\(async tx =>/)
  assert.match(match[0], /tx\.insert\(systemSettingsHistory\)/)
})
