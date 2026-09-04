/**
 * 모든 마이그레이션이 **원자적으로** 적용되는지 못박는다.
 *
 * 이 저장소는 `drizzle-kit migrate`를 쓰지 않고 파일을 통째로
 * `executeMultiple()`로 적용한다. 그 함수는 **문마다 자동 커밋**하므로,
 * 파일 안에 `BEGIN`/`COMMIT`이 없으면 중간 실패가 앞 문들을 그대로 남긴다.
 * 그 반쪽 상태는 재실행으로 복구되지 않는다.
 *
 * 실측(2026-09-01) — 트랜잭션이 없던 시절의 `0006`:
 *   두 번째 표가 이미 있는 DB에 적용 → 첫 표만 만들어진 채 실패
 *   다시 적용 → 이번엔 그 첫 표 때문에 실패 (손으로 DROP하기 전까지 영구 교착)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { migrationFiles, applyMigrations } from './apply-migrations.mjs'

test('DDL이 둘 이상인 마이그레이션은 전부 트랜잭션으로 감싸여 있다', () => {
  const offenders = []
  for (const file of migrationFiles()) {
    const sql = readFileSync(file, 'utf8')
    // 주석을 제외한 실제 DDL/DML 문만 센다.
    const statements = sql
      .split('\n')
      .filter(l => /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(l)).length
    if (statements > 1 && !/^\s*BEGIN;\s*$/m.test(sql)) {
      offenders.push(`${file.split('/').pop()} (문 ${statements}개)`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `트랜잭션 없는 다중 문 마이그레이션: ${offenders.join(', ')} — ` +
      '중간 실패가 반쪽 상태로 남고 재실행으로 복구되지 않는다'
  )
})

test('중간 실패는 아무것도 남기지 않는다 (0006으로 실증)', async () => {
  const c = createClient({ url: ':memory:' })
  try {
    // 0006 직전까지 적용한 뒤, 0006의 두 번째 표를 미리 만들어 충돌을 유도한다.
    for (const file of migrationFiles()) {
      if (file.includes('0006')) break
      await c.executeMultiple(readFileSync(file, 'utf8'))
    }
    await c.execute('CREATE TABLE payments (id text PRIMARY KEY)')

    const sql = readFileSync(
      migrationFiles().find(f => f.includes('0006')),
      'utf8'
    )
    await assert.rejects(() => c.executeMultiple(sql), /already exists/)

    // 첫 표가 남아 있으면 재실행으로 복구되지 않는 교착이 된다.
    const leftovers = await c.execute(
      "SELECT name FROM sqlite_master WHERE name IN ('membership_dues','membership_dues_user_month_idx')"
    )
    assert.deepEqual(
      leftovers.rows.map(r => r.name),
      [],
      '실패한 마이그레이션이 잔재를 남기면 손으로 DROP해야 복구된다'
    )
  } finally {
    c.close()
  }
})

test('트랜잭션을 씌운 뒤에도 처음부터 적용이 정상이다', async () => {
  const c = createClient({ url: ':memory:' })
  try {
    await applyMigrations(c)
    const tables = await c.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    const indexes = await c.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    )
    const junk = await c.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '__migration_%' OR name LIKE '__new_%'"
    )
    assert.equal(Number(tables.rows[0].n), 38, '운영과 같은 표 수여야 한다')
    // 23(0004·0005) + 4(0017: 결제 원장·회비 청구월·회의 목록·세션 로그인 시각).
    assert.equal(Number(indexes.rows[0].n), 27, '운영과 같은 성능 인덱스 수여야 한다')
    assert.equal(Number(junk.rows[0].n), 0, '임시 표가 남으면 안 된다')
  } finally {
    c.close()
  }
})
