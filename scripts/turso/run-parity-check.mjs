import { createClient } from '@libsql/client'

import { comparePgToSqlite, formatReport, loadSnapshot } from './check-schema-parity.mjs'
import { findJsonEncodingViolations, formatJsonEncodingReport } from './check-json-encoding.mjs'

const url = process.argv[2] ?? 'file:local.db'
// 원격 URL로 부를 때(컷오버 사전·사후 점검) 토큰 없이는 접속 자체가 안 된다 —
// 최종 리뷰가 지적한 한 줄. 파일 DB에는 authToken이 무시되므로 무해하다.
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

try {
  const tableRows = await client.execute(
    `SELECT name FROM sqlite_master
     WHERE type='table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '__drizzle%'
     ORDER BY name`
  )

  const sqliteSchema = {}
  for (const row of tableRows.rows) {
    const table = String(row.name)
    const info = await client.execute(`PRAGMA table_info(${JSON.stringify(table)})`)
    sqliteSchema[table] = info.rows.map(c => String(c.name))
  }

  const report = comparePgToSqlite(loadSnapshot(), sqliteSchema)
  console.log(formatReport(report))

  // 이름 패리티가 통과해도 값 인코딩은 깨질 수 있다 — Postgres text[]에서 온
  // JSON 배열 컬럼이 배열 리터럴(`{음악,영상}`)로 들어가면 읽기 전체가 던지고,
  // 그 예외를 상위 폴백이 삼켜 조용히 낡은 JSON 파일로 되돌아간다.
  // 상세는 check-json-encoding.mjs 상단 주석.
  const jsonViolations = await findJsonEncodingViolations(client)
  console.log(formatJsonEncodingReport(jsonViolations))

  const failed =
    report.missingTables.length ||
    report.missingColumns.length ||
    report.extraTables.length ||
    jsonViolations.length
  process.exitCode = failed ? 1 : 0
} finally {
  client.close()
}
