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

test('문자열 리터럴 안에 세미콜론이 있어도 안 잘린다', async () => {
  const dumpPath = '.tmp-restore-semicolon.sql'
  const dbPath = '.tmp-restore-semicolon.db'
  for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)

  // 실제 이 사이트가 저장하는 값과 같은 모양: 한글 소개글 중간에 세미콜론이
  // 들어가고, contact 필드는 세미콜론으로 구분된 다중 URL을 담는다.
  const bio = '경기아트콜렉티브 협동조합 소속; 다원예술 활동가로 무대·전시를 오간다.'
  const contact = 'https://instagram.com/ggackr;https://ggac.kr/artists/kim'

  writeFileSync(
    dumpPath,
    [
      'PRAGMA foreign_keys=OFF;',
      'BEGIN TRANSACTION;',
      'CREATE TABLE artists (id TEXT PRIMARY KEY, bio TEXT NOT NULL, contact TEXT NOT NULL);',
      `INSERT INTO artists VALUES ('a1', '${bio}', '${contact}');`,
      'COMMIT;',
    ].join('\n')
  )

  await restoreFromDump(dumpPath, `file:${dbPath}`)

  const client = createClient({ url: `file:${dbPath}` })
  try {
    const result = await client.execute('SELECT bio, contact FROM artists WHERE id = ?', ['a1'])
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].bio, bio)
    assert.equal(result.rows[0].contact, contact)
  } finally {
    client.close()
    for (const p of [dumpPath, dbPath]) if (existsSync(p)) rmSync(p)
  }
})
