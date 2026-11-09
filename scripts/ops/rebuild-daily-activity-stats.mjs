#!/usr/bin/env node
/**
 * daily_activity_stats를 user_activities에서 KST 날짜 기준으로 다시 만든다.
 *
 * 왜: 2026-11-09 전까지 activity_date가 UTC 날짜였다(다른 도메인은 KST). 그날
 * 코드는 KST로 바뀌었지만 기존 행은 그대로라 KST 00:00~08:59의 활동이 전날로
 * 집계돼 있다. 집계의 원천(user_activities.created_at)이 남아 있으므로 표를
 * 통째로 다시 계산할 수 있다.
 *
 * 기본은 dry-run이다 — 바뀔 행 수만 센다. 실제로 쓰려면 --apply.
 *
 *   node scripts/ops/rebuild-daily-activity-stats.mjs <TURSO_DATABASE_URL> [--apply]
 *   (원격이면 TURSO_AUTH_TOKEN 환경변수)
 *
 * 쓰기는 한 트랜잭션: user_id가 있는 행을 전부 지우고 다시 넣는다(user_id NULL
 * 행은 집계 대상이 아니라 두지 않는다 — 기존 코드도 user_id 없는 활동은 세지
 * 않는다). 적용 전에 운영 DB를 백업하라(`scripts/turso/README.md`).
 */
import { createClient } from '@libsql/client'

const [, , url, ...flags] = process.argv
if (!url) {
  console.error(
    '사용법: node scripts/ops/rebuild-daily-activity-stats.mjs <TURSO_DATABASE_URL> [--apply]'
  )
  process.exit(2)
}
const apply = flags.includes('--apply')
const client = createClient({
  url,
  authToken:
    url.startsWith('libsql://') || url.startsWith('https://')
      ? process.env.TURSO_AUTH_TOKEN
      : undefined,
})

// created_at은 epoch 밀리초(정수) 또는 ISO 문자열일 수 있어 둘 다 받는다.
// KST = UTC+9 → 9시간을 더한 뒤 날짜만 취한다.
const KST_SQL = `date(
  CASE typeof(created_at)
    WHEN 'integer' THEN datetime(created_at / 1000, 'unixepoch', '+9 hours')
    WHEN 'real' THEN datetime(created_at / 1000, 'unixepoch', '+9 hours')
    ELSE datetime(created_at, '+9 hours')
  END
)`

const recomputed = await client.execute(`
  SELECT ${KST_SQL} AS activity_date, user_id, action_type, COUNT(*) AS count
  FROM user_activities
  WHERE user_id IS NOT NULL
  GROUP BY 1, 2, 3
`)
const current = await client.execute(
  `SELECT activity_date, user_id, action_type, count FROM daily_activity_stats WHERE user_id IS NOT NULL`
)
const key = r => `${r.activity_date}|${r.user_id}|${r.action_type}`
const want = new Map(recomputed.rows.map(r => [key(r), Number(r.count)]))
const have = new Map(current.rows.map(r => [key(r), Number(r.count)]))
let add = 0,
  change = 0,
  remove = 0
for (const [k, v] of want) {
  if (!have.has(k)) add++
  else if (have.get(k) !== v) change++
}
for (const k of have.keys()) if (!want.has(k)) remove++
console.log(
  `현재 ${have.size}행 → 재계산 ${want.size}행: 추가 ${add}, 값 변경 ${change}, 삭제 ${remove}${apply ? '' : ' (dry-run — --apply로 적용)'}`
)
if (!apply) process.exit(0)

const nowMs = Date.now()
const stmts = [
  { sql: `DELETE FROM daily_activity_stats WHERE user_id IS NOT NULL`, args: [] },
  ...recomputed.rows.map(r => ({
    sql: `INSERT INTO daily_activity_stats (id, activity_date, user_id, action_type, count, last_updated)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), r.activity_date, r.user_id, r.action_type, Number(r.count), nowMs],
  })),
]
await client.batch(stmts, 'write')
console.log(`적용 완료: ${recomputed.rows.length}행`)
