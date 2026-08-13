import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { restoreFromDump } from '../turso/restore-from-dump.mjs'

test('덤프 SQL에서 DB를 복원한다', async () => {
  const dumpPath = '.tmp-restore-test.sql'
  const dbPath = '.tmp-restore-test.db'
  for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)

  writeFileSync(
    dumpPath,
    [
      'CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL);',
      "INSERT INTO posts VALUES ('p1', '첫 글');",
      "INSERT INTO posts VALUES ('p2', '둘째 글');",
    ].join('\n')
  )

  await restoreFromDump(dumpPath, `file:${dbPath}`)

  const client = createClient({ url: `file:${dbPath}` })
  try {
    const result = await client.execute('SELECT id, title FROM posts ORDER BY id')
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[1].title, '둘째 글')
  } finally {
    client.close()
    for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)
  }
})

test('트랜잭션 구문이 섞인 덤프도 처리한다', async () => {
  const dumpPath = '.tmp-restore-tx.sql'
  const dbPath = '.tmp-restore-tx.db'
  for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)

  writeFileSync(
    dumpPath,
    [
      'PRAGMA foreign_keys=OFF;',
      'BEGIN TRANSACTION;',
      'CREATE TABLE t (id TEXT PRIMARY KEY);',
      "INSERT INTO t VALUES ('a');",
      'COMMIT;',
    ].join('\n')
  )

  await restoreFromDump(dumpPath, `file:${dbPath}`)

  const client = createClient({ url: `file:${dbPath}` })
  try {
    const result = await client.execute('SELECT count(*) AS n FROM t')
    assert.equal(Number(result.rows[0].n), 1)
  } finally {
    client.close()
    for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)
  }
})
