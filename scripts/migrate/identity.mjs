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

/** `table`의 실제 컬럼 목록을 PRAGMA로 얻는다. 테이블이 없으면 던진다. */
async function fetchDbColumns(client, table) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const dbCols = info.rows.map(r => String(r.name))
  if (dbCols.length === 0) throw new Error(`테이블이 없다: ${table}`)
  return dbCols
}

/** 이미 가져온 컬럼 목록(dbCols)을 기준으로 행 하나를 검사한다. */
function checkRowCoverage(table, dbCols, row, allowlist) {
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

/**
 * 매핑이 대상 테이블의 컬럼을 전부 덮는지 실제 DB에 물어 확인한다.
 *
 * 소스 텍스트를 훑는 정적 검사는 주석 처리·문자열 리터럴에 속고, 스키마가
 * 바뀌면 조용히 낡는다. PRAGMA는 지금 이 DB의 진짜 컬럼 목록을 준다.
 * 누락은 "조용히 NULL"로만 드러나고 7개 필드가 전부 nullable이라 제약
 * 위반으로도 안 잡히므로, 여기서 막지 못하면 아무 데서도 못 막는다.
 *
 * 행 하나만 검사한다 — 기존 테스트가 이 시그니처로 직접 호출하기 때문에
 * 그대로 둔다. 여러 행을 검사할 때는 아래 assertAllRowsColumnCoverage를
 * 쓴다(PRAGMA를 행마다 다시 부르지 않도록).
 */
export async function assertColumnCoverage(client, table, row, allowlist = []) {
  const dbCols = await fetchDbColumns(client, table)
  checkRowCoverage(table, dbCols, row, allowlist)
}

/**
 * rows 전체에 대해 컬럼 커버리지를 검사한다. PRAGMA는 테이블당 한 번만
 * 부르고 그 결과를 모든 행에 재사용한다.
 *
 * 이전에는 loadIdentity와 CLI dry-run이 rows[0]만 검사했다 — 매퍼가 고정된
 * 키 집합의 객체 리터럴을 내는 오늘은 도달 불가능한 구멍이지만, 이 게이트의
 * 존재 이유가 "미래의 실수로 컬럼이 빠져도 잡아낸다"이므로 index 0에서
 * 멈추면 그 약속을 지키지 못한다.
 */
async function assertAllRowsColumnCoverage(client, table, rows, allowlist = []) {
  if (rows.length === 0) return
  const dbCols = await fetchDbColumns(client, table)
  for (const row of rows) {
    checkRowCoverage(table, dbCols, row, allowlist)
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
    await assertAllRowsColumnCoverage(client, table, rows, INTENTIONALLY_DEFAULTED[table] ?? [])
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
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`${table} 조회 실패: ${res.status}`)
  const rows = await res.json()

  // PostgREST가 count=exact일 때 Content-Range: 0-18/19 형태로 총 행수를
  // 알려준다. 서버 쪽 row limit에 걸리면 200 상태로 짧은 배열만 오는데,
  // 이때 응답 길이와 총량이 어긋나므로 여기서 잡지 못하면 회원이 조용히
  // 누락된 채로 이관된다 — member_profiles는 auth.users 같은 교차검증
  // 대상이 없어 이 검사가 유일한 안전망이다.
  const contentRange = res.headers.get('content-range')
  const total = contentRange ? Number(contentRange.split('/')[1]) : NaN
  if (!Number.isFinite(total) || total !== rows.length) {
    throw new Error(
      `${table}: PostgREST 응답이 ${rows.length}행인데 총량은 ${
        contentRange ?? '알 수 없음'
      } — 잘렸을 수 있다`
    )
  }

  return rows
}

/**
 * CLI 인자를 해석한다. `--dump` 다음에 값이 없거나, 그 값이 `--`로
 * 시작하면(다음 플래그를 삼킨 경우) usage 에러를 던진다.
 * 예: `--dump --apply`는 "--apply"를 파일 경로로 오인해 나중에
 * 알아보기 힘든 ENOENT로 죽는다 — 여기서 미리 막는다.
 */
export function parseArgs(argv) {
  const dumpIndex = argv.indexOf('--dump')
  const dumpPath = dumpIndex === -1 ? undefined : argv[dumpIndex + 1]
  const apply = argv.includes('--apply')
  if (dumpIndex === -1 || !dumpPath || dumpPath.startsWith('--')) {
    throw new Error('usage: node scripts/migrate/identity.mjs --dump <auth.sql> [--apply]')
  }
  return { dumpPath, apply }
}

async function main() {
  let dumpPath, apply
  try {
    ;({ dumpPath, apply } = parseArgs(process.argv.slice(2)))
  } catch (err) {
    console.error(err.message)
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
        await assertAllRowsColumnCoverage(client, table, rows, INTENTIONALLY_DEFAULTED[table] ?? [])
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
