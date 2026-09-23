#!/usr/bin/env node
/**
 * `system_settings`에 없는 `features/funding_features` 행을 만든다.
 *
 * `updateSystemSetting`(`src/db/queries/settings.ts`)은 UPDATE 전용이라 행이
 * 없으면 `SettingNotFoundError`를 던진다. 운영 `system_settings`의
 * `features` 카테고리에는 `artist_features`·`board_features`·
 * `comment_features`·`file_upload`·`social_features` 다섯 행만 있고
 * `funding_features`는 없다(2026-09-23 운영 DB 직접 확인) — 그래서 관리자
 * 화면에서 펀딩 스위치를 처음 켜려는 순간 저장이 실패한다. 이 스크립트가
 * 그 빠진 행 하나를 만든다.
 *
 * **절대 기능을 켜지 않는다.** 넣는 값은 `enabled: false`다. 스위치를 켜는
 * 것은 이 스크립트가 아니라 이후 관리자 화면에서 하는 별도의 결정이다.
 *
 * 사용:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso/seed-funding-settings.mjs
 *
 * 멱등이다 — 행이 이미 있으면 아무것도 쓰지 않고 그 사실만 출력한다.
 */
import { randomUUID } from 'node:crypto'

import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL이 없다.')
  process.exit(2)
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

const CATEGORY = 'features'
const SETTING_KEY = 'funding_features'
// `src/app/api/admin/settings/reset/route.ts`의 DEFAULT_SETTINGS가 선언한
// 기본값과 글자 그대로 맞춘다 — 그 라우트가 이 행에 대한 정본이다.
const SETTING_VALUE = { enabled: false, platform_fee_rate_bp: 0, hold_minutes: 10 }
const DESCRIPTION = '크라우드펀딩 기능 설정'

async function readFeaturesRows() {
  const r = await client.execute({
    sql: `SELECT id, setting_key, setting_value, description, is_sensitive, updated_by,
                 created_at, updated_at
            FROM system_settings
           WHERE category = ?
           ORDER BY setting_key`,
    args: [CATEGORY],
  })
  return r.rows
}

const existing = await client.execute({
  sql: `SELECT id FROM system_settings WHERE category = ? AND setting_key = ?`,
  args: [CATEGORY, SETTING_KEY],
})

if (existing.rows.length > 0) {
  console.log(
    `이미 있다: features/funding_features 행이 존재한다(id=${existing.rows[0].id}) — 아무것도 쓰지 않는다.`
  )
} else {
  const now = Date.now()
  const res = await client.execute({
    sql: `INSERT INTO system_settings
            (id, category, setting_key, setting_value, description, is_sensitive,
             updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    args: [
      randomUUID(),
      CATEGORY,
      SETTING_KEY,
      JSON.stringify(SETTING_VALUE),
      DESCRIPTION,
      now,
      now,
    ],
  })
  if (res.rowsAffected !== 1) {
    console.error(`\n중단: ${res.rowsAffected}개 행이 삽입됐다(1이어야 한다).`)
    process.exit(1)
  }
  console.log('삽입 완료: features/funding_features (enabled: false)')
}

console.log('\n현재 features 카테고리:')
for (const row of await readFeaturesRows()) {
  console.log(`  - ${row.setting_key}: ${row.setting_value}`)
}
