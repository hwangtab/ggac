#!/usr/bin/env node
/**
 * 유지보수 모드를 Turso에서 직접 켜고 끈다 — 컷오버 탈출구.
 *
 * 단계 2c까지는 미들웨어가 `system_settings`를 Supabase에서 읽어서, 관리자
 * 화면이 안 뜨면 Supabase REST로 끌 수 있었다. 단계 4부터 미들웨어가
 * **Turso**를 읽는다(`src/middleware/settings.ts`). 유지보수를 켜고 끄는
 * 유일한 진실은 이제 Turso이며, 관리자 화면이 안 뜨는 상황에서 이 스크립트가
 * 유일한 수단이다.
 *
 * **즉석 `node -e` 명령을 쓰지 마라.** libsql은 DQS(큰따옴표 문자열)를 끄기
 * 때문에 셸 따옴표를 피하려고 SQL 안에서 큰따옴표를 쓰면 `"$.enabled"`가
 * 식별자로 파싱돼 `no such column: $.enabled`로 죽는다. 컷오버 당일 처음
 * 발견할 일이 아니라서 파일로 고정했다.
 *
 * 사용:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso/set-maintenance.mjs on
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso/set-maintenance.mjs off
 *   ... node scripts/turso/set-maintenance.mjs status     # 읽기만
 */
import { createClient } from '@libsql/client'

const MODE = process.argv[2]
if (!['on', 'off', 'status'].includes(MODE)) {
  console.error('사용법: set-maintenance.mjs <on|off|status>')
  process.exit(2)
}

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL이 없다.')
  process.exit(2)
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

/**
 * 미들웨어(`src/middleware/settings.ts`)는 `category === 'site'`인 행만 본다.
 * 그 조건이 없으면 다른 카테고리의 동명 키를 바꾸면서 정작 판정에 쓰이는
 * 행은 못 고칠 수 있다.
 */
const WHERE = `category = 'site' AND setting_key = 'maintenance_mode'`

async function read() {
  const r = await client.execute(`SELECT setting_value FROM system_settings WHERE ${WHERE}`)
  if (r.rows.length !== 1) return { rows: r.rows.length, enabled: null, message: null }
  const v = JSON.parse(String(r.rows[0].setting_value))
  return { rows: 1, enabled: v?.enabled === true, message: v?.message ?? null }
}

const before = await read()
console.log(
  `현재: 행 ${before.rows}개 · 유지보수 ${before.enabled ? 'ON' : 'OFF'}` +
    (before.message ? ` · 메시지 "${before.message}"` : '')
)

if (before.rows !== 1) {
  console.error(`\n중단: maintenance_mode 행이 ${before.rows}개다(1이어야 한다).`)
  process.exit(1)
}
if (MODE === 'status') process.exit(0)

/**
 * `json_set`으로 `enabled`만 바꾼다 — 값을 통째로 덮어쓰면 점검 메시지가
 * 날아간다. `enabled` 키가 없던 행에도 안전하게 추가된다.
 * `updated_at`은 `integer timestamp_ms`다(ISO 문자열이 아니다).
 */
const res = await client.execute({
  sql: `UPDATE system_settings
           SET setting_value = json_set(setting_value, '$.enabled', json(?)),
               updated_at = ?
         WHERE ${WHERE}`,
  args: [MODE === 'on' ? 'true' : 'false', Date.now()],
})

if (res.rowsAffected !== 1) {
  console.error(`\n중단: ${res.rowsAffected}개 행이 갱신됐다(1이어야 한다).`)
  process.exit(1)
}

const after = await read()
console.log(
  `변경: 유지보수 ${after.enabled ? 'ON' : 'OFF'}` +
    (after.message ? ` · 메시지 "${after.message}" (보존됨)` : '')
)
console.log('\n설정 캐시가 60초다 — 반영까지 최대 1분 기다린 뒤 확인할 것.')
