import { createClient } from '@libsql/client'

import { comparePgToSqlite, formatReport, loadSnapshot } from './check-schema-parity.mjs'

const url = process.argv[2] ?? 'file:local.db'
const client = createClient({ url })

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

  const failed =
    report.missingTables.length || report.missingColumns.length || report.extraTables.length
  process.exitCode = failed ? 1 : 0
} finally {
  client.close()
}
