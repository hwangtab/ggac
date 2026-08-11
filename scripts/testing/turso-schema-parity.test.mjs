import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparePgToSqlite } from '../turso/check-schema-parity.mjs'

const pg = {
  tables: { users: ['id', 'email'], posts: ['id', 'title'] },
  droppedTables: ['legacy'],
}

test('완전히 일치하면 문제를 보고하지 않는다', () => {
  const sqlite = { users: ['id', 'email'], posts: ['id', 'title'] }
  const r = comparePgToSqlite(pg, sqlite)
  assert.deepEqual(r.missingTables, [])
  assert.deepEqual(r.missingColumns, [])
  assert.deepEqual(r.extraTables, [])
})

test('빠진 테이블을 보고한다', () => {
  const sqlite = { users: ['id', 'email'] }
  const r = comparePgToSqlite(pg, sqlite)
  assert.deepEqual(r.missingTables, ['posts'])
})

test('빠진 컬럼을 보고한다', () => {
  const sqlite = { users: ['id'], posts: ['id', 'title'] }
  const r = comparePgToSqlite(pg, sqlite)
  assert.deepEqual(r.missingColumns, [{ table: 'users', column: 'email' }])
})

test('폐기 대상 테이블이 되살아나면 extraTables로 보고한다', () => {
  const sqlite = { users: ['id', 'email'], posts: ['id', 'title'], legacy: ['id'] }
  const r = comparePgToSqlite(pg, sqlite)
  assert.deepEqual(r.extraTables, ['legacy'])
})

test('Better Auth 테이블은 extraTables로 보고하지 않는다', () => {
  const sqlite = {
    users: ['id', 'email'],
    posts: ['id', 'title'],
    user: ['id'],
    session: ['id'],
    account: ['id'],
    verification: ['id'],
  }
  const r = comparePgToSqlite(pg, sqlite)
  assert.deepEqual(r.extraTables, [])
})
