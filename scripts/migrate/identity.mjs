/**
 * 단계 2b-2: Supabase 신원 데이터를 Turso로 옮긴다.
 *
 *   node scripts/migrate/identity.mjs --dump <auth.sql>            (dry-run, 기본)
 *   node scripts/migrate/identity.mjs --dump <auth.sql> --apply    (쓰기)
 *
 * <auth.sql>은 `supabase db dump --schema auth --data-only -f <path>`의 산출물이며
 * bcrypt 해시와 개인정보를 담는다 — 저장소 밖(스크래치패드)에 두고 작업 후 지운다.
 * 이 스크립트는 어떤 경우에도 해시 값을 출력하지 않는다.
 *
 * Supabase는 읽기만 한다. Turso 쓰기는 --apply를 명시할 때만 일어난다.
 */

import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

import { parseInsertRows } from './lib/pgDumpParser.mjs'
import {
  toArtistRow,
  toUserRow,
  toAccountRow,
  toMemberProfileRow,
  INTENTIONALLY_DEFAULTED,
} from './lib/identityMapping.mjs'

/** FK 순서: account.user_id → user.id. artists는 참조가 없다. */
const LOAD_ORDER = [
  ['artists', 'artists'],
  ['user', 'users'],
  ['account', 'accounts'],
  ['member_profiles', 'profiles'],
]

/**
 * 매핑이 대상 테이블의 컬럼을 전부 덮는지 실제 DB에 물어 확인한다.
 *
 * 소스 텍스트를 훑는 정적 검사는 주석 처리·문자열 리터럴에 속고, 스키마가
 * 바뀌면 조용히 낡는다. PRAGMA는 지금 이 DB의 진짜 컬럼 목록을 준다.
 * 누락은 "조용히 NULL"로만 드러나고 7개 필드가 전부 nullable이라 제약
 * 위반으로도 안 잡히므로, 여기서 막지 못하면 아무 데서도 못 막는다.
 */
export async function assertColumnCoverage(client, table, row, allowlist = []) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const dbCols = info.rows.map(r => String(r.name))
  if (dbCols.length === 0) throw new Error(`테이블이 없다: ${table}`)

  const mapped = new Set(Object.keys(row))
  const allowed = new Set(allowlist)

  const missing = dbCols.filter(c => !mapped.has(c) && !allowed.has(c))
  if (missing.length > 0) {
    throw new Error(`${table}: 매핑이 빠뜨린 컬럼 ${missing.join(', ')}`)
  }

  const unknown = [...mapped].filter(c => !dbCols.includes(c))
  if (unknown.length > 0) {
    throw new Error(`${table}: 테이블에 없는 키 ${unknown.join(', ')}`)
  }
}

/** id 충돌 시 전 컬럼을 덮어쓰는 업서트. 재실행이 행을 늘리지 않는다. */
export function buildUpsert(table, row) {
  const cols = Object.keys(row)
  const quoted = cols.map(c => `"${c}"`).join(', ')
  const holes = cols.map(() => '?').join(', ')
  const updates = cols
    .filter(c => c !== 'id')
    .map(c => `"${c}" = excluded."${c}"`)
    .join(', ')
  return {
    sql: `INSERT INTO "${table}" (${quoted}) VALUES (${holes}) ON CONFLICT("id") DO UPDATE SET ${updates}`,
    args: cols.map(c => row[c]),
  }
}

export async function loadIdentity({ client, artists, users, accounts, profiles }) {
  const byName = { artists, users, accounts, profiles }
  const counts = {}

  for (const [table, key] of LOAD_ORDER) {
    const rows = byName[key]
    if (rows.length > 0) {
      await assertColumnCoverage(client, table, rows[0], INTENTIONALLY_DEFAULTED[table] ?? [])
    }
    // 테이블 단위 트랜잭션. FK 순서를 지키려면 테이블끼리는 나눠야 한다.
    await client.batch(rows.map(r => buildUpsert(table, r)), 'write')
    counts[table] = rows.length
  }

  return counts
}

/**
 * 적재된 값을 원본 매핑과 필드 단위로 대조한다.
 * "행 수가 맞다"는 검증이 아니다 — 값이 하나라도 다르면 그 필드를 지목한다.
 */
export async function verifyIdentity({ client, expected }) {
  const byName = {
    artists: expected.artists,
    users: expected.users,
    accounts: expected.accounts,
    profiles: expected.profiles,
  }
  const mismatches = []

  for (const [table, key] of LOAD_ORDER) {
    const rows = byName[key]
    const actual = await client.execute(`SELECT * FROM "${table}"`)
    const index = new Map(actual.rows.map(r => [String(r.id), r]))

    for (const row of rows) {
      const got = index.get(String(row.id))
      if (!got) {
        mismatches.push(`${table} id=${row.id}: Turso에 행이 없음`)
        continue
      }
      for (const [col, want] of Object.entries(row)) {
        const have = got[col] === undefined ? null : got[col]
        // libsql은 BigInt를 돌려줄 수 있어 느슨하게 비교한다. 단 null과
        // 0/''을 구분해야 하므로 null 여부는 먼저 엄격히 본다.
        const bothNull = want === null && have === null
        const equal = bothNull || (want !== null && have !== null && String(want) === String(have))
        if (!equal) {
          // 값 자체는 출력하지 않는다 — password 컬럼이 여기 포함된다.
          mismatches.push(`${table} id=${row.id} ${col}: 원본과 다름`)
        }
      }
    }

    const extra = actual.rows.length - rows.length
    if (extra !== 0) {
      mismatches.push(`${table}: 행 수 불일치 (Turso ${actual.rows.length} vs 원본 ${rows.length})`)
    }
  }

  return { mismatches }
}

// ---------------------------------------------------------------- CLI

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name}이 설정되지 않았다`)
  return value
}

async function fetchAll(table) {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`${table} 조회 실패: ${res.status}`)
  return res.json()
}

async function main() {
  const args = process.argv.slice(2)
  const dumpPath = args[args.indexOf('--dump') + 1]
  const apply = args.includes('--apply')
  if (!args.includes('--dump') || !dumpPath) {
    console.error('usage: node scripts/migrate/identity.mjs --dump <auth.sql> [--apply]')
    process.exit(1)
  }

  const authUsers = parseInsertRows(readFileSync(dumpPath, 'utf8'), 'auth', 'users')
  const [pgProfiles, pgArtists] = await Promise.all([
    fetchAll('member_profiles'),
    fetchAll('artists'),
  ])

  // 두 출처 교차 검증: 덤프(해시)와 PostgREST(프로필)가 같은 사람 집합을
  // 가리켜야 한다. 파서가 조용히 일부 행을 놓치면 여기서 드러난다.
  const authIds = new Set(authUsers.map(u => u.id))
  const profileIds = new Set(pgProfiles.map(p => p.id))
  const onlyAuth = [...authIds].filter(id => !profileIds.has(id))
  const onlyProfile = [...profileIds].filter(id => !authIds.has(id))
  if (onlyAuth.length || onlyProfile.length) {
    throw new Error(
      `auth.users와 member_profiles의 사용자 집합이 다르다 ` +
        `(덤프에만 ${onlyAuth.length}명, 프로필에만 ${onlyProfile.length}명)`
    )
  }

  const authById = new Map(authUsers.map(u => [u.id, u]))
  const payload = {
    artists: pgArtists.map(toArtistRow),
    users: pgProfiles.map(p => toUserRow(p, authById.get(p.id))),
    accounts: pgProfiles.map(p => toAccountRow(authById.get(p.id))),
    profiles: pgProfiles.map(toMemberProfileRow),
  }

  console.log(
    `원본: auth.users ${authUsers.length} / member_profiles ${pgProfiles.length} / artists ${pgArtists.length}`
  )

  const client = createClient({
    url: requireEnv('TURSO_DATABASE_URL'),
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  try {
    if (!apply) {
      for (const [table, key] of LOAD_ORDER) {
        const rows = payload[key]
        if (rows.length > 0) {
          await assertColumnCoverage(client, table, rows[0], INTENTIONALLY_DEFAULTED[table] ?? [])
        }
        const cur = await client.execute(`SELECT count(*) c FROM "${table}"`)
        console.log(`  ${table}: 현재 ${cur.rows[0].c}행 → 적재하면 ${rows.length}행`)
      }
      console.log('\ndry-run이다. 실제로 쓰려면 --apply를 붙여라.')
      return
    }

    const counts = await loadIdentity({ client, ...payload })
    console.log('적재 완료:', counts)

    const { mismatches } = await verifyIdentity({ client, expected: payload })
    if (mismatches.length > 0) {
      console.error(`\n검증 실패 — 불일치 ${mismatches.length}건:`)
      for (const m of mismatches) console.error('  ' + m)
      process.exitCode = 1
      return
    }
    console.log('검증 통과: 모든 필드가 원본과 일치한다.')
  } finally {
    client.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
