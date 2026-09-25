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

test('CREATE TABLE 문을 FK 참조 대상이 먼저 오도록 위상 정렬한다', async () => {
  const { topoSortCreateTables } = await import('../turso/restore-from-dump.mjs')

  // 원본 순서: child가 아직 없는 parent를 참조 — 이 스키마의 board_meetings
  // 실패 패턴과 같은 모양이다.
  const child = 'CREATE TABLE IF NOT EXISTS child (id TEXT, ref TEXT REFERENCES parent(id));'
  const parent = 'CREATE TABLE IF NOT EXISTS parent (id TEXT PRIMARY KEY);'
  const grandchild =
    'CREATE TABLE IF NOT EXISTS grandchild (id TEXT, ref TEXT REFERENCES child(id));'
  const unrelated = 'CREATE TABLE IF NOT EXISTS unrelated (id TEXT PRIMARY KEY);'

  const sorted = topoSortCreateTables([child, grandchild, parent, unrelated])
  const nameOf = s => s.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]
  const order = sorted.map(nameOf)

  assert.ok(order.indexOf('parent') < order.indexOf('child'), 'parent가 child보다 먼저')
  assert.ok(order.indexOf('child') < order.indexOf('grandchild'), 'child가 grandchild보다 먼저')
  assert.equal(order.length, 4)
})

test('위상 정렬 — 자기 참조는 순서에 영향을 주지 않는다', async () => {
  const { topoSortCreateTables } = await import('../turso/restore-from-dump.mjs')
  const selfRef =
    'CREATE TABLE IF NOT EXISTS tree (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES tree(id));'
  const other = 'CREATE TABLE IF NOT EXISTS other (id TEXT PRIMARY KEY);'

  const sorted = topoSortCreateTables([other, selfRef])
  assert.equal(sorted.length, 2)
})

test('위상 정렬 — 정렬 대상 밖의 테이블을 가리키는 FK는 무시한다', async () => {
  const { topoSortCreateTables } = await import('../turso/restore-from-dump.mjs')
  const stmt =
    'CREATE TABLE IF NOT EXISTS orphan_ref (id TEXT, ref TEXT REFERENCES not_in_this_list(id));'

  const sorted = topoSortCreateTables([stmt])
  assert.equal(sorted.length, 1)
  assert.equal(sorted[0], stmt)
})

test('splitSqlStatements — 문자열 리터럴 안의 세미콜론을 문장 경계로 보지 않는다', async () => {
  const { splitSqlStatements } = await import('../turso/restore-from-dump.mjs')
  const sql = "INSERT INTO t VALUES ('a;b');\nINSERT INTO t VALUES ('c');"
  const statements = splitSqlStatements(sql)
  assert.equal(statements.length, 2)
  assert.match(statements[0], /'a;b'/)
})

test('splitSqlStatements — 이스케이프된 따옴표(작은따옴표 두 개)를 문자열 끝으로 보지 않는다', async () => {
  const { splitSqlStatements } = await import('../turso/restore-from-dump.mjs')
  const sql = "INSERT INTO t VALUES ('it''s; here');"
  const statements = splitSqlStatements(sql)
  assert.equal(statements.length, 1)
})

test('splitSqlStatements — 줄 주석·블록 주석 안의 세미콜론을 무시한다', async () => {
  const { splitSqlStatements } = await import('../turso/restore-from-dump.mjs')
  const sql =
    '-- comment; with semicolon\nINSERT INTO t VALUES (1);\n/* block; comment */\nINSERT INTO t VALUES (2);'
  const statements = splitSqlStatements(sql)
  assert.equal(statements.length, 2)
})
