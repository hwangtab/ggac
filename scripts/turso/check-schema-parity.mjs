import { readFileSync } from 'node:fs'

const BETTER_AUTH_TABLES = new Set(['user', 'session', 'account', 'verification'])

/**
 * 컷오버 **이후에** 생긴 표.
 *
 * 이 검사는 옛 Postgres 스냅샷(`pg-schema-snapshot.json`)과 대조해 "이전에서
 * 무엇이 빠졌는가"를 본다. 그 스냅샷은 역사 기록이라 더 이상 늘지 않으므로,
 * 이전 뒤에 새로 만든 표는 **영원히 "예상 밖"으로 잡힌다.** 실제로 그 상태로
 * 종료코드 1을 내고 있었고(2026-09-04 실측), 그러면 `turso:verify`가 항상
 * 빨간불이라 진짜 드리프트가 섞여도 아무도 알아채지 못한다.
 *
 * 그래서 표를 새로 만들면 **여기에 손으로 적는다.** 자동으로 통과시키지 않는
 * 이유는 이 목록이 "이전과 무관하게 우리가 의도적으로 더한 표"의 기록이어야
 * 하기 때문이다 — 빠뜨리면 검사가 알려 준다.
 *
 * 빠진 표·컬럼 검사(`missingTables`/`missingColumns`)는 그대로 유효하다.
 * 그쪽이 이 검사의 본래 목적이다.
 */
const POST_CUTOVER_TABLES = new Set([
  'payments', // 0006 조합비 결제
  'membership_dues', // 0006
  'billing_keys', // 0008 자동결제 카드
  'board_agenda_comments', // 0009 안건 토론
  'grant_digests', // 0010 지원사업 다이제스트
  'performances', // 0016 공연 예매
  'performance_shows', // 0016
  'ticket_types', // 0016
  'reservations', // 0016
])

export function comparePgToSqlite(pgSnapshot, sqliteSchema) {
  const missingTables = []
  const missingColumns = []

  for (const [table, columns] of Object.entries(pgSnapshot.tables)) {
    const actual = sqliteSchema[table]
    if (!actual) {
      missingTables.push(table)
      continue
    }
    const actualSet = new Set(actual)
    for (const column of columns) {
      if (!actualSet.has(column)) missingColumns.push({ table, column })
    }
  }

  const expected = new Set(Object.keys(pgSnapshot.tables))
  const extraTables = Object.keys(sqliteSchema).filter(
    t => !expected.has(t) && !BETTER_AUTH_TABLES.has(t) && !POST_CUTOVER_TABLES.has(t)
  )

  return { missingTables, missingColumns, extraTables, checkedTableCount: expected.size }
}

export { POST_CUTOVER_TABLES }

export function loadSnapshot(path = 'scripts/turso/pg-schema-snapshot.json') {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function formatReport({ missingTables, missingColumns, extraTables, checkedTableCount }) {
  const lines = []
  if (missingTables.length) lines.push(`빠진 테이블: ${missingTables.join(', ')}`)
  for (const { table, column } of missingColumns) {
    lines.push(`빠진 컬럼: ${table}.${column}`)
  }
  if (extraTables.length) lines.push(`예상 밖 테이블: ${extraTables.join(', ')}`)
  return lines.length ? lines.join('\n') : `패리티 통과: ${checkedTableCount}개 테이블 전 컬럼 일치`
}
