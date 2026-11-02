#!/usr/bin/env node
/**
 * `system_settings`에 없는 `features/timebank_features` 행을 만든다.
 * `seed-funding-settings.mjs`를 복제했다 — 이유도 같다.
 *
 * `updateSystemSetting`(`src/db/queries/settings.ts`)은 UPDATE 전용이라 행이
 * 없으면 `SettingNotFoundError`를 던진다. 그래서 전용 라우트
 * (`PUT /api/admin/timebank/settings`)가 이사회 의결 뒤 스위치를 처음 켜려는
 * 순간 저장이 실패한다. 이 스크립트가 그 빠진 행 하나를 만든다.
 *
 * **절대 기능을 켜지 않는다.** 넣는 값은 전부 꺼진 기본값이다. 켜는 것은 이
 * 스크립트가 아니라 이사회 의결과 그 근거를 받는 전용 라우트의 일이다(스펙 §9.2).
 *
 * 설정 초기화(`/api/admin/settings/reset`)의 `DEFAULT_SETTINGS`에는 이 행이
 * **없다**(계획 결정 4 — 초기화가 의결을 우회하지 않게). 그래서 이 행의 기본값
 * 정본은 `src/lib/timebank/settings.ts`의 `TIMEBANK_DEFAULTS`이고, 아래 값은
 * 그것과 글자 그대로 같아야 한다(`timebankSettingsWiring.test.mjs`가 대조한다).
 * 이 파일은 plain `node`로 돌아야 해서 그 TS 모듈을 임포트하지 못한다.
 *
 * 사용:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso/seed-timebank-settings.mjs
 *
 * 멱등이다 — 행이 이미 있으면(켜져 있든 아니든) 아무것도 쓰지 않고 그 사실만
 * 출력한다.
 */
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const CATEGORY = 'features'
const SETTING_KEY = 'timebank_features'
export const SETTING_VALUE = Object.freeze({
  enabled: false,
  coop_tasks_enabled: false,
  redeem_tickets_enabled: false,
  redeem_rewards_enabled: false,
  market_time_enabled: false,
  terms_version: '2026-11',
  signup_grant_minutes: 120,
  min_balance_minutes: -600,
  soft_max_minutes: 1800,
  low_balance_flag_minutes: -480,
  coop_task_monthly_cap_minutes: 480,
  redeem_monthly_cap_minutes: 480,
  market_item_max_minutes: 240,
  adjustment_dual_approval_minutes: 240,
})
const DESCRIPTION = '조합원 타임뱅크 설정(이사회 의결 사항 — 전용 라우트로만 변경)'

/**
 * 행이 없을 때만 꺼진 기본값으로 넣는다. `INSERT … WHERE NOT EXISTS` 한 문장이라
 * 두 번 동시에 돌아도 행은 하나다(`system_settings`에는 (category, setting_key)
 * 유일 인덱스도 있다).
 *
 * @param {import('@libsql/client').Client} client
 * @returns {Promise<{ inserted: boolean }>}
 */
export async function seedTimebankSettings(client) {
  const now = Date.now()
  const res = await client.execute({
    sql: `INSERT INTO system_settings
            (id, category, setting_key, setting_value, description, is_sensitive,
             updated_by, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, 0, NULL, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM system_settings WHERE category = ? AND setting_key = ?
           )`,
    args: [
      randomUUID(),
      CATEGORY,
      SETTING_KEY,
      JSON.stringify(SETTING_VALUE),
      DESCRIPTION,
      now,
      now,
      CATEGORY,
      SETTING_KEY,
    ],
  })
  if (res.rowsAffected > 1) {
    throw new Error(`${res.rowsAffected}개 행이 삽입됐다(0 또는 1이어야 한다).`)
  }
  return { inserted: res.rowsAffected === 1 }
}

async function main() {
  const { createClient } = await import('@libsql/client')
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    console.error('TURSO_DATABASE_URL이 없다.')
    process.exit(2)
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

  const { inserted } = await seedTimebankSettings(client)
  console.log(
    inserted
      ? '삽입 완료: features/timebank_features (전부 꺼짐)'
      : '이미 있다: features/timebank_features 행이 존재한다 — 아무것도 쓰지 않는다.'
  )

  const r = await client.execute({
    sql: `SELECT setting_key, setting_value FROM system_settings
           WHERE category = ? ORDER BY setting_key`,
    args: [CATEGORY],
  })
  console.log('\n현재 features 카테고리:')
  for (const row of r.rows) console.log(`  - ${row.setting_key}: ${row.setting_value}`)
  client.close()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
