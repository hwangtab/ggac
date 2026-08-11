import { readFileSync } from 'node:fs'

const BETTER_AUTH_TABLES = new Set(['user', 'session', 'account', 'verification'])

export function comparePgToSqlite(pgSnapshot, sqliteSchema) {
  const missingTables = []
  const missingColumns = []

  for (const [table, columns] of Object.entries(pgSnapshot.tables)) {
    const actual = sqliteSchema[table]
    if (!actual) {
      missingTables.push(table)
      continue
    }
    const actualSet = new Set(actual)
    for (const column of columns) {
      if (!actualSet.has(column)) missingColumns.push({ table, column })
    }
  }

  const expected = new Set(Object.keys(pgSnapshot.tables))
  const extraTables = Object.keys(sqliteSchema).filter(
    t => !expected.has(t) && !BETTER_AUTH_TABLES.has(t)
  )

  return { missingTables, missingColumns, extraTables, checkedTableCount: expected.size }
}

export function loadSnapshot(path = 'scripts/turso/pg-schema-snapshot.json') {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function formatReport({ missingTables, missingColumns, extraTables, checkedTableCount }) {
  const lines = []
  if (missingTables.length) lines.push(`빠진 테이블: ${missingTables.join(', ')}`)
  for (const { table, column } of missingColumns) {
    lines.push(`빠진 컬럼: ${table}.${column}`)
  }
  if (extraTables.length) lines.push(`예상 밖 테이블: ${extraTables.join(', ')}`)
  return lines.length ? lines.join('\n') : `패리티 통과: ${checkedTableCount}개 테이블 전 컬럼 일치`
}
