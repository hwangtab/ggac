import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparePgToSqlite, loadSnapshot, formatReport } from '../turso/check-schema-parity.mjs'

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
  // 테이블 전체가 없으면 그 테이블의 컬럼들을 개별 missingColumns로 중복
  // 보고해서는 안 된다(구현의 `continue`가 지켜져야 함).
  assert.deepEqual(r.missingColumns, [])
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

test('formatReport 성공 메시지의 테이블 수는 하드코딩이 아니라 실측값에서 파생된다', () => {
  const smallPg = {
    tables: { a: ['id'], b: ['id'] },
    droppedTables: [],
  }
  const sqlite = { a: ['id'], b: ['id'] }
  const r = comparePgToSqlite(smallPg, sqlite)
  assert.equal(formatReport(r), '패리티 통과: 2개 테이블 전 컬럼 일치')
})

test('실제 스냅샷(22개 테이블) 기준 성공 메시지는 기존 문자열과 바이트 단위로 동일하다', () => {
  const snapshot = loadSnapshot()
  const r = comparePgToSqlite(snapshot, snapshot.tables)
  assert.equal(formatReport(r), '패리티 통과: 22개 테이블 전 컬럼 일치')
})
