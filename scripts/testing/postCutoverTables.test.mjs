import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { POST_CUTOVER_TABLES, loadSnapshot } from '../turso/check-schema-parity.mjs'

/**
 * 컷오버 이후에 만든 표 목록이 마이그레이션과 어긋나지 않게 못박는다.
 *
 * `check-schema-parity.mjs`는 옛 Postgres 스냅샷과 대조하는데, 그 스냅샷은
 * 역사 기록이라 더 이상 늘지 않는다. 그래서 이전 뒤에 만든 표는 손으로 적은
 * 허용 목록에 넣어야 하고, 빠뜨리면 검사가 "예상 밖 표"로 종료코드 1을 낸다.
 *
 * 실제로 그 상태였다 — 표 아홉 개가 목록에 없어 `turso:verify`가 늘 빨간불이었고
 * (2026-09-04 실측), 그러면 진짜 스키마 드리프트가 섞여도 묻힌다. 이 테스트는
 * 마이그레이션이 만든 표와 목록을 대조해 같은 일이 다시 생기지 않게 한다.
 */

const AUTH_TABLES = new Set(['user', 'session', 'account', 'verification'])

/** 마이그레이션 SQL 전체에서 CREATE TABLE 대상 이름을 모은다. */
function tablesCreatedByMigrations() {
  const dir = 'src/db/migrations'
  const names = new Set()
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    for (const [, name] of sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?([a-z_][a-z0-9_]*)`?/gi
    )) {
      // 표 재작성이 쓰는 임시 표는 최종 스키마에 남지 않는다.
      if (name.startsWith('__new_') || name.startsWith('__migration')) continue
      names.add(name)
    }
  }
  return names
}

test('컷오버 이후 표 목록이 마이그레이션과 일치한다', () => {
  const snapshot = new Set(Object.keys(loadSnapshot().tables))
  const created = tablesCreatedByMigrations()

  // 스냅샷에도 없고 Better Auth 것도 아닌 표 = 컷오버 이후에 우리가 더한 표.
  const actual = [...created].filter(t => !snapshot.has(t) && !AUTH_TABLES.has(t)).sort()
  const declared = [...POST_CUTOVER_TABLES].sort()

  assert.deepEqual(
    declared,
    actual,
    '표를 새로 만들었으면 scripts/turso/check-schema-parity.mjs의 POST_CUTOVER_TABLES에도 적어라'
  )
})
