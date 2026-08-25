import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * 구조를 고정한다. 미들웨어의 유지보수 모드/가입 허용 판정이 다시
 * Supabase(service-role REST)로 돌아가면, 관리자가 이제 Turso에만 쓰는
 * 설정 변경이 미들웨어에 영원히 반영되지 않는다(회귀 — 조정자 지적 사항).
 *
 * 단계 4: `system_settings`의 권위는 Turso다. `src/middleware/settings.ts`는
 * 이제 `src/db/queries/settings.ts`의 `listSystemSettings`를 그대로
 * 통과시킨다(`scripts/testing/middleware-profile.test.mjs`와 같은 패턴).
 */

test('미들웨어 설정 모듈이 listSystemSettings를 쓴다', () => {
  const src = readFileSync('src/middleware/settings.ts', 'utf8')
  assert.match(src, /listSystemSettings/)
})

test('미들웨어 설정 모듈은 Supabase(service-role REST)를 더 이상 쓰지 않는다', () => {
  const src = readFileSync('src/middleware/settings.ts', 'utf8')
  assert.doesNotMatch(src, /supabase-rest|fetchSystemSettingsRows|SUPABASE_SERVICE_ROLE_KEY/)
})

test('middleware.ts가 system_settings를 직접 조회하지 않는다(getSystemSettings 경유)', () => {
  const src = readFileSync('src/middleware.ts', 'utf8')
  assert.doesNotMatch(src, /from\(['"]system_settings['"]\)/)
  assert.match(src, /getSystemSettings/)
})

// ---------------------------------------------------------------- 실제 SQLite: 값 반영

const DB_PATH = 'scripts/testing/.middleware-settings-test.db'
const SETTINGS_MODULE_URL = new URL('../../src/middleware/settings.ts', import.meta.url)
const SETTINGS_QUERY_MODULE_URL = new URL('../../src/db/queries/settings.ts', import.meta.url)

async function loadFreshSettingsModule() {
  // 매 테스트마다 새로 로드해서 모듈 캐시(settingsCache 등)나 이전 env 값이
  // 섞이지 않게 한다.
  return import(`${SETTINGS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await setupClient.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('부정 대조 근거: 깨진 DB 경로로 실제 조회를 시도하면 null을 반환한다(fail-open, 던지지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getSystemSettings } = await loadFreshSettingsModule()
    const result = await getSystemSettings()
    assert.equal(
      result,
      null,
      'DB 조회가 실패하면 null이어야 한다 — 유지보수 모드는 "꺼짐"으로 안전하게 fail-open한다'
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

async function insertSiteSetting(settingKey, settingValue) {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'site', ?, ?, 0, ?, ?)`,
    args: [id, settingKey, JSON.stringify(settingValue), Date.now(), Date.now()],
  })
}

test('Turso에 쓴 maintenance_mode/registration_enabled 값을 미들웨어 경로가 그대로 읽는다', async () => {
  await insertSiteSetting('maintenance_mode', { enabled: true, message: '점검 중입니다' })
  await insertSiteSetting('registration_enabled', { enabled: false })

  const { getSystemSettings } = await loadFreshSettingsModule()
  const result = await getSystemSettings()
  assert.equal(result.maintenanceMode, true)
  assert.equal(result.maintenanceMessage, '점검 중입니다')
  assert.equal(result.registrationEnabled, false)
})

test('행이 없으면(기본 시드가 없는 빈 DB) 기본값(유지보수 꺼짐, 가입 허용)을 돌려준다', async () => {
  const { getSystemSettings } = await loadFreshSettingsModule()
  const result = await getSystemSettings(undefined, async () => [])
  assert.equal(result.maintenanceMode, false)
  assert.equal(result.registrationEnabled, true)
})

test('site 카테고리가 아닌 행은 무시한다(다른 카테고리에 같은 setting_key가 있어도 섞이지 않는다)', async () => {
  // 앞선 테스트가 남긴 category='site' 행(maintenance_mode enabled:true)을
  // 먼저 지운다 — 그게 남아있으면 아래 assert가 "site 행 때문에 true"인지
  // "features 행에 흔들려서 true"인지 구분하지 못한다(거짓 통과 방지).
  await setupClient.execute({
    sql: `DELETE FROM system_settings WHERE category = 'site' AND setting_key = 'maintenance_mode'`,
  })

  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'features', 'maintenance_mode', ?, 0, ?, ?)`,
    args: [id, JSON.stringify({ enabled: true }), Date.now(), Date.now()],
  })

  const { getSystemSettings } = await loadFreshSettingsModule()
  const result = await getSystemSettings(undefined, async () => {
    const { listSystemSettings } = await import(
      `${SETTINGS_QUERY_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`
    )
    return listSystemSettings(true)
  })
  assert.equal(result.maintenanceMode, false, "category='features'의 동명 키에 흔들리면 안 된다")
})

/**
 * 이전 Supabase REST 구현에는 `AbortSignal.timeout(2500)`이 있었고, Turso
 * 전환(profile.ts) 때는 `withTimeout`/`FETCH_TIMEOUT_MS`(3000ms)로 재현됐다.
 * 이 보호가 조용히 사라지면 미들웨어 요청 하나가 Turso 응답을 무기한
 * 기다리다 Edge 실행 시간 제한에 하드킬(504)당한다 — 단계 2c에서 실제로
 * 한 번 빠졌다가 리뷰에서 잡힌 이력이 있다(조정자 지적). 실제로 3초를
 * 기다리지 않기 위해 `node:test`의 `mock.timers`로 `setTimeout`을 가짜
 * 시계로 바꾸고, 절대 resolve하지 않는 `fetchSettings`를 두 번째 인자로
 * 주입한다(운영 호출부는 이 인자를 넘기지 않고 기본값 `listSystemSettings`를
 * 쓴다 — 프로덕션 동작은 바뀌지 않는다).
 */
test('타임아웃(FETCH_TIMEOUT_MS=3000ms) 안에 응답하지 않으면 null을 반환한다(fail-open, 사이트를 막지 않는다)', async () => {
  const { getSystemSettings } = await loadFreshSettingsModule()
  const neverResolves = () => new Promise(() => {})

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const promise = getSystemSettings(undefined, neverResolves)
    mock.timers.tick(3000)
    const result = await promise
    assert.equal(
      result,
      null,
      '타임아웃도 fail-open이어야 한다 — 유지보수 모드가 "꺼짐"으로 안전하게 처리된다'
    )
  } finally {
    mock.timers.reset()
  }
})

test('60초 TTL 캐시: 같은 모듈 인스턴스에서 두 번째 호출은 fetchSettings를 다시 부르지 않는다', async () => {
  const { getSystemSettings } = await loadFreshSettingsModule()
  let callCount = 0
  const countingFetch = async () => {
    callCount++
    return []
  }

  await getSystemSettings(undefined, countingFetch)
  await getSystemSettings(undefined, countingFetch)
  assert.equal(callCount, 1, 'TTL 안의 재호출은 캐시를 써야 한다(매 요청마다 DB를 때리면 안 된다)')
})
