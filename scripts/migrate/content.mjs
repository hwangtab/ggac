/**
 * 단계 2c: 회원 프로필과 콘텐츠 6테이블을 Supabase에서 Turso로 옮긴다.
 *
 *   node scripts/migrate/content.mjs --dump <public.sql>            (dry-run, 기본)
 *   node scripts/migrate/content.mjs --dump <public.sql> --apply    (쓰기)
 *
 * <public.sql>은 `supabase db dump --schema public --data-only -f <path>`의
 * 산출물이다. member_profiles에는 계좌번호·전화번호·생년월일이 들어 있으므로
 * 이 스크립트는 어떤 경우에도 컬럼 값을 화면에 출력하지 않는다(검증 실패
 * 보고는 컬럼 이름과 행 id만 낸다) — identity.mjs의 verifyIdentity와 같은
 * 원칙이다.
 *
 * 이 스크립트는 운영 Supabase에 접속하지 않는다 — 덤프 파일만 읽는다.
 * Turso 쓰기는 --apply를 명시할 때만 일어난다.
 */

import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

import { parseInsertRows } from './lib/pgDumpParser.mjs'
import {
  toPostRow,
  toCommentRow,
  toPostLikeRow,
  toCommentLikeRow,
  toPostAttachmentRow,
  toNotificationRow,
  toMemberProfileRow,
} from './lib/contentMapping.mjs'
import { buildUpsert, parseArgs } from './identity.mjs'

/**
 * FK 의존 순서. member_profiles가 posts.author_id 등 나머지 전부의
 * 대상이고, posts가 comments·post_likes·post_attachments의 대상이며,
 * comments가 comment_likes의 대상이다.
 */
export const LOAD_ORDER = [
  ['member_profiles', 'profiles'],
  ['posts', 'posts'],
  ['comments', 'comments'],
  ['post_likes', 'postLikes'],
  ['comment_likes', 'commentLikes'],
  ['post_attachments', 'postAttachments'],
  ['notifications', 'notifications'],
]

/** 좋아요 재계산 대상: 저장 테이블 → 좋아요 테이블·FK 컬럼. */
const LIKE_COUNT_SOURCES = {
  posts: { likesTable: 'post_likes', fkColumn: 'post_id' },
  comments: { likesTable: 'comment_likes', fkColumn: 'comment_id' },
}

/**
 * payload 안의 FK 참조 전부. key는 payload 객체의 키, sqlTable은 실제
 * Turso 테이블명(보고용), parentKey는 부모 id 집합을 찾을 payload 키다.
 */
export const REFERENCE_CHECKS = [
  { key: 'posts', sqlTable: 'posts', column: 'author_id', parentKey: 'profiles' },
  { key: 'comments', sqlTable: 'comments', column: 'post_id', parentKey: 'posts' },
  { key: 'comments', sqlTable: 'comments', column: 'author_id', parentKey: 'profiles' },
  { key: 'postLikes', sqlTable: 'post_likes', column: 'post_id', parentKey: 'posts' },
  { key: 'postLikes', sqlTable: 'post_likes', column: 'user_id', parentKey: 'profiles' },
  { key: 'commentLikes', sqlTable: 'comment_likes', column: 'comment_id', parentKey: 'comments' },
  { key: 'commentLikes', sqlTable: 'comment_likes', column: 'user_id', parentKey: 'profiles' },
  { key: 'postAttachments', sqlTable: 'post_attachments', column: 'post_id', parentKey: 'posts' },
  { key: 'notifications', sqlTable: 'notifications', column: 'user_id', parentKey: 'profiles' },
]

/**
 * payload 안에서 부모 행이 없는 FK를 찾는다.
 *
 * SQLite(Turso 스키마)는 FK를 실제로 강제한다 — Postgres 쪽에서 선언된
 * `ON DELETE CASCADE`가 운영에서 실제로 걸려 있었다면 애초에 존재할 수
 * 없는 행이다. 실측 결과 운영 덤프에 이런 행이 있다(post_likes 21건 중
 * 8건, comment_likes 1건 중 1건이 이미 지워진 posts/comments를 가리킨다)
 * — 마이그레이션 드리프트로 Postgres FK가 실제로는 걸려 있지 않았을
 * 가능성이 높다. 이 스크립트가 만드는 문제가 아니라 원본 데이터의 문제이므로
 * 조용히 삼키지 않고 여기서 전부 드러낸다.
 */
export function findOrphans(payload) {
  const idSets = {
    profiles: new Set(payload.profiles.map(r => r.id)),
    posts: new Set(payload.posts.map(r => r.id)),
    comments: new Set(payload.comments.map(r => r.id)),
  }
  const orphans = []
  for (const { key, sqlTable, column, parentKey } of REFERENCE_CHECKS) {
    const idSet = idSets[parentKey]
    for (const row of payload[key]) {
      const fk = row[column]
      if (fk !== null && fk !== undefined && !idSet.has(fk)) {
        orphans.push({ key, table: sqlTable, id: row.id, column, missing: fk })
      }
    }
  }
  return orphans
}

/** orphans에 걸린 행을 payload에서 제외한 사본을 돌려준다. */
export function excludeOrphans(payload, orphans) {
  const skipIdsByKey = new Map()
  for (const o of orphans) {
    if (!skipIdsByKey.has(o.key)) skipIdsByKey.set(o.key, new Set())
    skipIdsByKey.get(o.key).add(o.id)
  }
  const out = { ...payload }
  for (const [key, skipIds] of skipIdsByKey) {
    out[key] = payload[key].filter(r => !skipIds.has(r.id))
  }
  return out
}

/**
 * 실측(2026-08-24)으로 확인된 FK 고아는 딱 두 종류뿐이다:
 * post_likes.post_id, comment_likes.comment_id. 둘 다 "이미 지워진
 * 게시글/댓글에 달렸던 좋아요"라 어디에도 표시되지 않는 죽은 데이터다 —
 * like_count 재계산이 실제 존재하는 post_likes/comment_likes 행만 세므로
 * 이 좋아요는 어떤 카운트에도 잡히지 않고, 좋아요를 누른 게시글/댓글 자체가
 * 없으니 취소할 화면도 없다. 이 두 종류만 사람이 확인한 뒤
 * --drop-known-orphan-likes로 명시적으로 버릴 수 있다.
 *
 * 이 목록 밖의 고아(예: member_profiles 누락으로 posts.author_id가
 * 끊기는 경우)는 성격이 다르다 — 회원 한 명이 덤프에서 빠지면 그 사람의
 * 게시글·댓글·알림 전체가 조용히 사라질 수 있다. 그런 고아는 플래그와
 * 무관하게 항상 중단한다.
 */
const KNOWN_ORPHAN_ALLOWLIST = [
  { key: 'postLikes', column: 'post_id' },
  { key: 'commentLikes', column: 'comment_id' },
]

function isKnownOrphan(o) {
  return KNOWN_ORPHAN_ALLOWLIST.some(a => a.key === o.key && a.column === o.column)
}

/**
 * findOrphans + 허용 목록 정책 + 제외 후 캐스케이드 재검사를 한 번에
 * 처리한다. CLI(main)와 테스트가 같은 로직을 쓴다.
 *
 * 반환:
 *   { ok: true,  payload, orphans, skipped }                     — 진행 가능
 *   { ok: false, reason: 'unknown_orphans', orphans, unknown }    — 허용 목록 밖 고아, 플래그 무관 중단
 *   { ok: false, reason: 'known_orphans_need_flag', orphans }     — 알려진 고아뿐이지만 플래그 없음
 *   { ok: false, reason: 'residual_after_exclude', orphans, residual } — 제외 후에도 고아가 남음(캐스케이드 안전망)
 */
export function resolveOrphans(payload, { dropKnownOrphanLikes }) {
  const orphans = findOrphans(payload)
  if (orphans.length === 0) {
    return { ok: true, payload, orphans: [], skipped: 0 }
  }

  const unknown = orphans.filter(o => !isKnownOrphan(o))
  if (unknown.length > 0) {
    return { ok: false, reason: 'unknown_orphans', orphans, unknown }
  }

  if (!dropKnownOrphanLikes) {
    return { ok: false, reason: 'known_orphans_need_flag', orphans }
  }

  const filtered = excludeOrphans(payload, orphans)
  // 캐스케이드 안전망: 제외가 다른 고아를 만들어내지 않았는지 다시 확인한다.
  // 지금 허용 목록은 자식이 없는 leaf 테이블(post_likes/comment_likes)만
  // 담고 있어 이 경로가 실제로 걸릴 일은 없지만, 허용 목록이 앞으로
  // 넓어져도 조용히 반쪽 적재로 이어지지 않게 막는다. 여기서 또 지우는
  // 방향(캐스케이드)으로 가지 않고 중단한다 — 데이터를 더 지우는 자동화는
  // 위험하다.
  const residual = findOrphans(filtered)
  if (residual.length > 0) {
    return { ok: false, reason: 'residual_after_exclude', orphans, residual }
  }

  return { ok: true, payload: filtered, orphans, skipped: orphans.length }
}

/** `table`의 실제 컬럼 목록을 PRAGMA로 얻는다. 테이블이 없으면 던진다. */
async function fetchDbColumns(client, table) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const dbCols = info.rows.map(r => String(r.name))
  if (dbCols.length === 0) throw new Error(`테이블이 없다: ${table}`)
  return dbCols
}

/**
 * rows 전체에 대해 컬럼 커버리지를 검사한다(identity.mjs와 동일한 이유로
 * 첫 행만 보지 않는다 — NULL 때문에 키가 빠진 행을 놓칠 수 있다). PRAGMA는
 * 테이블당 한 번만 부르고 그 결과를 모든 행에 재사용한다.
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

export async function loadContent({
  client,
  profiles,
  posts,
  comments,
  postLikes,
  commentLikes,
  postAttachments,
  notifications,
}) {
  const byName = {
    profiles,
    posts,
    comments,
    postLikes,
    commentLikes,
    postAttachments,
    notifications,
  }
  const counts = {}

  for (const [table, key] of LOAD_ORDER) {
    const rows = byName[key]
    await assertAllRowsColumnCoverage(client, table, rows)
    // 테이블 단위 트랜잭션. FK 순서를 지키려면 테이블끼리는 나눠야 한다.
    await client.batch(
      rows.map(r => buildUpsert(table, r)),
      'write'
    )
    counts[table] = rows.length
  }

  // 좋아요 카운트 재계산(알려진 결함 1번). 운영 Postgres의 post_likes에는
  // 트리거가 3개 걸려 있고 그중 2개가 같은 +1 함수를 돈다. 지금 드리프트가
  // 없는 이유는 toggle_post_like RPC가 맨 끝에서 COUNT(*)로 통째로
  // 덮어쓰기 때문이다 — 원본값을 믿지 않고 적재가 전부 끝난 뒤 실제
  // 좋아요 행 수로 다시 계산한다.
  await client.execute(
    'UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id)'
  )
  await client.execute(
    'UPDATE comments SET like_count = (SELECT COUNT(*) FROM comment_likes WHERE comment_likes.comment_id = comments.id)'
  )

  return counts
}

/**
 * 적재된 값을 원본 매핑과 필드 단위로 대조한다.
 *
 * like_count는 예외다 — 재계산했으므로 원본과 다를 수 있다. 이 컬럼은
 * "원본과 일치"가 아니라 "실제 좋아요 행 수와 일치"를 검증하고, 불일치가
 * 있으면 게시글/댓글 id와 저장값·실제값을 출력한다(개인정보가 아니므로
 * 값을 찍어도 안전하다).
 *
 * 그 밖의 모든 컬럼은 값을 출력하지 않는다 — member_profiles에는
 * 계좌번호·전화번호·생년월일이 있다. 컬럼 이름과 행 id만 낸다.
 */
export async function verifyContent({ client, expected }) {
  const byName = {
    member_profiles: expected.profiles,
    posts: expected.posts,
    comments: expected.comments,
    post_likes: expected.postLikes,
    comment_likes: expected.commentLikes,
    post_attachments: expected.postAttachments,
    notifications: expected.notifications,
  }
  const mismatches = []

  for (const [table] of LOAD_ORDER) {
    const rows = byName[table]
    const actual = await client.execute(`SELECT * FROM "${table}"`)
    const index = new Map(actual.rows.map(r => [String(r.id), r]))
    const isLikeCountTable = Object.prototype.hasOwnProperty.call(LIKE_COUNT_SOURCES, table)

    for (const row of rows) {
      const got = index.get(String(row.id))
      if (!got) {
        mismatches.push(`${table} id=${row.id}: Turso에 행이 없음`)
        continue
      }
      for (const [col, want] of Object.entries(row)) {
        if (isLikeCountTable && col === 'like_count') continue // 아래에서 별도 검증
        const have = got[col] === undefined ? null : got[col]
        const bothNull = want === null && have === null
        const equal = bothNull || (want !== null && have !== null && String(want) === String(have))
        if (!equal) {
          // 값 자체는 출력하지 않는다 — account_number 등 개인정보 컬럼이 여기 포함된다.
          mismatches.push(`${table} id=${row.id} ${col}: 원본과 다름`)
        }
      }
    }

    const extra = actual.rows.length - rows.length
    if (extra !== 0) {
      mismatches.push(`${table}: 행 수 불일치 (Turso ${actual.rows.length} vs 원본 ${rows.length})`)
    }
  }

  for (const [table, { likesTable, fkColumn }] of Object.entries(LIKE_COUNT_SOURCES)) {
    const result = await client.execute(
      `SELECT t.id AS id, t.like_count AS stored,` +
        ` (SELECT COUNT(*) FROM "${likesTable}" WHERE "${likesTable}"."${fkColumn}" = t.id) AS actual` +
        ` FROM "${table}" t`
    )
    for (const r of result.rows) {
      const stored = Number(r.stored)
      const actualCount = Number(r.actual)
      if (stored !== actualCount) {
        mismatches.push(
          `${table} id=${r.id} like_count: 저장값 ${stored} vs 실제 좋아요 ${actualCount}`
        )
      }
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

/**
 * `--expect table=N,table=N,...` 파싱. 없으면 null(하드 게이트를 건너뛴다는
 * 뜻 — 로컬 실험까지 막지는 않는다). 있는데 형식이 틀리면 던진다.
 */
export function parseExpect(argv) {
  const idx = argv.indexOf('--expect')
  if (idx === -1) return null
  const raw = argv[idx + 1]
  if (!raw || raw.startsWith('--')) {
    throw new Error('usage: --expect table=N,table=N,...')
  }
  const out = {}
  for (const pair of raw.split(',')) {
    const [table, n] = pair.split('=')
    if (!table || n === undefined || !/^\d+$/.test(n)) {
      throw new Error(`--expect 형식이 잘못됐다: "${pair}" (table=N 형태여야 한다)`)
    }
    out[table] = Number(n)
  }
  return out
}

/**
 * 건수 하드 게이트(지시 9번 "추측으로 진행하지 마라")의 판정 로직만 뺀 순수
 * 함수. main()의 console.log/exitCode 부작용과 분리해 CLI를 실행하지 않고도
 * 단위 테스트할 수 있게 한다.
 *
 * 판정 우선순위:
 *   1. expect가 있는데 파싱 건수와 다르면 'mismatch' (dry-run/apply 공통 차단)
 *   2. expect가 없고 apply면 'apply_without_expect' — **되돌릴 수 없는 쓰기에는
 *      --expect가 필수다.** parseInsertRows가 표당 INSERT 문을 전부 읽도록
 *      고쳐졌더라도, verifyContent는 Turso 행 수를 "파싱된 매핑 결과"와
 *      대조할 뿐이라 파서가 어떤 이유로든 일부를 놓치면 양쪽이 똑같이 잘려
 *      "검증 통과"가 나올 수 있다. 사람이 미리 실측한 건수와의 대조가 유일한
 *      외부 기준이므로 여기서는 생략을 허용하지 않는다.
 *   3. expect가 있고 일치하면 'matched'
 *   4. expect가 없고 dry-run이면 'no_expect_dry_run' — 로컬 실험까지 막지는
 *      않는다.
 */
export function evaluateExpectGate({ expect, apply, parsedCounts }) {
  if (expect) {
    const mismatches = Object.entries(expect).filter(([t, n]) => parsedCounts[t] !== n)
    if (mismatches.length > 0) {
      return { status: 'mismatch', mismatches }
    }
    return { status: 'matched' }
  }
  if (apply) {
    return { status: 'apply_without_expect' }
  }
  return { status: 'no_expect_dry_run' }
}

/** orphans/unknown/residual 목록을 컬럼명·행id만으로 출력한다(값은 안 찍는다 — UUID뿐이라 안전). */
function logOrphanList(label, list) {
  console.log(`\n${label} ${list.length}건:`)
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
  const dropKnownOrphanLikes = process.argv.includes('--drop-known-orphan-likes')

  let expect
  try {
    expect = parseExpect(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  const sql = readFileSync(dumpPath, 'utf8')

  const pgProfiles = parseInsertRows(sql, 'public', 'member_profiles')
  const pgPosts = parseInsertRows(sql, 'public', 'posts')
  const pgComments = parseInsertRows(sql, 'public', 'comments')
  const pgPostLikes = parseInsertRows(sql, 'public', 'post_likes')
  const pgCommentLikes = parseInsertRows(sql, 'public', 'comment_likes')
  const pgPostAttachments = parseInsertRows(sql, 'public', 'post_attachments')
  const pgNotifications = parseInsertRows(sql, 'public', 'notifications')

  const parsedCounts = {
    member_profiles: pgProfiles.length,
    posts: pgPosts.length,
    comments: pgComments.length,
    post_likes: pgPostLikes.length,
    comment_likes: pgCommentLikes.length,
    post_attachments: pgPostAttachments.length,
    notifications: pgNotifications.length,
  }

  console.log(
    `원본: member_profiles ${parsedCounts.member_profiles} / posts ${parsedCounts.posts} / ` +
      `comments ${parsedCounts.comments} / post_likes ${parsedCounts.post_likes} / ` +
      `comment_likes ${parsedCounts.comment_likes} / post_attachments ${parsedCounts.post_attachments} / ` +
      `notifications ${parsedCounts.notifications}`
  )

  const gate = evaluateExpectGate({ expect, apply, parsedCounts })
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

  let payload = {
    profiles: pgProfiles.map(toMemberProfileRow),
    posts: pgPosts.map(toPostRow),
    comments: pgComments.map(toCommentRow),
    postLikes: pgPostLikes.map(toPostLikeRow),
    commentLikes: pgCommentLikes.map(toCommentLikeRow),
    postAttachments: pgPostAttachments.map(toPostAttachmentRow),
    notifications: pgNotifications.map(toNotificationRow),
  }

  // 부모 행이 이미 지워진 FK — Postgres에 ON DELETE CASCADE가 선언돼 있으니
  // 정상이라면 있을 수 없다(마이그레이션 드리프트 확인됨:
  // 20250719090060_create_post_likes_table.sql:7·
  // 20250724090050_create_comment_likes_table.sql:7이 선언하는 CASCADE가
  // 운영에는 걸려 있지 않다). SQLite는 FK를 실제로 강제하므로 그대로 넣으면
  // 배치 전체가 SQLITE_CONSTRAINT로 죽는다. resolveOrphans가 허용 목록
  // 밖의 고아는 플래그와 무관하게 막고, 허용 목록 안(post_likes.post_id·
  // comment_likes.comment_id)만 --drop-known-orphan-likes로 제외한다.
  const resolved = resolveOrphans(payload, { dropKnownOrphanLikes })
  if (!resolved.ok) {
    if (resolved.reason === 'unknown_orphans') {
      logOrphanList(
        '허용 목록 밖의 FK 고아를 찾았다 — 플래그와 무관하게 중단한다',
        resolved.orphans
      )
      console.log(
        '\n허용 목록(post_likes.post_id, comment_likes.comment_id) 밖의 고아는 ' +
          '--drop-known-orphan-likes로도 건너뛸 수 없다. 원인을 먼저 확인해라 — ' +
          '예를 들어 member_profiles가 덤프에서 누락되면 그 회원의 게시글·댓글·' +
          '알림이 통째로 사라질 수 있다.'
      )
    } else if (resolved.reason === 'known_orphans_need_flag') {
      logOrphanList(
        '부모 행이 없는 FK를 찾았다 (원본 데이터 문제, 이 스크립트의 결함이 아니다)',
        resolved.orphans
      )
      console.log(
        '\n전부 허용 목록 안(post_likes.post_id, comment_likes.comment_id)이다. ' +
          '--drop-known-orphan-likes 없이는 진행하지 않는다. 원인을 먼저 확인하거나' +
          '(Postgres에서 FK가 실제로 걸려 있는지) 플래그로 이 좋아요들을 버릴지 판단해라.'
      )
    } else if (resolved.reason === 'residual_after_exclude') {
      logOrphanList('제외 대상', resolved.orphans)
      logOrphanList(
        '허용 목록 행을 제외했는데도 FK 고아가 남았다 (캐스케이드 안전망 발동) — 중단한다',
        resolved.residual
      )
    }
    process.exitCode = 1
    return
  }
  if (resolved.skipped > 0) {
    console.log(
      `\n--drop-known-orphan-likes: 알려진 좋아요 고아 ${resolved.skipped}건을 제외하고 진행한다.`
    )
  }
  payload = resolved.payload

  const client = createClient({
    url: requireEnv('TURSO_DATABASE_URL'),
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  const byTable = {
    member_profiles: payload.profiles,
    posts: payload.posts,
    comments: payload.comments,
    post_likes: payload.postLikes,
    comment_likes: payload.commentLikes,
    post_attachments: payload.postAttachments,
    notifications: payload.notifications,
  }

  try {
    if (!apply) {
      for (const [table] of LOAD_ORDER) {
        const rows = byTable[table]
        await assertAllRowsColumnCoverage(client, table, rows)
        const cur = await client.execute(`SELECT count(*) c FROM "${table}"`)
        console.log(`  ${table}: 현재 ${cur.rows[0].c}행 → 적재하면 ${rows.length}행`)
      }
      console.log('\ndry-run이다. 실제로 쓰려면 --apply를 붙여라.')
      return
    }

    const counts = await loadContent({ client, ...payload })
    console.log('적재 완료:', counts)

    const { mismatches } = await verifyContent({ client, expected: payload })
    if (mismatches.length > 0) {
      console.error(`\n검증 실패 — 불일치 ${mismatches.length}건:`)
      for (const m of mismatches) console.error('  ' + m)
      process.exitCode = 1
      return
    }
    console.log('검증 통과: like_count를 제외한 모든 필드가 원본과 일치하고,')
    console.log('like_count는 실제 좋아요 행 수와 일치한다.')
  } finally {
    client.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
