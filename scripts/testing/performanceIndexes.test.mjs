import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { migrationFiles } from './apply-migrations.mjs'

/**
 * 최종 리뷰 B-7 — `0004_add_performance_indexes.sql`.
 *
 * 이 파일이 지키는 것은 세 가지다.
 *  ① 뜨거운 읽기 경로가 **실제로** 인덱스를 탄다(풀스캔이 아니다).
 *     `EXPLAIN QUERY PLAN`으로 마이그레이션 적용 전/후를 같은 DB에서 대조한다 —
 *     "인덱스가 존재한다"만 보면 컬럼 순서를 뒤집어도 통과하기 때문에,
 *     계획기가 그것을 고르는지까지 본다.
 *  ② 표를 재작성하지 않는다(행 수 불변, `__new_*` 잔재 0). Task 6a에서
 *     `drizzle-kit generate` 생성물이 데이터를 지울 뻔한 이력이 있다.
 *  ③ 재실행 가능(idempotent).
 */

const MIGRATION = 'src/db/migrations/0004_add_performance_indexes.sql'
const SQL = readFileSync(MIGRATION, 'utf8')
const DB_PATH = 'scripts/testing/.performance-indexes-test.db'

const paths = []

function cleanup(path) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
}

after(() => paths.forEach(cleanup))

/** 0003까지 적용하고 최소 시드를 넣은 파일 DB를 만든다. 연결 팩토리를 돌려준다. */
async function freshDb(name) {
  const path = `${DB_PATH}.${name}`
  paths.push(path)
  cleanup(path)

  const setup = createClient({ url: `file:${path}` })
  for (const file of migrationFiles().filter(f => !f.includes('0004'))) {
    await setup.executeMultiple(readFileSync(file, 'utf8'))
  }
  const now = Date.now()
  await setup.executeMultiple(`
INSERT INTO member_profiles (id, display_name, email, created_at, updated_at) VALUES ('u1','A','a@x.kr',${now},${now});
INSERT INTO posts (id,title,content,category,author_id,created_at,updated_at) VALUES ('p1','t','c','잡담','u1',${now},${now});
INSERT INTO comments (id,post_id,author_id,content,created_at,updated_at) VALUES ('c1','p1','u1','x',${now},${now});
INSERT INTO post_likes (id,post_id,user_id,created_at) VALUES ('pl1','p1','u1',${now});
INSERT INTO comment_likes (id,comment_id,user_id,created_at) VALUES ('cl1','c1','u1',${now});
INSERT INTO notifications (id,user_id,type,title,message,created_at) VALUES ('n1','u1','comment','t','m',${now});
INSERT INTO post_attachments (id,post_id,file_name,file_url,file_type,file_size,mime_type,created_at,updated_at) VALUES ('a1','p1','f','u','image',1,'image/png',${now},${now});
INSERT INTO user_activities (id,user_id,action_type,created_at) VALUES ('ua1','u1','login',${now});
INSERT INTO board_meetings (id,title,created_at,updated_at) VALUES ('m1','회의',${now},${now});
INSERT INTO board_agendas (id,meeting_id,title,created_at,updated_at) VALUES ('ag1','m1','안건',${now},${now});
INSERT INTO board_meeting_date_options (id,meeting_id,candidate_date) VALUES ('o1','m1','2026-01-01');
INSERT INTO board_documents (id,title,category,file_path,created_at) VALUES ('d1','문서','정관','p',${now});
`)
  setup.close()

  // `executeMultiple`이 도중에 BEGIN을 여는 스크립트를 적용할 때 같은 커넥션에
  // 남은 커서와 부딪히지 않도록, 호출부가 매번 새 커넥션을 열게 한다.
  return () => createClient({ url: `file:${path}` })
}

/**
 * 뜨거운 읽기 경로 — `src/db/queries/`의 실제 질의 모양을 그대로 옮긴 것.
 * 왼쪽은 사람이 읽을 이름, 오른쪽은 SQL, 세 번째는 인덱스 적용 후 계획에
 * 반드시 등장해야 하는 인덱스 이름이다.
 */
const HOT_PATHS = [
  [
    '알림 통계(/api/notifications/stats — 로그인 회원이 페이지를 열 때마다)',
    `SELECT count(*), sum(case when read_at is null then 1 else 0 end), max(created_at) FROM notifications WHERE user_id = 'u1'`,
    'idx_notifications_read_status',
  ],
  [
    '알림 목록',
    `SELECT * FROM notifications WHERE user_id = 'u1' ORDER BY created_at DESC LIMIT 20`,
    'idx_notifications_user_created_at',
  ],
  [
    '게시판 키셋(전체)',
    `SELECT * FROM posts WHERE is_deleted = 0 ORDER BY is_pinned DESC, created_at DESC, id DESC LIMIT 21`,
    'idx_posts_keyset_pagination',
  ],
  [
    '게시판 키셋(카테고리)',
    `SELECT * FROM posts WHERE is_deleted = 0 AND category = '잡담' ORDER BY is_pinned DESC, created_at DESC, id DESC LIMIT 21`,
    'idx_posts_category_keyset_pagination',
  ],
  [
    '내가 쓴 글',
    `SELECT * FROM posts WHERE author_id = 'u1' AND is_deleted = 0 ORDER BY created_at DESC LIMIT 20`,
    'idx_posts_author_id',
  ],
  [
    '기간 내 글',
    `SELECT * FROM posts WHERE created_at >= 0 AND is_deleted = 0 ORDER BY created_at DESC`,
    'idx_posts_created_at_not_deleted',
  ],
  [
    '댓글 키셋',
    `SELECT * FROM comments WHERE post_id = 'p1' ORDER BY created_at ASC, id ASC LIMIT 21`,
    'idx_comments_post_id_created_at',
  ],
  [
    '내가 쓴 댓글',
    `SELECT * FROM comments WHERE author_id = 'u1' ORDER BY created_at DESC LIMIT 20`,
    'idx_comments_author_id',
  ],
  [
    '내가 누른 좋아요 수(countUserLikes)',
    `SELECT count(*) FROM post_likes WHERE user_id = 'u1'`,
    'idx_post_likes_user_post',
  ],
  [
    '내 댓글 하트 수',
    `SELECT count(*) FROM comment_likes WHERE user_id = 'u1'`,
    'idx_comment_likes_user_comment',
  ],
  [
    '관리자 회원 목록(상태 필터 + 가입일 역순)',
    `SELECT * FROM member_profiles WHERE registration_status = 'pending' ORDER BY created_at DESC LIMIT 20`,
    'idx_member_profiles_status',
  ],
  [
    '관리자 회원 목록(필터 없음)',
    `SELECT * FROM member_profiles ORDER BY created_at DESC LIMIT 20`,
    'idx_member_profiles_created_at',
  ],
  [
    '아티스트 배정 회원',
    `SELECT * FROM member_profiles WHERE artist_id = 'x'`,
    'idx_member_profiles_artist_id',
  ],
  [
    '글 첨부 목록',
    `SELECT * FROM post_attachments WHERE post_id = 'p1' ORDER BY sort_order ASC`,
    'idx_post_attachments_post_sort',
  ],
  [
    '만료된 임시 첨부 정리',
    `SELECT * FROM post_attachments WHERE is_temporary = 1 AND expires_at < 0`,
    'idx_post_attachments_temp_cleanup',
  ],
  [
    '활동 기간 조회(관리자 리포트)',
    `SELECT * FROM user_activities WHERE created_at >= 0 AND created_at <= 9 ORDER BY created_at ASC`,
    'idx_user_activities_created_at',
  ],
  [
    '사용자별 활동',
    `SELECT * FROM user_activities WHERE user_id = 'u1' AND action_type = 'login' ORDER BY created_at DESC`,
    'idx_user_activities_composite',
  ],
  [
    '회의 안건',
    `SELECT * FROM board_agendas WHERE meeting_id = 'm1' ORDER BY sort_order ASC`,
    'idx_board_agendas_meeting',
  ],
  [
    '회의 날짜 후보',
    `SELECT * FROM board_meeting_date_options WHERE meeting_id = 'm1' ORDER BY candidate_date ASC`,
    'idx_board_date_options_meeting',
  ],
  [
    '이사회 서류 목록',
    `SELECT * FROM board_documents WHERE category = '정관' ORDER BY created_at DESC`,
    'idx_board_documents_category',
  ],
]

async function planFor(open, sql) {
  const c = open()
  try {
    const r = await c.execute('EXPLAIN QUERY PLAN ' + sql)
    return r.rows.map(row => String(row.detail)).join(' / ')
  } finally {
    c.close()
  }
}

test('뜨거운 읽기 경로: 적용 전에는 풀스캔, 적용 후에는 해당 인덱스를 탄다', async () => {
  const open = await freshDb('plan')

  const before = []
  for (const [label, sql] of HOT_PATHS) before.push([label, await planFor(open, sql)])

  {
    const c = open()
    await c.executeMultiple(SQL)
    c.close()
  }

  for (let i = 0; i < HOT_PATHS.length; i++) {
    const [label, sql, indexName] = HOT_PATHS[i]
    const beforePlan = before[i][1]
    const afterPlan = await planFor(open, sql)

    // 부정 대조: 고치기 전에는 실제로 풀스캔이었다는 것을 같은 실행에서 확인한다.
    // 이게 없으면 "원래도 빨랐던 질의"를 나열해 놓고 초록불을 받을 수 있다.
    assert.match(
      beforePlan,
      /^SCAN /,
      `${label}: 0004 적용 전에는 풀스캔이어야 한다(아니면 이 항목은 B-7의 증거가 아니다). 실제: ${beforePlan}`
    )
    assert.ok(
      afterPlan.includes(indexName),
      `${label}: 0004 적용 후 계획에 ${indexName}이 있어야 한다. 실제: ${afterPlan}`
    )
    assert.doesNotMatch(
      afterPlan,
      /^SCAN \w+$/,
      `${label}: 0004 적용 후에도 풀스캔이면 안 된다. 실제: ${afterPlan}`
    )
  }
})

test('표를 재작성하지 않는다: 행 수가 그대로이고 임시 표가 남지 않는다', async () => {
  const open = await freshDb('rows')
  const tables = [
    'posts',
    'comments',
    'post_likes',
    'comment_likes',
    'notifications',
    'member_profiles',
    'post_attachments',
    'user_activities',
    'board_agendas',
    'board_meeting_date_options',
    'board_documents',
  ]

  const countAll = async () => {
    const c = open()
    try {
      const out = {}
      for (const t of tables) {
        out[t] = Number((await c.execute(`SELECT count(*) AS n FROM ${t}`)).rows[0].n)
      }
      return out
    } finally {
      c.close()
    }
  }

  const before = await countAll()
  {
    const c = open()
    await c.executeMultiple(SQL)
    c.close()
  }
  assert.deepEqual(await countAll(), before)

  const c = open()
  try {
    const leftovers = await c.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE '__migration%' OR name LIKE '__new_%'"
    )
    assert.equal(leftovers.rows.length, 0, '임시 표(단언·재작성 흔적)가 남으면 안 된다')
  } finally {
    c.close()
  }
})

test('재실행 가능: 두 번 돌려도 같은 상태에 수렴한다', async () => {
  const open = await freshDb('idempotent')

  const snapshot = async () => {
    const c = open()
    try {
      const idx = await c.execute("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      const rows = await c.execute('SELECT count(*) AS n FROM posts')
      return { indexes: idx.rows.map(r => r.name), posts: Number(rows.rows[0].n) }
    } finally {
      c.close()
    }
  }

  {
    const c = open()
    await c.executeMultiple(SQL)
    c.close()
  }
  const first = await snapshot()
  {
    const c = open()
    await c.executeMultiple(SQL)
    c.close()
  }
  assert.deepEqual(await snapshot(), first)
})

test('부정 대조: 인덱스 하나가 빠지면 단언이 물어 전체가 롤백된다', async () => {
  const open = await freshDb('assert')
  const broken = SQL.replace(
    /CREATE INDEX IF NOT EXISTS `idx_notifications_read_status`[^\n]*\n/,
    ''
  )
  assert.notEqual(
    broken,
    SQL,
    '치환이 실제로 일어나야 한다(정규식이 낡으면 이 테스트는 무의미하다)'
  )

  await assert.rejects(async () => {
    const c = open()
    try {
      await c.executeMultiple(broken)
    } finally {
      c.close()
    }
  }, /CHECK constraint failed/)

  const c = open()
  try {
    const idx = await c.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    )
    assert.equal(Number(idx.rows[0].n), 0, '단언이 물면 앞서 만든 인덱스도 함께 롤백돼야 한다')
    const leftovers = await c.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE '__migration%'"
    )
    assert.equal(leftovers.rows.length, 0)
  } finally {
    c.close()
  }
})

test('마이그레이션 원장(_journal.json)에 0004가 등록돼 있다', () => {
  const files = migrationFiles()
  assert.ok(
    files.includes(MIGRATION),
    '원장에 없으면 apply-migrations를 쓰는 테스트 전부가 0004 없는 스키마를 상대로 초록불을 낸다'
  )
})

test('표 재작성 구문이 파일에 없다(인덱스 생성은 표를 건드리지 않는다)', () => {
  assert.doesNotMatch(SQL, /DROP TABLE `?(posts|comments|notifications|member_profiles)/i)
  // 표 재작성 DDL 자체가 없어야 한다(주석에서 `__new_*`를 언급하는 것은 무방하다 —
  // 실제 CREATE/ALTER 문만 본다).
  assert.doesNotMatch(SQL, /CREATE TABLE `?__new_/i)
  assert.doesNotMatch(SQL, /ALTER TABLE `?__new_/i)
  assert.doesNotMatch(SQL, /PRAGMA foreign_keys/i)
  // 0002·0003과 같은 적용 계약: BEGIN/COMMIT 내장 + drizzle-kit migrate 금지 명시.
  assert.match(SQL, /^BEGIN;/m)
  assert.match(SQL, /^COMMIT;/m)
  assert.match(SQL, /`drizzle-kit migrate`로 적용하지 말 것/)
})
