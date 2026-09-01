import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getTableConfig, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { is, Column } from 'drizzle-orm'

import * as schema from '../../src/db/schema/index.ts'

/**
 * 성능 인덱스 선언 회귀 테스트.
 *
 * `0004`·`0005`가 운영에 만든 `idx_*` 인덱스 23개는 오랫동안 **마이그레이션에만
 * 있고 Drizzle 스키마에는 없었다.** 그 상태에서 `drizzle-kit push`를 한 번 돌리면
 * push가 그것들을 "스키마에 없는 잉여"로 보고 **전부 지운다**(적대 감사
 * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 에러는 나지 않는다 —
 * 전 조합원의 로그인·게시판 조회가 조용히 전수 스캔으로 되돌아간다.
 *
 * `drizzle.config.ts`의 원격 push 가드는 **증상**만 막는다. 근본 해결은 인덱스를
 * `src/db/schema/`에 `index()`로 선언해 두는 것이고, 이 테스트는 그 선언이
 * **다시 사라지지 않게** 못박는다.
 *
 * 정본은 마이그레이션 파일이다(네트워크 없이 돌아야 하므로 운영 DB에 붙지
 * 않는다). 마이그레이션의 `CREATE INDEX` 문과 스키마 선언에서 렌더링한 DDL을
 * **이름·컬럼 순서·DESC 위치까지** 대조한다 — 이름만 보면 컬럼 순서를 뒤집어도
 * 통과하기 때문이다.
 */

const MIGRATIONS = [
  'src/db/migrations/0004_add_performance_indexes.sql',
  'src/db/migrations/0005_add_user_sessions_indexes.sql',
]

/** 공백·따옴표·`IF NOT EXISTS`를 정규화해 두 출처의 DDL을 비교 가능하게 만든다. */
function normalize(ddl) {
  return ddl
    .replace(/`/g, '')
    .replace(/\bIF NOT EXISTS\b/i, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '')
}

/** 마이그레이션 파일에서 `idx_`로 시작하는 CREATE INDEX 문을 뽑는다. */
function expectedFromMigrations() {
  const found = new Map()
  for (const file of MIGRATIONS) {
    const sql = readFileSync(file, 'utf8')
    const re = /CREATE INDEX(?: IF NOT EXISTS)? `?(idx_\w+)`?\s+ON\s+`?(\w+)`?\s*\(([^)]*)\)/gi
    for (const [, name, table, cols] of sql.matchAll(re)) {
      assert.ok(!found.has(name), `마이그레이션에 중복된 인덱스 이름: ${name}`)
      found.set(name, normalize(`CREATE INDEX ${name} ON ${table} (${cols})`))
    }
  }
  return found
}

/** Drizzle 스키마 선언에서 같은 형태의 DDL을 렌더링한다. */
function declaredFromSchema() {
  const dialect = new SQLiteSyncDialect()
  const found = new Map()
  for (const value of Object.values(schema)) {
    let config
    try {
      config = getTableConfig(value)
    } catch {
      continue // 테이블이 아닌 export(enum 상수·relations 등)
    }
    for (const idx of config.indexes) {
      const { name, columns } = idx.config
      if (!name.startsWith('idx_')) continue
      const rendered = columns.map(col =>
        is(col, Column) ? col.name : dialect.sqlToQuery(col).sql
      )
      assert.ok(!found.has(name), `스키마에 중복 선언된 인덱스 이름: ${name}`)
      found.set(name, normalize(`CREATE INDEX ${name} ON ${config.name} (${rendered.join(', ')})`))
    }
  }
  return found
}

test('0004·0005의 성능 인덱스가 전부 Drizzle 스키마에 선언돼 있다', () => {
  const expected = expectedFromMigrations()
  const declared = declaredFromSchema()

  // 정본이 실제로 읽혔는지 먼저 확인한다 — 정규식이 아무것도 못 잡으면
  // 아래 비교가 "0 === 0"으로 통과해 아무것도 증명하지 못한다.
  assert.equal(
    expected.size,
    23,
    `0004·0005에서 성능 인덱스 23개를 찾아야 하는데 ${expected.size}개를 찾았다`
  )

  const missing = [...expected.keys()].filter(name => !declared.has(name))
  assert.deepEqual(
    missing,
    [],
    `스키마에 선언되지 않은 인덱스가 있다 — drizzle-kit push가 이것들을 지운다: ${missing.join(', ')}`
  )
})

test('선언된 인덱스의 컬럼 순서와 DESC 위치가 마이그레이션과 정확히 같다', () => {
  const expected = expectedFromMigrations()
  const declared = declaredFromSchema()

  for (const [name, ddl] of expected) {
    assert.equal(declared.get(name), ddl, `${name}의 정의가 마이그레이션과 다르다`)
  }
})

test('스키마에 마이그레이션에 없는 idx_ 인덱스를 임의로 추가하지 않았다', () => {
  // 여분의 선언은 `push`가 운영에 없는 인덱스를 만들게 한다. 인덱스는 공짜가
  // 아니다(쓰기마다 갱신) — 늘리려면 마이그레이션이 먼저다.
  const expected = expectedFromMigrations()
  const extra = [...declaredFromSchema().keys()].filter(name => !expected.has(name))
  assert.deepEqual(extra, [], `마이그레이션에 근거가 없는 인덱스 선언: ${extra.join(', ')}`)
})
