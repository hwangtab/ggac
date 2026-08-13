import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * turso db dump가 만든 SQL을 대상 DB에 적용한다.
 * BEGIN/COMMIT은 libSQL 배치가 자체 트랜잭션을 쓰므로 걸러낸다.
 */
export async function restoreFromDump(dumpPath, targetUrl, authToken) {
  const sql = readFileSync(dumpPath, 'utf8')

  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^(BEGIN|COMMIT|PRAGMA)\b/i.test(s))

  const client = createClient(authToken ? { url: targetUrl, authToken } : { url: targetUrl })
  try {
    await client.batch(statements, 'write')
  } finally {
    client.close()
  }

  return statements.length
}

if (process.argv[1]?.endsWith('restore-from-dump.mjs')) {
  const [dumpPath, targetUrl] = process.argv.slice(2)
  if (!dumpPath || !targetUrl) {
    console.error('usage: node restore-from-dump.mjs <dump.sql> <target-url>')
    process.exit(1)
  }
  const count = await restoreFromDump(dumpPath, targetUrl, process.env.TURSO_AUTH_TOKEN)
  console.log(`복원 완료: ${count}개 구문 적용`)
}
