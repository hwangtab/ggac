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

export { parseArgs }

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
const REFERENCE_CHECKS = [
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

async function main() {
  let dumpPath, apply
  try {
    ;({ dumpPath, apply } = parseArgs(process.argv.slice(2)))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
  const skipOrphans = process.argv.includes('--skip-orphans')

  const sql = readFileSync(dumpPath, 'utf8')

  const pgProfiles = parseInsertRows(sql, 'public', 'member_profiles')
  const pgPosts = parseInsertRows(sql, 'public', 'posts')
  const pgComments = parseInsertRows(sql, 'public', 'comments')
  const pgPostLikes = parseInsertRows(sql, 'public', 'post_likes')
  const pgCommentLikes = parseInsertRows(sql, 'public', 'comment_likes')
  const pgPostAttachments = parseInsertRows(sql, 'public', 'post_attachments')
  const pgNotifications = parseInsertRows(sql, 'public', 'notifications')

  let payload = {
    profiles: pgProfiles.map(toMemberProfileRow),
    posts: pgPosts.map(toPostRow),
    comments: pgComments.map(toCommentRow),
    postLikes: pgPostLikes.map(toPostLikeRow),
    commentLikes: pgCommentLikes.map(toCommentLikeRow),
    postAttachments: pgPostAttachments.map(toPostAttachmentRow),
    notifications: pgNotifications.map(toNotificationRow),
  }

  console.log(
    `원본: member_profiles ${pgProfiles.length} / posts ${pgPosts.length} / ` +
      `comments ${pgComments.length} / post_likes ${pgPostLikes.length} / ` +
      `comment_likes ${pgCommentLikes.length} / post_attachments ${pgPostAttachments.length} / ` +
      `notifications ${pgNotifications.length}`
  )

  // 부모 행이 이미 지워진 FK — Postgres에 ON DELETE CASCADE가 선언돼 있으니
  // 정상이라면 있을 수 없다(마이그레이션 드리프트 의심). SQLite는 FK를
  // 실제로 강제하므로 그대로 넣으면 배치 전체가 SQLITE_CONSTRAINT로 죽는다.
  // 여기서 먼저 찾아 무엇을 걸렀는지 밝힌다.
  const orphans = findOrphans(payload)
  if (orphans.length > 0) {
    console.log(
      `\n부모 행이 없는 FK ${orphans.length}건을 찾았다 (원본 데이터 문제, 이 스크립트의 결함이 아니다):`
    )
    for (const o of orphans) {
      console.log(`  ${o.table} id=${o.id} ${o.column} -> 없는 ${o.missing}`)
    }
    if (!skipOrphans) {
      console.log(
        '\n--skip-orphans 없이는 진행하지 않는다. 원인을 먼저 확인하거나' +
          ' (Postgres에서 FK가 실제로 걸려 있는지) --skip-orphans로 이 행들을' +
          ' 제외하고 진행할지 판단해라.'
      )
      if (apply) process.exitCode = 1
      return
    }
    payload = excludeOrphans(payload, orphans)
    console.log(`--skip-orphans: 위 ${orphans.length}건을 제외하고 진행한다.`)
  }

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
