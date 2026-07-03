// 코드의 Supabase 호출(추출기)과 운영 스키마 스냅샷을 대조한다.
// 없는 테이블·컬럼·RPC 참조는 배포 전에 잡아야 하는 위반이다.
// 사용법: node scripts/testing/check-schema-contract.mjs
import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractCallsFromSource } from './extract-supabase-calls.mjs'

const root = process.cwd()

export function checkContract(usages, snapshot, allowlist) {
  const violations = []
  const allowTables = new Set(allowlist.tables ?? [])
  const allowRpcs = new Set(allowlist.rpcs ?? [])
  const allowCols = allowlist.columns ?? {}

  const checkColumns = (usage, table, columns) => {
    const known = snapshot.tables[table]
    if (!known) return // 테이블 자체가 없으면 별도 위반으로 처리됨
    const allowed = new Set(allowCols[table] ?? [])
    for (const col of columns) {
      if (!known.includes(col) && !allowed.has(col)) {
        violations.push({
          file: usage.file, line: usage.line, kind: 'column',
          detail: `${table}.${col} — 스냅샷에 없는 컬럼`,
        })
      }
    }
  }

  for (const usage of usages) {
    if (usage.rpc) {
      if (!snapshot.rpcs.includes(usage.rpc) && !allowRpcs.has(usage.rpc)) {
        violations.push({
          file: usage.file, line: usage.line, kind: 'rpc',
          detail: `rpc ${usage.rpc} — 스냅샷에 없는 함수`,
        })
      }
      continue
    }
    if (!(usage.table in snapshot.tables) && !allowTables.has(usage.table)) {
      violations.push({
        file: usage.file, line: usage.line, kind: 'table',
        detail: `${usage.table} — 스냅샷에 없는 테이블`,
      })
      continue
    }
    checkColumns(usage, usage.table, usage.columns)
    for (const rel of usage.relations ?? []) {
      // 관계명이 실제 테이블일 때만 검사한다. FK 별칭이면 검증 불가 → 통과.
      if (rel.name in snapshot.tables) checkColumns(usage, rel.name, rel.columns)
    }
  }
  return violations
}

async function main() {
  const snapshotPath = join(root, 'scripts/testing/schema-snapshot.json')
  if (!existsSync(snapshotPath)) {
    console.error('schema-snapshot.json이 없습니다. 먼저 `npm run schema:snapshot`을 실행하세요.')
    process.exit(1)
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const allowlistPath = join(root, 'scripts/testing/schema-contract-allowlist.json')
  const allowlist = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
    : { tables: [], columns: {}, rpcs: [] }

  const files = globSync('src/**/*.{ts,tsx}', {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  })
  const allUsages = []
  const allSkips = []
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
    if (!source.includes('.from(') && !source.includes('.rpc(')) continue
    const { usages, skips } = extractCallsFromSource(source, file)
    allUsages.push(...usages)
    allSkips.push(...skips)
  }

  const violations = checkContract(allUsages, snapshot, allowlist)

  console.log(`검사 대상: ${allUsages.length}개 호출 (${files.length}개 파일)`)
  if (allSkips.length) {
    console.log(`\n정적 검사 불가(수동 확인 필요) ${allSkips.length}건:`)
    for (const s of allSkips) console.log(`  - ${s.file}:${s.line} ${s.reason}`)
  }
  if (violations.length) {
    console.error(`\n스키마 계약 위반 ${violations.length}건:`)
    for (const v of violations) console.error(`  ✗ ${v.file}:${v.line} [${v.kind}] ${v.detail}`)
    process.exit(1)
  }
  console.log('\n스키마 계약 위반 없음 ✓')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
