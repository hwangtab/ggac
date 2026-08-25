import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

import { FETCH_TIMEOUT_MS } from '../../src/middleware/profile.ts'

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

test('미들웨어는 민감 설정을 평문으로 끌어오지 않는다(listSystemSettings(false))', () => {
  // 미들웨어가 보는 maintenance_mode/registration_enabled는 is_sensitive=false라
  // 마스킹 여부가 결과를 바꾸지 않는다. 반면 true로 부르면 캐시 미스마다 SMTP
  // 비밀번호 같은 평문이 Edge isolate 메모리로 끌려온다 — 응답에 새지는 않지만
  // 넓힐 이유가 없다.
  const src = readFileSync('src/middleware/settings.ts', 'utf8')
  assert.match(src, /listSystemSettings\(false\)/)
  assert.doesNotMatch(src, /listSystemSettings\(true\)/)
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
  await applyMigrations(setupClient)
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
  const result = await getSystemSettings(async () => [])
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
  const result = await getSystemSettings(async () => {
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
test('타임아웃 상수가 3000ms로 고정돼 있다(값이 조용히 줄거나 늘면 실패한다)', () => {
  // 이 단언이 없으면 아래 타임아웃 테스트는 FETCH_TIMEOUT_MS를 500ms로 바꿔도
  // 그대로 통과한다 — "타임아웃이 있다"만 보고 "얼마인지"를 안 보기 때문이다.
  assert.equal(
    FETCH_TIMEOUT_MS,
    3000,
    'FETCH_TIMEOUT_MS는 이전 Supabase REST 구현에서 가져온 값이다 — 바꾸려면 근거를 남겨라'
  )
})

test('타임아웃(FETCH_TIMEOUT_MS) 직전까지는 기다리고, 넘기면 null을 반환한다(fail-open, 사이트를 막지 않는다)', async () => {
  const { getSystemSettings } = await loadFreshSettingsModule()
  const neverResolves = () => new Promise(() => {})

  // setImmediate는 mock.timers가 가로채지 않으므로(apis에 없다) 마이크로태스크
  // 큐를 실제로 비우는 데 쓴다. Promise.race로 "아직 안 끝났다"를 보면
  // 이미 끝난 promise도 한 마이크로태스크 늦게 settle하면서 거짓 통과한다.
  const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve))

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const promise = getSystemSettings(neverResolves)
    let settled = false
    promise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    // 1ms 모자라면 아직 포기하지 않는다 — 타임아웃이 짧아지면 여기서 걸린다.
    mock.timers.tick(FETCH_TIMEOUT_MS - 1)
    await flushMicrotasks()
    assert.equal(settled, false, `${FETCH_TIMEOUT_MS - 1}ms에는 아직 결과를 내면 안 된다`)

    // 그 1ms를 마저 흘리면 포기한다 — 타임아웃이 늘거나 사라지면 여기서 걸린다.
    mock.timers.tick(1)
    const result = await promise
    assert.equal(settled, true, `${FETCH_TIMEOUT_MS}ms가 지나면 반드시 포기해야 한다`)
    assert.equal(
      result,
      null,
      '타임아웃도 fail-open이어야 한다 — 유지보수 모드가 "꺼짐"으로 안전하게 처리된다'
    )
  } finally {
    mock.timers.reset()
  }
})

/**
 * TTL은 `Date.now()` 차이로 판정하므로 가짜 시계 없이 연속 호출하면 두 호출
 * 사이 경과가 0ms다 — TTL이 1ms든 `Infinity`든 "두 번째 호출은 캐시"가
 * 통과한다. 그러면 이 파일이 막아야 할 실제 사고
 * ("관리자가 유지보수 모드를 켰는데 미들웨어가 영원히 옛 값을 본다")를
 * 전혀 못 잡는다(리뷰 1회차 Important 4).
 *
 * 그래서 `mock.timers`로 `Date`를 가짜 시계로 바꾸고 TTL 경계를 양쪽에서
 * 조인다 — 59_999ms에는 캐시, 60_001ms에는 재조회.
 */
test('60초 TTL 캐시: TTL 안에서는 캐시를 쓰고, TTL이 지나면 반드시 다시 조회한다', async () => {
  const originalTtl = process.env.SETTINGS_CACHE_TTL_MS
  delete process.env.SETTINGS_CACHE_TTL_MS

  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  try {
    const { getSystemSettings } = await loadFreshSettingsModule()
    let callCount = 0
    const countingFetch = async () => {
      callCount++
      return []
    }

    await getSystemSettings(countingFetch)
    assert.equal(callCount, 1, '첫 호출은 캐시가 비어 있으니 조회한다')

    await getSystemSettings(countingFetch)
    assert.equal(
      callCount,
      1,
      'TTL 안의 재호출은 캐시를 써야 한다(매 요청마다 DB를 때리면 안 된다)'
    )

    // TTL 1ms 전: 아직 캐시. TTL이 0에 가깝게 줄면 여기서 걸린다.
    mock.timers.tick(59_999)
    await getSystemSettings(countingFetch)
    assert.equal(callCount, 1, '59_999ms는 아직 TTL(60_000ms) 안이다')

    // TTL 경과: 반드시 다시 조회. TTL이 Infinity이거나 캐시가 만료되지 않으면
    // 여기서 걸린다 — 관리자가 켠 유지보수 모드가 영원히 반영되지 않는 상태다.
    mock.timers.tick(2)
    await getSystemSettings(countingFetch)
    assert.equal(
      callCount,
      2,
      'TTL(60_000ms)이 지나면 다시 조회해야 한다 — 아니면 관리자가 켠 유지보수 모드를 미들웨어가 영원히 못 본다'
    )
  } finally {
    mock.timers.reset()
    if (originalTtl === undefined) delete process.env.SETTINGS_CACHE_TTL_MS
    else process.env.SETTINGS_CACHE_TTL_MS = originalTtl
  }
})

/**
 * 최종 리뷰 B-4. 미들웨어 matcher는 전 페이지 + 대부분의 `/api/*`다. 예전에는
 * 실패를 전혀 기억하지 않아서 Turso 순단 한 번에 **모든 요청**이 각자 조회를
 * 시작하고 각자 3초를 기다렸다(리뷰어 계측 3002ms). 취소가 불가능하므로
 * (`@libsql/client` 0.17.4의 `execute()`는 `AbortSignal`을 받지 않는다) 포기한
 * 쿼리는 뒤에 남아 쌓인다 — 그래서 ① 실패를 짧게 캐시하고 ② 동시 조회를
 * 하나로 합친다. 아래 두 테스트가 그 둘을 각각 못박는다.
 */
test('실패 캐시: 조회가 실패하면 짧은 창 동안 재조회하지 않고, 창이 지나면 반드시 다시 시도한다', async () => {
  const originalTtl = process.env.SETTINGS_CACHE_TTL_MS
  delete process.env.SETTINGS_CACHE_TTL_MS

  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  try {
    const { getSystemSettings } = await loadFreshSettingsModule()
    let calls = 0
    const failing = async () => {
      calls++
      throw new Error('Turso 순단 재현')
    }

    assert.equal(await getSystemSettings(failing), null, '실패는 fail-open(null)이다')
    assert.equal(calls, 1)

    await getSystemSettings(failing)
    assert.equal(calls, 1, '실패 직후 재호출은 DB를 다시 때리면 안 된다(폭주 방지)')

    // 실패 캐시 1ms 전: 아직 캐시. 창이 0에 가깝게 줄면 여기서 걸린다.
    mock.timers.tick(9_999)
    await getSystemSettings(failing)
    assert.equal(calls, 1, '9_999ms는 아직 실패 캐시(10_000ms) 안이다')

    // 창이 지나면 반드시 재시도. 실패 캐시가 성공 TTL만큼 길어지거나 영구가 되면
    // 여기서 걸린다 — 복구를 알아채지 못하는 상태다.
    mock.timers.tick(2)
    await getSystemSettings(failing)
    assert.equal(calls, 2, '실패 캐시(10_000ms)가 지나면 다시 시도해야 한다')
  } finally {
    mock.timers.reset()
    if (originalTtl === undefined) delete process.env.SETTINGS_CACHE_TTL_MS
    else process.env.SETTINGS_CACHE_TTL_MS = originalTtl
  }
})

test('실패 캐시는 성공하면 즉시 풀린다(복구를 늦게 알아채면 안 된다)', async () => {
  const originalTtl = process.env.SETTINGS_CACHE_TTL_MS
  delete process.env.SETTINGS_CACHE_TTL_MS

  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  try {
    const { getSystemSettings } = await loadFreshSettingsModule()
    let calls = 0
    let shouldFail = true
    const flaky = async () => {
      calls++
      if (shouldFail) throw new Error('Turso 순단 재현')
      return []
    }

    assert.equal(await getSystemSettings(flaky), null)
    mock.timers.tick(10_001)
    shouldFail = false
    const recovered = await getSystemSettings(flaky)
    assert.equal(calls, 2)
    assert.equal(recovered.maintenanceMode, false, '복구되면 정상 값을 돌려준다')

    // 성공 이후에는 성공 TTL(60초)만 지배해야 한다 — 실패 캐시가 남아 있으면
    // 아래 호출이 캐시가 아니라 null로 떨어진다.
    const cached = await getSystemSettings(flaky)
    assert.equal(calls, 2, 'TTL 안에서는 캐시를 쓴다')
    assert.equal(cached, recovered)
  } finally {
    mock.timers.reset()
    if (originalTtl === undefined) delete process.env.SETTINGS_CACHE_TTL_MS
    else process.env.SETTINGS_CACHE_TTL_MS = originalTtl
  }
})

test('동시 요청은 조회 하나를 공유한다(취소가 불가능하므로 여러 개를 시작하지 않는다)', async () => {
  const { getSystemSettings } = await loadFreshSettingsModule()
  let calls = 0
  let resolveRows
  const slow = () => {
    calls++
    return new Promise(resolve => {
      resolveRows = resolve
    })
  }

  const first = getSystemSettings(slow)
  const second = getSystemSettings(slow)
  const third = getSystemSettings(slow)
  assert.equal(calls, 1, '같은 isolate에서 동시에 날아가는 설정 조회는 최대 1개여야 한다')

  resolveRows([])
  const [a, b, c] = await Promise.all([first, second, third])
  assert.equal(a.maintenanceMode, false)
  assert.equal(b, a, '뒤따라온 요청은 앞선 조회의 결과를 그대로 받는다')
  assert.equal(c, a)
})
