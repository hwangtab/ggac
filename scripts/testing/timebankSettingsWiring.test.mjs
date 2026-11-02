import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 타임뱅크 설정 배선(계획 Task 5, 스펙 §9.1·§9.2)을 **마이그레이션을 적용한
 * 파일 DB**로 검증한다.
 *
 * - `features.timebank_features`의 기본값은 `TIMEBANK_DEFAULTS` 그대로다.
 * - `updateSystemSetting`의 `changeReason`이 `system_settings_history`에 남는다
 *   (이사회 의결 근거 — 전용 라우트가 넘긴다).
 * - 설정 초기화(`/api/admin/settings/reset`)는 타임뱅크 행을 건드리지 않는다
 *   (계획 결정 4: 초기화가 이사회 의결을 우회하지 않게 한다).
 * - 관리자 일반 설정 PUT은 타임뱅크 키를 받지 않는다(400).
 */

const DB_PATH = 'scripts/testing/.timebank-settings-wiring-test.db'

process.env.SETTINGS_CACHE_TTL_MS = '0'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

registerAliasResolveHook(import.meta.url)

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  // updated_by·changed_by는 profiles FK다 — 실제 관리자 행이 있어야 한다.
  const { upsertProfile } = await import('../../src/db/queries/profiles.ts')
  await upsertProfile({
    id: 'admin-1',
    email: 'admin-1@test.local',
    display_name: '설정관리자',
    registration_status: 'approved',
    is_active: true,
  })
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

beforeEach(async () => {
  await client.execute(`DELETE FROM system_settings_history`)
  await client.execute(`DELETE FROM system_settings`)
})

const { TIMEBANK_DEFAULTS, getTimebankSettings, isTimebankEnabled, isCoopTasksEnabled } =
  await import('../../src/lib/timebank/settings.ts')
const { getSystemSettings } = await import('../../src/utils/systemSettings.ts')
const { updateSystemSetting } = await import('../../src/db/queries/settings.ts')
const { SystemSettingsUpdateSchema, TIMEBANK_SETTINGS_READ_MAPPINGS } = await import(
  '../../src/lib/server/systemSettingsMapping.ts'
)

let rowSeq = 0
async function putSetting(category, settingKey, settingValue) {
  const id = `tb-wiring-${++rowSeq}`
  await client.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)`,
    args: [id, category, settingKey, JSON.stringify(settingValue), 1000, 1000],
  })
  return id
}

async function readRow(id) {
  const r = await client.execute({
    sql: 'SELECT setting_value, updated_at FROM system_settings WHERE id = ?',
    args: [id],
  })
  return r.rows[0]
}

async function historyFor(id) {
  const r = await client.execute({
    sql: 'SELECT change_reason, changed_by FROM system_settings_history WHERE setting_id = ?',
    args: [id],
  })
  return r.rows
}

function readSource(rel) {
  return readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
}

// ---------------------------------------------------------------- 기본값

test('설정 표를 읽지 못해 기본값으로 떨어지면 timebank_features는 TIMEBANK_DEFAULTS 그대로이고 꺼져 있다', async () => {
  // DB 클라이언트는 한 번 만들어 재사용하므로 URL을 바꿔도 소용없다 — 표를
  // 잠깐 치워 조회를 실패시킨다(getSystemSettings → getDefaultSettings).
  await client.execute('ALTER TABLE system_settings RENAME TO system_settings_tb_hidden')
  try {
    const settings = await getSystemSettings(true)
    assert.equal(settings.features.timebank_features.enabled, false)
    assert.deepEqual(settings.features.timebank_features, TIMEBANK_DEFAULTS)
  } finally {
    await client.execute('ALTER TABLE system_settings_tb_hidden RENAME TO system_settings')
  }
})

test('기본값은 TIMEBANK_DEFAULTS를 임포트한다 — systemSettings.ts에 수치를 다시 적지 않는다', () => {
  const src = readSource('src/utils/systemSettings.ts')
  assert.match(src, /TIMEBANK_DEFAULTS/)
  assert.doesNotMatch(src, /signup_grant_minutes:\s*\d/, '타임뱅크 수치가 중복으로 적혀 있다')
})

test('getTimebankSettings는 타입이 붙은 경로로 읽는다(Task 1의 임시 캐스트가 없다)', () => {
  const src = readSource('src/lib/timebank/settings.ts')
  assert.doesNotMatch(src, /timebank_features\?:\s*unknown/)
  assert.match(src, /features\?\.timebank_features/)
})

test('행이 없으면 타임뱅크는 꺼져 있다', async () => {
  assert.equal(await isTimebankEnabled(), false)
  assert.deepEqual(await getTimebankSettings(), TIMEBANK_DEFAULTS)
})

test('저장된 행을 정규화해 읽는다 — 조합 업무는 두 스위치가 다 켜져야 열린다', async () => {
  await putSetting('features', 'timebank_features', {
    enabled: true,
    coop_tasks_enabled: true,
    signup_grant_minutes: 60,
  })
  assert.equal(await isTimebankEnabled(), true)
  assert.equal(await isCoopTasksEnabled(), true)
  assert.equal((await getTimebankSettings()).signup_grant_minutes, 60)

  await client.execute(`DELETE FROM system_settings`)
  await putSetting('features', 'timebank_features', { enabled: 'true', coop_tasks_enabled: true })
  assert.equal(await isTimebankEnabled(), false, "문자열 'true'는 켜짐이 아니다(fail-closed)")
  assert.equal(await isCoopTasksEnabled(), false)
})

// ---------------------------------------------------------------- 변경 사유

test('updateSystemSetting의 changeReason이 history 행에 그대로 남는다', async () => {
  const id = await putSetting('features', 'timebank_features', { ...TIMEBANK_DEFAULTS })
  await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, enabled: true },
    actorId: 'admin-1',
    changeReason: '2026-11-20 이사회 3호',
  })
  const rows = await historyFor(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].change_reason, '2026-11-20 이사회 3호')
  assert.equal(rows[0].changed_by, 'admin-1')
})

test('changeReason이 없으면 history의 change_reason은 null이다(기존 호출부 그대로)', async () => {
  const id = await putSetting('site', 'site_title', { value: 'a' })
  await updateSystemSetting({
    category: 'site',
    settingKey: 'site_title',
    settingValue: { value: 'b' },
    actorId: 'admin-1',
  })
  const rows = await historyFor(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].change_reason, null)
})

// ---------------------------------------------------------------- 동시 수정(lost update)

test('expectedUpdatedAt이 지금 행과 같으면 쓰고, 다르면 stale로 쓰지도 이력을 남기지도 않는다', async () => {
  const { getSystemSettingRow } = await import('../../src/db/queries/settings.ts')
  const id = await putSetting('features', 'timebank_features', { ...TIMEBANK_DEFAULTS })
  // 두 관리자가 같은 행을 읽었다
  const seenByA = await getSystemSettingRow('features', 'timebank_features')
  const seenByB = await getSystemSettingRow('features', 'timebank_features')

  const a = await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, signup_grant_minutes: 60 },
    actorId: 'admin-1',
    changeReason: '2026-11-20 이사회 3호',
    expectedUpdatedAt: seenByA.updated_at,
  })
  assert.equal(a.outcome, 'updated')

  const b = await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, enabled: true },
    actorId: 'admin-1',
    changeReason: '2026-11-20 이사회 4호',
    expectedUpdatedAt: seenByB.updated_at,
  })
  assert.equal(b.outcome, 'stale', '먼저 쓴 값을 덮어쓰면 안 된다')

  const row = await readRow(id)
  assert.equal(JSON.parse(row.setting_value).signup_grant_minutes, 60)
  assert.equal(JSON.parse(row.setting_value).enabled, false)
  const history = await historyFor(id)
  assert.equal(history.length, 1, 'stale 시도는 이력을 남기지 않는다')
  assert.equal(history[0].change_reason, '2026-11-20 이사회 3호')

  // 새로 읽은 값으로 다시 하면 된다
  const fresh = await getSystemSettingRow('features', 'timebank_features')
  const c = await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, signup_grant_minutes: 60, enabled: true },
    actorId: 'admin-1',
    changeReason: '2026-11-20 이사회 4호',
    expectedUpdatedAt: fresh.updated_at,
  })
  assert.equal(c.outcome, 'updated')
  assert.equal((await historyFor(id)).length, 2)
})

test('같은 밀리초 안의 연속 쓰기도 updated_at이 앞으로 간다(가드가 같은 값을 두 번 보지 않는다)', async () => {
  const { getSystemSettingRow } = await import('../../src/db/queries/settings.ts')
  await putSetting('features', 'timebank_features', { ...TIMEBANK_DEFAULTS })
  // 미래 시각으로 박아 둔 행 — Date.now()가 그보다 작아도 updated_at은 줄지 않는다
  const future = Date.now() + 60_000
  await client.execute({
    sql: "UPDATE system_settings SET updated_at = ? WHERE setting_key = 'timebank_features'",
    args: [future],
  })
  const before1 = await getSystemSettingRow('features', 'timebank_features')
  await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, signup_grant_minutes: 60 },
    actorId: 'admin-1',
    expectedUpdatedAt: before1.updated_at,
  })
  const after1 = await getSystemSettingRow('features', 'timebank_features')
  assert.ok(Date.parse(after1.updated_at) > Date.parse(before1.updated_at))
})

test('expectedUpdatedAt이 없으면 예전처럼 무조건 쓴다(다른 호출부 그대로)', async () => {
  await putSetting('site', 'site_title', { value: 'a' })
  const r = await updateSystemSetting({
    category: 'site',
    settingKey: 'site_title',
    settingValue: { value: 'b' },
    actorId: 'admin-1',
  })
  assert.equal(r.outcome, 'updated')
})

test('타임뱅크 설정 PUT은 읽은 updated_at으로 조건부로 쓰고 stale이면 409다', () => {
  const src = readSource('src/app/api/admin/timebank/settings/route.ts')
  assert.match(src, /expectedUpdatedAt:\s*row\.updated_at/)
  assert.match(src, /outcome === 'stale'/)
  assert.match(src, /다른 관리자가 먼저 설정을 바꿨습니다\. 새로고침 후 다시 시도해 주세요\./)
})

test('listSystemSettingHistory: 그 키의 이력만 최근 것부터, 사유·변경자 이름과 함께', async () => {
  const { listSystemSettingHistory } = await import('../../src/db/queries/settings.ts')
  await putSetting('features', 'timebank_features', { ...TIMEBANK_DEFAULTS })
  await putSetting('site', 'site_title', { value: 'a' })
  await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, enabled: true },
    actorId: 'admin-1',
    changeReason: '2026-11-20 이사회 3호',
  })
  await updateSystemSetting({
    category: 'site',
    settingKey: 'site_title',
    settingValue: { value: 'b' },
    actorId: 'admin-1',
  })
  await new Promise(r => setTimeout(r, 5))
  await updateSystemSetting({
    category: 'features',
    settingKey: 'timebank_features',
    settingValue: { ...TIMEBANK_DEFAULTS, enabled: false },
    actorId: 'admin-1',
    changeReason: '2026-12-18 이사회 1호',
  })
  const rows = await listSystemSettingHistory('timebank_features', 10)
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map(r => r.change_reason),
    ['2026-12-18 이사회 1호', '2026-11-20 이사회 3호']
  )
  assert.equal(rows[0].changed_by, 'admin-1')
  assert.equal(rows[0].changed_by_name, '설정관리자')
  assert.equal(rows[0].old_value.enabled, true)
  assert.equal(rows[0].new_value.enabled, false)
  assert.match(rows[0].changed_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal((await listSystemSettingHistory('timebank_features', 1)).length, 1)
})

// ---------------------------------------------------------------- 초기화 (결정 4)

function resetDefaultsBlock() {
  const src = readSource('src/app/api/admin/settings/reset/route.ts')
  const start = src.indexOf('const DEFAULT_SETTINGS = [')
  const end = src.indexOf('export const POST')
  assert.ok(start > 0 && end > start, 'reset 라우트에서 DEFAULT_SETTINGS를 찾지 못했다')
  return src.slice(start, end)
}

test('설정 초기화 목록(DEFAULT_SETTINGS)에 타임뱅크 행이 없다', () => {
  assert.doesNotMatch(resetDefaultsBlock(), /timebank/)
})

test('초기화 목록 전부를 덮어써도 켜 둔 타임뱅크 행은 그대로다', async () => {
  const block = resetDefaultsBlock()
  const entries = [...block.matchAll(/category:\s*'(\w+)',\s*setting_key:\s*'(\w+)'/g)].map(m => ({
    category: m[1],
    settingKey: m[2],
  }))
  assert.ok(entries.length >= 10, `초기화 항목을 너무 적게 읽었다(${entries.length})`)

  const enabled = { ...TIMEBANK_DEFAULTS, enabled: true, coop_tasks_enabled: true }
  const timebankId = await putSetting('features', 'timebank_features', enabled)
  for (const e of entries) await putSetting(e.category, e.settingKey, { before: true })

  // reset 라우트의 루프와 같다: 목록에 있는 행만 updateSystemSetting으로 덮는다.
  for (const e of entries) {
    await updateSystemSetting({
      category: e.category,
      settingKey: e.settingKey,
      settingValue: { reset: true },
      actorId: 'admin-1',
    })
  }

  const row = await readRow(timebankId)
  assert.deepEqual(JSON.parse(row.setting_value), enabled)
  assert.equal(Number(row.updated_at), 1000)
  assert.equal((await historyFor(timebankId)).length, 0)
  assert.equal(await isTimebankEnabled(), true)
})

// ---------------------------------------------------------------- 일반 설정 PUT

test('일반 설정 PUT 스키마는 타임뱅크 키를 받지 않는다', () => {
  for (const body of [
    { features: { timebank_enabled: true } },
    { features: { timebank_coop_tasks_enabled: true } },
    { features: { timebank_features: { enabled: true } } },
    { timebank: { enabled: true } },
    { timebank_features: { enabled: true } },
  ]) {
    assert.equal(
      SystemSettingsUpdateSchema.safeParse(body).success,
      false,
      `${JSON.stringify(body)}가 통과했다`
    )
  }
  // 대조: 원래 받던 키는 그대로 받는다.
  assert.equal(
    SystemSettingsUpdateSchema.safeParse({ features: { funding_enabled: true } }).success,
    true
  )
  assert.equal(SystemSettingsUpdateSchema.safeParse({ site: { site_title: 'x' } }).success, true)
})

test('관리자 일반 라우트는 매핑 모듈의 스키마를 쓴다', () => {
  const src = readSource('src/app/api/admin/settings/route.ts')
  assert.match(src, /SystemSettingsUpdateSchema\.safeParse\(body\)/)
  assert.doesNotMatch(src, /const SystemSettingsUpdateSchema\s*=/, '라우트에 사본 스키마가 있다')
})

test('읽기 매핑은 스위치를 === true로만 켜짐으로 읽는다(fail-closed)', () => {
  const m = TIMEBANK_SETTINGS_READ_MAPPINGS
  assert.equal(m.timebank_enabled.key, 'timebank_features')
  assert.equal(m.timebank_enabled.transform(undefined), false)
  assert.equal(m.timebank_enabled.transform({ enabled: 'true' }), false)
  assert.equal(m.timebank_enabled.transform({ enabled: true }), true)
  assert.equal(m.timebank_coop_tasks_enabled.transform({ coop_tasks_enabled: true }), true)
  assert.equal(m.timebank_coop_tasks_enabled.transform({ coop_tasks_enabled: 1 }), false)
})

test('읽기 매핑은 일반 PUT 매핑표(SETTING_MAPPINGS)에 들어가지 않는다', async () => {
  const { SETTING_MAPPINGS } = await import('../../src/lib/server/systemSettingsMapping.ts')
  for (const group of Object.values(SETTING_MAPPINGS)) {
    for (const mapping of Object.values(group)) {
      assert.notEqual(mapping.key, 'timebank_features')
    }
  }
})

// ---------------------------------------------------------------- 시드 스크립트

test('시드 스크립트: 값은 TIMEBANK_DEFAULTS와 같고, 멱등이며, 이미 있는 행(켜진 것 포함)을 건드리지 않는다', async () => {
  const { SETTING_VALUE, seedTimebankSettings } = await import(
    '../turso/seed-timebank-settings.mjs'
  )
  assert.deepEqual(SETTING_VALUE, TIMEBANK_DEFAULTS)
  assert.equal(SETTING_VALUE.enabled, false)

  const first = await seedTimebankSettings(client)
  assert.equal(first.inserted, true)
  const second = await seedTimebankSettings(client)
  assert.equal(second.inserted, false)
  const r = await client.execute(
    `SELECT setting_value FROM system_settings WHERE category = 'features' AND setting_key = 'timebank_features'`
  )
  assert.equal(r.rows.length, 1)
  assert.deepEqual(JSON.parse(r.rows[0].setting_value), TIMEBANK_DEFAULTS)

  await client.execute(`DELETE FROM system_settings`)
  const enabledId = await putSetting('features', 'timebank_features', {
    ...TIMEBANK_DEFAULTS,
    enabled: true,
  })
  const third = await seedTimebankSettings(client)
  assert.equal(third.inserted, false)
  assert.equal(JSON.parse((await readRow(enabledId)).setting_value).enabled, true)
})
