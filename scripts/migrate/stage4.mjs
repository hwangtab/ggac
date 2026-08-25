/**
 * 단계 4: 회원 프로필·콘텐츠·신원(단계 2b/2c에서 이미 Turso 권위) 외
 * "남은 전부" 18표를 Supabase에서 Turso로 옮긴다.
 *
 *   node scripts/migrate/stage4.mjs --dump <public.sql>            (dry-run, 기본)
 *   node scripts/migrate/stage4.mjs --dump <public.sql> --apply --expect table=N,...
 *
 * <public.sql>은 `supabase db dump --schema public --data-only -f <path>`의
 * 산출물이다. event_applications에는 신청자 이름·연락처가, user_sessions에는
 * IP·User-Agent가 들어 있으므로 이 스크립트는 어떤 경우에도 컬럼 값을 화면에
 * 출력하지 않는다(검증 실패 보고는 컬럼 이름과 행 id만 낸다) —
 * content.mjs·identity.mjs와 같은 원칙이다.
 *
 * 이 스크립트는 운영 Supabase에 접속하지 않는다 — 덤프 파일만 읽는다.
 * Turso 쓰기는 --apply를 명시할 때만 일어난다.
 *
 * weekly_activity_stats·active_users_view는 Postgres 뷰다 — 이관 대상이
 * 아니다(다음 단계에서 앱 코드로 재계산한다). member_status_history·
 * member_login_history·error_logs·member_profiles_normalize_log는 운영
 * 실측 결과 빈 표(0행)이거나 브리프의 이관 대상 목록 밖이라 여기서 다루지
 * 않는다(YAGNI).
 */

import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

import { parseInsertRows } from './lib/pgDumpParser.mjs'
import {
  toArtistRow,
  toBoardMeetingRow,
  toBoardAgendaRow,
  toBoardMinuteRow,
  toBoardDocumentRow,
  toBoardMeetingAttendeeRow,
  toBoardMeetingDateOptionRow,
  toBoardMeetingDateVoteRow,
  toSystemSettingRow,
  toSystemSettingsHistoryRow,
  toDefaultSettingRow,
  toUserSettingRow,
  toUserActivityRow,
  toUserSessionRow,
  toDailyActivityStatRow,
  toLinkPreviewRow,
  toEventApplicationRow,
  toMemberBulkOperationRow,
} from './lib/stage4Mapping.mjs'
import { parseArgs } from './identity.mjs'
import { parseExpect, evaluateExpectGate } from './content.mjs'

/**
 * FK 의존 순서.
 *
 * artists는 참조가 없다. board_meetings가 board_agendas·board_minutes·
 * board_documents·board_meeting_attendees·board_meeting_date_options의
 * 대상이고, board_meeting_date_options가 board_meeting_date_votes의
 * 대상이다. system_settings가 system_settings_history의 대상이다.
 * user_activities·user_sessions·daily_activity_stats·user_settings·
 * member_bulk_operations는 전부 member_profiles(단계 2c에서 이미 Turso
 * 권위)를 참조한다 — 이 스크립트는 그 표를 적재하지 않고 참조 무결성만
 * Turso에 물어 확인한다.
 */
export const LOAD_ORDER = [
  ['artists', 'artists'],
  ['board_meetings', 'boardMeetings'],
  ['board_agendas', 'boardAgendas'],
  ['board_minutes', 'boardMinutes'],
  ['board_documents', 'boardDocuments'],
  ['board_meeting_attendees', 'boardMeetingAttendees'],
  ['board_meeting_date_options', 'boardMeetingDateOptions'],
  ['board_meeting_date_votes', 'boardMeetingDateVotes'],
  ['system_settings', 'systemSettings'],
  ['system_settings_history', 'systemSettingsHistory'],
  ['default_settings', 'defaultSettings'],
  ['user_settings', 'userSettings'],
  ['user_activities', 'userActivities'],
  ['user_sessions', 'userSessions'],
  ['daily_activity_stats', 'dailyActivityStats'],
  ['link_previews', 'linkPreviews'],
  ['event_applications', 'eventApplications'],
  ['member_bulk_operations', 'memberBulkOperations'],
]

/** PK 컬럼이 `id`가 아닌 유일한 예외. */
const PK_COLUMN = { link_previews: 'url' }
const pkColumnFor = table => PK_COLUMN[table] ?? 'id'

/**
 * payload 안의 FK 참조 전부. `parentSource: 'external'`은 이 스크립트가
 * 적재하지 않는 member_profiles를 가리킨다 — Turso에서 직접 조회한 id
 * 집합과 대조한다. `'internal'`은 이 payload 안에서 같이 적재하는 표다.
 */
export const REFERENCE_CHECKS = [
  {
    key: 'boardMeetings',
    sqlTable: 'board_meetings',
    column: 'created_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'boardAgendas',
    sqlTable: 'board_agendas',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
  },
  {
    key: 'boardAgendas',
    sqlTable: 'board_agendas',
    column: 'proposed_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'boardMinutes',
    sqlTable: 'board_minutes',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
  },
  {
    key: 'boardMinutes',
    sqlTable: 'board_minutes',
    column: 'author_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'boardDocuments',
    sqlTable: 'board_documents',
    column: 'uploaded_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'boardMeetingAttendees',
    sqlTable: 'board_meeting_attendees',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
  },
  {
    key: 'boardMeetingAttendees',
    sqlTable: 'board_meeting_attendees',
    column: 'member_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'boardMeetingDateOptions',
    sqlTable: 'board_meeting_date_options',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
  },
  {
    key: 'boardMeetingDateVotes',
    sqlTable: 'board_meeting_date_votes',
    column: 'option_id',
    parentKey: 'boardMeetingDateOptions',
    parentSource: 'internal',
  },
  {
    key: 'boardMeetingDateVotes',
    sqlTable: 'board_meeting_date_votes',
    column: 'voter_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'systemSettings',
    sqlTable: 'system_settings',
    column: 'updated_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'systemSettingsHistory',
    sqlTable: 'system_settings_history',
    column: 'setting_id',
    parentKey: 'systemSettings',
    parentSource: 'internal',
  },
  {
    key: 'systemSettingsHistory',
    sqlTable: 'system_settings_history',
    column: 'changed_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'userSettings',
    sqlTable: 'user_settings',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'userActivities',
    sqlTable: 'user_activities',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'userSessions',
    sqlTable: 'user_sessions',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'dailyActivityStats',
    sqlTable: 'daily_activity_stats',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
  },
  {
    key: 'memberBulkOperations',
    sqlTable: 'member_bulk_operations',
    column: 'performed_by',
    parentKey: 'profiles',
    parentSource: 'external',
  },
]

/**
 * payload 안에서 부모 행이 없는 FK를 찾는다. `profileIds`는 Turso의
 * member_profiles에서 직접 읽은 id 집합이다(이 스크립트는 그 표를
 * 적재하지 않는다).
 *
 * content.mjs와 달리 허용 목록이 없다 — 이 18표에 대해 실제 운영 덤프
 * (2026-08-25)로 미리 대조해본 결과 FK 고아가 하나도 없었다(board_*의
 * created_by/proposed_by/author_id/uploaded_by/member_id,
 * system_settings(_history)의 updated_by/changed_by,
 * user_activities/user_sessions/daily_activity_stats의 user_id 전부
 * 0건). "알려진 죽은 데이터를 허용 목록으로 눈감아준다"는 content.mjs의
 * 필요가 여기는 없으므로, 허용 목록·bypass 플래그를 만들지 않고 고아가
 * 하나라도 나오면 무조건 중단한다 — 나중에 실제로 알려진 고아가 발견되면
 * 그때 근거와 함께 허용 목록을 추가한다(YAGNI).
 */
export function findOrphans(payload, profileIds) {
  const internalIdSets = {
    boardMeetings: new Set(payload.boardMeetings.map(r => r.id)),
    systemSettings: new Set(payload.systemSettings.map(r => r.id)),
    boardMeetingDateOptions: new Set(payload.boardMeetingDateOptions.map(r => r.id)),
  }
  const orphans = []
  for (const { key, sqlTable, column, parentKey, parentSource } of REFERENCE_CHECKS) {
    const idSet = parentSource === 'external' ? profileIds : internalIdSets[parentKey]
    for (const row of payload[key]) {
      const fk = row[column]
      if (fk !== null && fk !== undefined && !idSet.has(fk)) {
        orphans.push({ key, table: sqlTable, id: row.id, column, missing: fk })
      }
    }
  }
  return orphans
}

/** `table`의 실제 컬럼 목록을 PRAGMA로 얻는다. 테이블이 없으면 던진다. */
async function fetchDbColumns(client, table) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const dbCols = info.rows.map(r => String(r.name))
  if (dbCols.length === 0) throw new Error(`테이블이 없다: ${table}`)
  return dbCols
}

/**
 * rows 전체에 대해 컬럼 커버리지를 검사한다(content.mjs·identity.mjs와 같은
 * 이유로 첫 행만 보지 않는다 — NULL 때문에 키가 빠진 행을 놓칠 수 있다).
 * PRAGMA는 테이블당 한 번만 부르고 그 결과를 모든 행에 재사용한다.
 */
async function assertAllRowsColumnCoverage(client, table, rows) {
  if (rows.length === 0) return
  const dbCols = await fetchDbColumns(client, table)
  const allowed = new Set(dbCols)
  for (const row of rows) {
    const mapped = new Set(Object.keys(row))
    const missing = dbCols.filter(c => !mapped.has(c))
    if (missing.length > 0) {
      throw new Error(`${table}: 매핑이 빠뜨린 컬럼 ${missing.join(', ')}`)
    }
    const unknown = [...mapped].filter(c => !allowed.has(c))
    if (unknown.length > 0) {
      throw new Error(`${table}: 테이블에 없는 키 ${unknown.join(', ')}`)
    }
  }
}

/**
 * id 충돌 시 전 컬럼을 덮어쓰는 업서트. identity.mjs의 buildUpsert와 같은
 * 모양이지만, link_previews처럼 PK가 `id`가 아닌 표를 위해 pkColumn을
 * 받는다(기본값 'id').
 */
export function buildUpsert(table, row, pkColumn = 'id') {
  const cols = Object.keys(row)
  const quoted = cols.map(c => `"${c}"`).join(', ')
  const holes = cols.map(() => '?').join(', ')
  const updates = cols
    .filter(c => c !== pkColumn)
    .map(c => `"${c}" = excluded."${c}"`)
    .join(', ')
  return {
    sql: `INSERT INTO "${table}" (${quoted}) VALUES (${holes}) ON CONFLICT("${pkColumn}") DO UPDATE SET ${updates}`,
    args: cols.map(c => row[c]),
  }
}

export async function loadStage4({ client, ...payload }) {
  const counts = {}
  for (const [table, key] of LOAD_ORDER) {
    const rows = payload[key]
    await assertAllRowsColumnCoverage(client, table, rows)
    // 테이블 단위 트랜잭션. FK 순서를 지키려면 테이블끼리는 나눠야 한다.
    await client.batch(
      rows.map(r => buildUpsert(table, r, pkColumnFor(table))),
      'write'
    )
    counts[table] = rows.length
  }
  return counts
}

/**
 * 적재된 값을 원본 매핑과 필드 단위로 대조한다. "행 수가 맞다"는 검증이
 * 아니다 — 값이 하나라도 다르면 그 필드를 지목한다. 값 자체는 절대
 * 출력하지 않는다(표 이름·PK 값·컬럼 이름만).
 */
export async function verifyStage4({ client, expected }) {
  const mismatches = []

  for (const [table, key] of LOAD_ORDER) {
    const rows = expected[key]
    const pkCol = pkColumnFor(table)
    const actual = await client.execute(`SELECT * FROM "${table}"`)
    const index = new Map(actual.rows.map(r => [String(r[pkCol]), r]))

    for (const row of rows) {
      const got = index.get(String(row[pkCol]))
      if (!got) {
        mismatches.push(`${table} ${pkCol}=${row[pkCol]}: Turso에 행이 없음`)
        continue
      }
      for (const [col, want] of Object.entries(row)) {
        const have = got[col] === undefined ? null : got[col]
        const bothNull = want === null && have === null
        const equal = bothNull || (want !== null && have !== null && String(want) === String(have))
        if (!equal) {
          mismatches.push(`${table} ${pkCol}=${row[pkCol]} ${col}: 원본과 다름`)
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

/** 파서 결과(snake_case 표 이름) → 매퍼 payload(camelCase 키)로 바꾼다. */
function buildPayload(parsed) {
  return {
    artists: parsed.artists.map(toArtistRow),
    boardMeetings: parsed.board_meetings.map(toBoardMeetingRow),
    boardAgendas: parsed.board_agendas.map(toBoardAgendaRow),
    boardMinutes: parsed.board_minutes.map(toBoardMinuteRow),
    boardDocuments: parsed.board_documents.map(toBoardDocumentRow),
    boardMeetingAttendees: parsed.board_meeting_attendees.map(toBoardMeetingAttendeeRow),
    boardMeetingDateOptions: parsed.board_meeting_date_options.map(toBoardMeetingDateOptionRow),
    boardMeetingDateVotes: parsed.board_meeting_date_votes.map(toBoardMeetingDateVoteRow),
    systemSettings: parsed.system_settings.map(toSystemSettingRow),
    systemSettingsHistory: parsed.system_settings_history.map(toSystemSettingsHistoryRow),
    defaultSettings: parsed.default_settings.map(toDefaultSettingRow),
    userSettings: parsed.user_settings.map(toUserSettingRow),
    userActivities: parsed.user_activities.map(toUserActivityRow),
    userSessions: parsed.user_sessions.map(toUserSessionRow),
    dailyActivityStats: parsed.daily_activity_stats.map(toDailyActivityStatRow),
    linkPreviews: parsed.link_previews.map(toLinkPreviewRow),
    eventApplications: parsed.event_applications.map(toEventApplicationRow),
    memberBulkOperations: parsed.member_bulk_operations.map(toMemberBulkOperationRow),
  }
}

function logOrphanList(list) {
  for (const o of list) {
    console.log(`  ${o.table} id=${o.id} ${o.column} -> 없는 ${o.missing}`)
  }
}

async function main() {
  let dumpPath, apply
  try {
    ;({ dumpPath, apply } = parseArgs(process.argv.slice(2)))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  let expect
  try {
    expect = parseExpect(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  const sql = readFileSync(dumpPath, 'utf8')

  const parsed = {}
  for (const [table] of LOAD_ORDER) {
    parsed[table] = parseInsertRows(sql, 'public', table)
  }
  const parsedCounts = Object.fromEntries(
    LOAD_ORDER.map(([table]) => [table, parsed[table].length])
  )

  console.log('원본: ' + LOAD_ORDER.map(([table]) => `${table} ${parsedCounts[table]}`).join(' / '))

  const gate = evaluateExpectGate({ expect, apply, parsedCounts })
  if (gate.status === 'incomplete_expect') {
    console.error(
      `\n--apply에는 --expect가 ${LOAD_ORDER.length}개 표를 전부 덮어야 한다 — 빠진 표: ${gate.missingTables.join(', ')}`
    )
    console.error(
      '표 하나가 덤프에서 통째로 빠지면 파싱 결과가 조용히 0행이 되고, 그 0행을 ' +
        '기준으로 Turso 검증도 통과해버린다. 빠진 표까지 포함해 --expect table=N,table=N,...을 전부 채워라.'
    )
    process.exitCode = 1
    return
  }
  if (gate.status === 'mismatch') {
    console.error('\n--expect와 파싱 건수가 다르다:')
    for (const [t, n] of gate.mismatches) {
      console.error(`  ${t}: 기대 ${n}, 실제 ${parsedCounts[t] ?? '(알 수 없는 테이블)'}`)
    }
    process.exitCode = 1
    return
  }
  if (gate.status === 'apply_without_expect') {
    console.error(
      '\n--apply에는 --expect가 필수다 — 사람이 미리 실측한 건수 없이는 운영 데이터를 ' +
        '되돌릴 수 없는 쓰기로 진행할 수 없다. --expect table=N,table=N,...을 붙여라.'
    )
    process.exitCode = 1
    return
  }
  if (gate.status === 'matched') {
    console.log('--expect 건수와 일치한다.')
  } else {
    console.log('\n경고: --expect 없이 실행했다(dry-run) — 파싱 건수를 사람이 직접 확인해야 한다.')
  }

  const payload = buildPayload(parsed)

  const client = createClient({
    url: requireEnv('TURSO_DATABASE_URL'),
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  try {
    // member_profiles는 단계 2c에서 이미 Turso 권위다 — 이 스크립트는
    // 그 표를 적재하지 않고 실제 id 집합만 읽어 FK 무결성을 대조한다.
    const profileRows = await client.execute('SELECT id FROM member_profiles')
    const profileIds = new Set(profileRows.rows.map(r => String(r.id)))

    const orphans = findOrphans(payload, profileIds)
    if (orphans.length > 0) {
      console.log(`\nFK 고아 ${orphans.length}건을 찾았다 — 허용 목록이 없으므로 무조건 중단한다:`)
      logOrphanList(orphans)
      console.log(
        '\n원인을 먼저 확인해라 — member_profiles가 이미 Turso 권위이므로, 여기서 나오는 ' +
          '고아는 이 표의 참조가 삭제된 회원을 가리키거나 덤프 시점이 어긋났다는 뜻이다.'
      )
      process.exitCode = 1
      return
    }

    if (!apply) {
      for (const [table, key] of LOAD_ORDER) {
        const rows = payload[key]
        await assertAllRowsColumnCoverage(client, table, rows)
        const cur = await client.execute(`SELECT count(*) c FROM "${table}"`)
        console.log(`  ${table}: 현재 ${cur.rows[0].c}행 → 적재하면 ${rows.length}행`)
      }
      console.log('\ndry-run이다. 실제로 쓰려면 --apply를 붙여라.')
      return
    }

    const counts = await loadStage4({ client, ...payload })
    console.log('적재 완료:', counts)

    const { mismatches } = await verifyStage4({ client, expected: payload })
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
