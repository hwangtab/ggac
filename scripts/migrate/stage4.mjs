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

import { parseInsertRows, parseInsertColumns } from './lib/pgDumpParser.mjs'
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
import { parseArgs, buildUpsert } from './identity.mjs'
import { parseExpect, evaluateExpectGate } from './content.mjs'

export { buildUpsert }

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

/** 한 번에 보내는 쓰기 문 수. 11,083행짜리 user_activities를 단일
 * client.batch()로 던지면 12MB짜리 HTTP 요청 하나가 되고, libsql은 청크도
 * 재시도도 하지 않는다. 업서트가 멱등이라 쪼개도 비용이 없다. */
const WRITE_CHUNK_SIZE = 500

/** 검증 단계에서 한 번에 읽어오는 행 수. 11k행을 SELECT * 한 방으로
 * 끌어오지 않고 페이지네이션한다. */
const SELECT_PAGE_SIZE = 1000

/**
 * payload 안의 FK 참조 전부. `parentSource: 'external'`은 이 스크립트가
 * 적재하지 않는 member_profiles를 가리킨다 — Turso에서 직접 조회한 id
 * 집합과 대조한다. `'internal'`은 이 payload 안에서 같이 적재하는 표다.
 * `nullable`은 Turso(Drizzle) 스키마의 실제 제약이다 — `--null-orphan-fk`가
 * NOT NULL 컬럼에 쓰이는 걸 막는 데 쓴다(board_meeting_attendees.member_id
 * 등은 false).
 */
export const REFERENCE_CHECKS = [
  {
    key: 'boardMeetings',
    sqlTable: 'board_meetings',
    column: 'created_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'boardAgendas',
    sqlTable: 'board_agendas',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
    nullable: false,
  },
  {
    key: 'boardAgendas',
    sqlTable: 'board_agendas',
    column: 'proposed_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'boardMinutes',
    sqlTable: 'board_minutes',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
    nullable: false,
  },
  {
    key: 'boardMinutes',
    sqlTable: 'board_minutes',
    column: 'author_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'boardDocuments',
    sqlTable: 'board_documents',
    column: 'uploaded_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'boardMeetingAttendees',
    sqlTable: 'board_meeting_attendees',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
    nullable: false,
  },
  {
    key: 'boardMeetingAttendees',
    sqlTable: 'board_meeting_attendees',
    column: 'member_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: false,
  },
  {
    key: 'boardMeetingDateOptions',
    sqlTable: 'board_meeting_date_options',
    column: 'meeting_id',
    parentKey: 'boardMeetings',
    parentSource: 'internal',
    nullable: false,
  },
  {
    key: 'boardMeetingDateVotes',
    sqlTable: 'board_meeting_date_votes',
    column: 'option_id',
    parentKey: 'boardMeetingDateOptions',
    parentSource: 'internal',
    nullable: false,
  },
  {
    key: 'boardMeetingDateVotes',
    sqlTable: 'board_meeting_date_votes',
    column: 'voter_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: false,
  },
  {
    key: 'systemSettings',
    sqlTable: 'system_settings',
    column: 'updated_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'systemSettingsHistory',
    sqlTable: 'system_settings_history',
    column: 'setting_id',
    parentKey: 'systemSettings',
    parentSource: 'internal',
    nullable: true,
  },
  {
    key: 'systemSettingsHistory',
    sqlTable: 'system_settings_history',
    column: 'changed_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'userSettings',
    sqlTable: 'user_settings',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: false,
  },
  {
    key: 'userActivities',
    sqlTable: 'user_activities',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'userSessions',
    sqlTable: 'user_sessions',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'dailyActivityStats',
    sqlTable: 'daily_activity_stats',
    column: 'user_id',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: true,
  },
  {
    key: 'memberBulkOperations',
    sqlTable: 'member_bulk_operations',
    column: 'performed_by',
    parentKey: 'profiles',
    parentSource: 'external',
    nullable: false,
  },
]

/**
 * payload 안에서 부모 행이 없는 FK를 찾는다. `profileIds`는 Turso의
 * member_profiles에서 직접 읽은 id 집합이다(이 스크립트는 그 표를
 * 적재하지 않는다).
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

/**
 * `--null-orphan-fk table.column,table.column,...`를 파싱한다. 없으면
 * 빈 Set — 기본값은 "고아를 하나도 허용하지 않는다"이다.
 */
export function parseNullOrphanFk(argv) {
  const idx = argv.indexOf('--null-orphan-fk')
  if (idx === -1) return new Set()
  const raw = argv[idx + 1]
  if (!raw || raw.startsWith('--')) {
    throw new Error('usage: --null-orphan-fk table.column,table.column,...')
  }
  return new Set(raw.split(','))
}

/**
 * `--null-orphan-fk`가 가리키는 표.컬럼이 REFERENCE_CHECKS가 아는 FK이고
 * nullable인지 확인한다. 모르는 표.컬럼이거나 NOT NULL 컬럼(예:
 * board_meeting_attendees.member_id)이면 던진다 — 어차피 SQLite가 NOT
 * NULL 위반으로 막겠지만, 그 실패가 적재 중간(청크 일부가 이미 커밋된
 * 뒤)이 아니라 시작 전에 분명한 메시지로 나오게 한다.
 */
export function validateNullOrphanFk(requested) {
  const known = new Map(REFERENCE_CHECKS.map(c => [`${c.sqlTable}.${c.column}`, c.nullable]))
  for (const key of requested) {
    if (!known.has(key)) {
      throw new Error(`--null-orphan-fk: 알 수 없는 표.컬럼이다: ${key}`)
    }
    if (known.get(key) === false) {
      throw new Error(`--null-orphan-fk: ${key}은 NOT NULL 컬럼이라 쓸 수 없다`)
    }
  }
}

/**
 * 고아를 정책에 따라 나눈다. `--null-orphan-fk`에 없는 표.컬럼의 고아는
 * `disallowed`로 돌려주고(호출부가 중단해야 한다), 지정된 고아는 그 FK
 * 컬럼만 null로 낮춘 payload 사본을 돌려준다 — **행 자체는 지우지
 * 않는다**(Postgres가 걸어둔 ON DELETE set null과 같은 결과: 활동 기록은
 * 남고 참조만 끊긴다). 기본값(빈 Set)이면 모든 고아가 disallowed로
 * 떨어져 예전과 같이 무조건 중단한다.
 */
export function resolveOrphans(payload, orphans, nullOrphanFkSet) {
  const disallowed = orphans.filter(o => !nullOrphanFkSet.has(`${o.table}.${o.column}`))
  if (disallowed.length > 0) {
    return { ok: false, disallowed }
  }
  if (orphans.length === 0) {
    return { ok: true, payload, nulledCounts: {} }
  }

  const toNullByKey = new Map() // payload key -> Map(rowId -> Set(column))
  for (const o of orphans) {
    if (!toNullByKey.has(o.key)) toNullByKey.set(o.key, new Map())
    const rowMap = toNullByKey.get(o.key)
    if (!rowMap.has(o.id)) rowMap.set(o.id, new Set())
    rowMap.get(o.id).add(o.column)
  }

  const out = { ...payload }
  for (const [key, rowMap] of toNullByKey) {
    out[key] = payload[key].map(row => {
      const cols = rowMap.get(row.id)
      if (!cols) return row
      const patched = { ...row }
      for (const c of cols) patched[c] = null
      return patched
    })
  }

  const nulledCounts = {}
  for (const o of orphans) {
    const k = `${o.table}.${o.column}`
    nulledCounts[k] = (nulledCounts[k] ?? 0) + 1
  }
  return { ok: true, payload: out, nulledCounts }
}

/** `table`의 실제 컬럼 목록을 PRAGMA로 얻는다. 테이블이 없으면 던진다. */
async function fetchDbColumns(client, table) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const dbCols = info.rows.map(r => String(r.name))
  if (dbCols.length === 0) throw new Error(`테이블이 없다: ${table}`)
  return dbCols
}

/**
 * rows 전체에 대해 Turso 쪽 컬럼 커버리지를 검사한다(content.mjs·
 * identity.mjs와 같은 이유로 첫 행만 보지 않는다 — NULL 때문에 키가 빠진
 * 행을 놓칠 수 있다). PRAGMA는 테이블당 한 번만 부르고 그 결과를 모든
 * 행에 재사용한다.
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
 * rows 전체에 대해 **Postgres 덤프 쪽** 컬럼 커버리지를 검사한다.
 * 위의 `assertAllRowsColumnCoverage`(Turso PRAGMA vs 매퍼)와 반대 방향이다
 * — Postgres에는 있는데 Turso 스키마에도 매퍼에도 없는 컬럼은 두 게이트를
 * 전부 통과하고 출력 한 줄 없이 사라질 수 있었다. `dumpCols`가 null이면
 * (그 표에 대한 INSERT 자체가 덤프에 없다 — 운영 0행) 검사할 게 없다.
 */
export function assertDumpColumnsCovered(table, dumpCols, mappedRows) {
  if (!dumpCols) return
  for (const row of mappedRows) {
    const mapped = new Set(Object.keys(row))
    const missing = dumpCols.filter(c => !mapped.has(c))
    if (missing.length > 0) {
      throw new Error(`${table}: Postgres 덤프에는 있는데 매퍼가 빠뜨린 컬럼 ${missing.join(', ')}`)
    }
  }
}

/**
 * 대용량 표(user_activities 11,083행 등)를 WRITE_CHUNK_SIZE 단위로 나눠
 * 적재한다. 업서트가 멱등이라 청크 하나가 실패해도 재실행이 안전하다.
 * 청크가 둘 이상일 때만 진행 상황을 찍는다(작은 표는 조용히).
 */
export async function loadStage4({ client, ...payload }) {
  const counts = {}
  for (const [table, key] of LOAD_ORDER) {
    const rows = payload[key]
    await assertAllRowsColumnCoverage(client, table, rows)
    const pkCol = pkColumnFor(table)

    let loaded = 0
    for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + WRITE_CHUNK_SIZE)
      await client.batch(
        chunk.map(r => buildUpsert(table, r, pkCol)),
        'write'
      )
      loaded += chunk.length
      if (rows.length > WRITE_CHUNK_SIZE) {
        console.log(`  ${table}: ${loaded}/${rows.length}행 적재됨`)
      }
    }
    counts[table] = rows.length
  }
  return counts
}

/** SELECT_PAGE_SIZE 단위로 표 전체를 읽는다(단일 대형 응답을 피한다). */
async function fetchAllRows(client, table) {
  const pkCol = pkColumnFor(table)
  const rows = []
  let offset = 0
  while (true) {
    const res = await client.execute({
      sql: `SELECT * FROM "${table}" ORDER BY "${pkCol}" LIMIT ? OFFSET ?`,
      args: [SELECT_PAGE_SIZE, offset],
    })
    if (res.rows.length === 0) break
    rows.push(...res.rows)
    offset += res.rows.length
    if (res.rows.length < SELECT_PAGE_SIZE) break
  }
  return rows
}

/**
 * 적재된 값을 원본 매핑과 필드 단위로 대조한다. "행 수가 맞다"는 검증이
 * 아니다 — 값이 하나라도 다르면 그 필드를 지목한다. 값 자체는 절대
 * 출력하지 않는다(표 이름·PK 값·컬럼 이름만). 대형 표는 페이지네이션해
 * 읽는다(단일 SELECT *로 11k행을 한 응답에 끌어오지 않는다).
 */
export async function verifyStage4({ client, expected }) {
  const mismatches = []

  for (const [table, key] of LOAD_ORDER) {
    const rows = expected[key]
    const pkCol = pkColumnFor(table)
    const actualRows = await fetchAllRows(client, table)
    const index = new Map(actualRows.map(r => [String(r[pkCol]), r]))

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

    const extra = actualRows.length - rows.length
    if (extra !== 0) {
      mismatches.push(`${table}: 행 수 불일치 (Turso ${actualRows.length} vs 원본 ${rows.length})`)
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

  let nullOrphanFk
  try {
    nullOrphanFk = parseNullOrphanFk(process.argv.slice(2))
    validateNullOrphanFk(nullOrphanFk)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  const sql = readFileSync(dumpPath, 'utf8')

  const parsed = {}
  const dumpCols = {}
  for (const [table] of LOAD_ORDER) {
    parsed[table] = parseInsertRows(sql, 'public', table)
    dumpCols[table] = parseInsertColumns(sql, 'public', table)
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

  let payload = buildPayload(parsed)

  // Postgres 덤프 컬럼 ⊆ 매퍼 키. Turso PRAGMA 커버리지 게이트와 반대
  // 방향이라 DB 연결 전에, 순수 계산만으로 검사한다.
  for (const [table, key] of LOAD_ORDER) {
    assertDumpColumnsCovered(table, dumpCols[table], payload[key])
  }

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
      const resolved = resolveOrphans(payload, orphans, nullOrphanFk)
      if (!resolved.ok) {
        console.log(`\nFK 고아 ${resolved.disallowed.length}건(허용되지 않음)을 찾았다 — 중단한다:`)
        logOrphanList(resolved.disallowed)
        console.log(
          '\n원인을 먼저 확인해라 — member_profiles가 이미 Turso 권위이므로, 여기서 나오는 ' +
            '고아는 이 표의 참조가 삭제된 회원을 가리키거나 덤프 시점이 어긋났다는 뜻이다. ' +
            'nullable 컬럼이라면 --null-orphan-fk table.column으로 그 컬럼만 null로 낮추고 ' +
            '(행은 지우지 않고) 진행할 수 있다.'
        )
        process.exitCode = 1
        return
      }
      if (orphans.length > 0) {
        console.log(
          `\nFK 고아 ${orphans.length}건을 --null-orphan-fk 지정에 따라 해당 컬럼만 null로 낮췄다:`
        )
        for (const [k, n] of Object.entries(resolved.nulledCounts)) {
          console.log(`  ${k}: ${n}행`)
        }
      }
      payload = resolved.payload
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
