import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

test('로컬 파일 DB에 연결해 쿼리를 실행한다', async () => {
  const path = '.tmp-turso-client-test.db'
  if (existsSync(path)) rmSync(path)

  const client = createClient({ url: `file:${path}` })
  try {
    await client.execute('CREATE TABLE probe (id TEXT PRIMARY KEY)')
    await client.execute("INSERT INTO probe (id) VALUES ('a')")
    const result = await client.execute('SELECT id FROM probe')
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].id, 'a')
  } finally {
    client.close()
    if (existsSync(path)) rmSync(path)
  }
})

test('drizzle.config.ts가 turso dialect를 선언한다', async () => {
  const { readFileSync } = await import('node:fs')
  const config = readFileSync('drizzle.config.ts', 'utf8')
  assert.match(config, /dialect:\s*'turso'/)
  assert.match(config, /schema:\s*'\.\/src\/db\/schema\/index\.ts'/)
})
