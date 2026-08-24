import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import {
  toBool,
  toBoolDefault,
  toInt,
  toTs,
  toJsonText,
  toPostRow,
  toCommentRow,
  toPostLikeRow,
  toCommentLikeRow,
  toPostAttachmentRow,
  toNotificationRow,
  toMemberProfileRow,
} from '../migrate/lib/contentMapping.mjs'
import { assertColumnCoverage, buildUpsert, parseArgs } from '../migrate/identity.mjs'
import { loadContent, verifyContent, LOAD_ORDER } from '../migrate/content.mjs'

// ---------------------------------------------------------------- 픽스처

const PG_POST = {
  id: 'p1',
  title: 't',
  content: 'c',
  category: '잡담',
  author_id: 'u1',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  is_deleted: 'false',
  is_pinned: 'true',
  pinned_at: null,
  content_format: 'plain',
  like_count: '3',
  view_count: '10',
}

const PG_COMMENT = {
  id: 'c1',
  post_id: 'p1',
  author_id: 'u1',
  content: '댓글',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  like_count: '1',
}

const PG_POST_LIKE = {
  id: 'pl1',
  post_id: 'p1',
  user_id: 'u1',
  created_at: '2026-01-01 00:00:00+00',
}
const PG_COMMENT_LIKE = {
  id: 'cl1',
  comment_id: 'c1',
  user_id: 'u1',
  created_at: '2026-01-01 00:00:00+00',
}

const PG_ATTACHMENT = {
  id: 'a1',
  post_id: 'p1',
  file_name: 'x.png',
  file_url: 'https://x/x.png',
  file_type: 'image',
  file_size: '1024',
  mime_type: 'image/png',
  alt_text: null,
  is_primary: 'true',
  sort_order: '0',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  is_temporary: 'false',
  temp_session: null,
  expires_at: null,
}

const PG_NOTIFICATION = {
  id: 'n1',
  user_id: 'u1',
  type: 'system_notice',
  title: 't',
  message: 'm',
  data: '{"a": 1}',
  read_at: null,
  created_at: '2026-01-01 00:00:00+00',
  expires_at: null,
  related_post_id: null,
  related_user_id: null,
}

const PG_PROFILE = {
  id: 'u1',
  display_name: '황경하',
  email: 'a@x.kr',
  phone_number: '010-0000-0000',
  birth_date: '1992-01-09',
  real_name: '황경하',
  monthly_fee: 30000,
  bank_name: '국민',
  account_number: '123-456',
  account_holder: '황경하',
  registration_status: 'approved',
  is_active: true,
  is_admin: false,
  created_at: '2025-10-15T16:42:41.104671+00:00',
  updated_at: '2025-10-16T00:00:00+00:00',
  approved_at: null,
  approved_by: null,
  last_login_at: null,
  rejected_by: null,
  suspension_reason: null,
  suspension_until: null,
  is_suspended: false,
  profile_completeness_score: 80,
  verification_status: { email: true, phone: false, identity: false },
  membership_type: 'regular',
  engagement_score: 3,
  is_member: true,
  artist_id: null,
  is_artist: false,
  artist_role: 'owner',
  is_director: false,
  director_title: null,
  is_auditor: false,
}

// ---------------------------------------------------------------- 변환 헬퍼

test('toBool: true/false 문자열을 1/0으로 바꾼다', () => {
  assert.equal(toBool('true'), 1)
  assert.equal(toBool('false'), 0)
  assert.equal(toBool('t'), 1)
  assert.equal(toBool('f'), 0)
  assert.equal(toBool(null), null)
})

test('toBoolDefault: null이면 기본값을 쓴다', () => {
  assert.equal(toBoolDefault(null, false), 0)
  assert.equal(toBoolDefault(null, true), 1)
})

test('toInt: 숫자 아닌 값은 던진다', () => {
  assert.equal(toInt('42'), 42)
  assert.equal(toInt(null), null)
  assert.throws(() => toInt('abc'), /정수가 아니다/)
})

test('toTs: null은 null로 통과시킨다', () => {
  assert.equal(toTs(null), null)
  assert.equal(typeof toTs('2026-01-01 00:00:00+00'), 'number')
})

test('toJsonText: 빈 값은 fallback을, 객체는 직렬화한다', () => {
  assert.equal(toJsonText(null), '{}')
  assert.equal(toJsonText(undefined, '[]'), '[]')
  assert.equal(toJsonText({ a: 1 }), '{"a":1}')
  assert.equal(toJsonText('{"a":1}'), '{"a":1}')
})

// ---------------------------------------------------------------- toPostRow

test('toPostRow: boolean을 0/1로 바꾼다', () => {
  const row = toPostRow(PG_POST)
  assert.equal(row.is_deleted, 0)
  assert.equal(row.is_pinned, 1)
})

test('toPostRow: timestamptz를 ms 정수로 바꾸고 null은 null로 둔다', () => {
  const row = toPostRow({ ...PG_POST, pinned_at: null })
  assert.equal(typeof row.created_at, 'number')
  assert.equal(row.pinned_at, null)
})

test('toPostRow: 13개 컬럼을 전부 낸다', () => {
  assert.equal(Object.keys(toPostRow(PG_POST)).length, 13)
})

test('toPostRow: like_count는 재계산 전까지 원본값을 옮긴다', () => {
  assert.equal(toPostRow(PG_POST).like_count, 3)
})

// ---------------------------------------------------------------- toCommentRow

test('toCommentRow: 7개 컬럼을 전부 낸다', () => {
  const row = toCommentRow(PG_COMMENT)
  assert.equal(Object.keys(row).length, 7)
  assert.equal(row.post_id, 'p1')
  assert.equal(row.like_count, 1)
})

// ---------------------------------------------------------------- likes

test('toPostLikeRow / toCommentLikeRow: 4개 컬럼을 낸다', () => {
  assert.equal(Object.keys(toPostLikeRow(PG_POST_LIKE)).length, 4)
  assert.equal(Object.keys(toCommentLikeRow(PG_COMMENT_LIKE)).length, 4)
  assert.equal(toPostLikeRow(PG_POST_LIKE).post_id, 'p1')
  assert.equal(toCommentLikeRow(PG_COMMENT_LIKE).comment_id, 'c1')
})

// ---------------------------------------------------------------- attachments

test('toPostAttachmentRow: 15개 컬럼을 낸다', () => {
  const row = toPostAttachmentRow(PG_ATTACHMENT)
  assert.equal(Object.keys(row).length, 15)
  assert.equal(row.is_primary, 1)
  assert.equal(row.is_temporary, 0)
  assert.equal(row.file_size, 1024)
})

// ---------------------------------------------------------------- notifications

test('toNotificationRow: jsonb data를 문자열로 직렬화한다', () => {
  const row = toNotificationRow(PG_NOTIFICATION)
  assert.equal(typeof row.data, 'string')
  assert.deepEqual(JSON.parse(row.data), { a: 1 })
})

test('toNotificationRow: data가 비어 있으면 빈 객체 문자열을 넣는다 — NOT NULL 컬럼이다', () => {
  const row = toNotificationRow({ ...PG_NOTIFICATION, data: null })
  assert.equal(row.data, '{}')
})

test('toNotificationRow: 11개 컬럼을 낸다', () => {
  assert.equal(Object.keys(toNotificationRow(PG_NOTIFICATION)).length, 11)
})

// ---------------------------------------------------------------- member_profiles 재사용

test('toMemberProfileRow는 identityMapping.mjs 것을 재사용한다 (33컬럼)', () => {
  assert.equal(Object.keys(toMemberProfileRow(PG_PROFILE)).length, 33)
})

// ---------------------------------------------------------------- content.mjs: 로더 통합

const DB_PATH = 'scripts/testing/.content-loader-test.db'
let client

function payload() {
  return {
    profiles: [toMemberProfileRow(PG_PROFILE)],
    posts: [toPostRow(PG_POST)],
    comments: [toCommentRow(PG_COMMENT)],
    postLikes: [toPostLikeRow(PG_POST_LIKE)],
    commentLikes: [toCommentLikeRow(PG_COMMENT_LIKE)],
    postAttachments: [toPostAttachmentRow(PG_ATTACHMENT)],
    notifications: [toNotificationRow(PG_NOTIFICATION)],
  }
}

before(async () => {
  rmSync(DB_PATH, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await client.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
})

after(() => {
  client?.close()
  rmSync(DB_PATH, { force: true })
})

test('LOAD_ORDER는 FK 의존 순서를 지킨다', () => {
  assert.deepEqual(
    LOAD_ORDER.map(([table]) => table),
    [
      'member_profiles',
      'posts',
      'comments',
      'post_likes',
      'comment_likes',
      'post_attachments',
      'notifications',
    ]
  )
})

test('업서트 SQL은 파라미터 바인딩만 쓴다 (posts)', () => {
  const { sql, args } = buildUpsert('posts', toPostRow(PG_POST))
  assert.match(sql, /^INSERT INTO "posts"/)
  assert.match(sql, /ON CONFLICT\("id"\) DO UPDATE SET/)
  assert.equal(args.length, 13)
})

test('전 컬럼을 덮으면 커버리지 검사를 통과한다', async () => {
  await assertColumnCoverage(client, 'posts', toPostRow(PG_POST), [])
  await assertColumnCoverage(client, 'comments', toCommentRow(PG_COMMENT), [])
  await assertColumnCoverage(client, 'post_likes', toPostLikeRow(PG_POST_LIKE), [])
  await assertColumnCoverage(client, 'comment_likes', toCommentLikeRow(PG_COMMENT_LIKE), [])
  await assertColumnCoverage(client, 'post_attachments', toPostAttachmentRow(PG_ATTACHMENT), [])
  await assertColumnCoverage(client, 'notifications', toNotificationRow(PG_NOTIFICATION), [])
  await assertColumnCoverage(client, 'member_profiles', toMemberProfileRow(PG_PROFILE), [])
})

test('부정 대조: toPostRow에서 컬럼을 지우면 커버리지 검사가 던진다', () => {
  // Step 8: 매퍼가 컬럼 하나를 빠뜨렸을 때 게이트가 실제로 막는지 확인한다.
  // toPostRow 자체를 훼손하지 않고, 그 산출물에서 키를 지운 사본으로
  // 같은 상황을 재현한다 — 운영 매퍼 정의는 건드리지 않는다.
  const row = toPostRow(PG_POST)
  delete row.view_count
  return assert.rejects(() => assertColumnCoverage(client, 'posts', row, []), /view_count/)
})

test('적재하면 7개 테이블이 채워지고 like_count는 재계산된다', async () => {
  const counts = await loadContent({ client, ...payload() })
  assert.deepEqual(counts, {
    member_profiles: 1,
    posts: 1,
    comments: 1,
    post_likes: 1,
    comment_likes: 1,
    post_attachments: 1,
    notifications: 1,
  })

  // 원본 like_count는 3(post)/1(comment)이었지만, 실제 좋아요 행은 각 1개뿐이다.
  // 재계산이 이걸 덮어써야 한다.
  const p = await client.execute('select like_count from posts where id = ?', ['p1'])
  assert.equal(p.rows[0].like_count, 1)
  const c = await client.execute('select like_count from comments where id = ?', ['c1'])
  assert.equal(c.rows[0].like_count, 1)
})

test('두 번 적재해도 행이 늘지 않는다 (멱등)', async () => {
  const counts = await loadContent({ client, ...payload() })
  assert.deepEqual(counts, {
    member_profiles: 1,
    posts: 1,
    comments: 1,
    post_likes: 1,
    comment_likes: 1,
    post_attachments: 1,
    notifications: 1,
  })
  const r = await client.execute('select count(*) c from posts')
  assert.equal(r.rows[0].c, 1)
})

test('검증은 like_count를 원본이 아니라 실제 좋아요 수와 비교해 불일치 0을 낸다', async () => {
  const { mismatches } = await verifyContent({ client, expected: payload() })
  assert.deepEqual(mismatches, [])
})

test('like_count가 실제 좋아요 수와 어긋나면 검증이 게시글 id와 저장값·실제값을 알려준다', async () => {
  await client.execute('update posts set like_count = 99 where id = ?', ['p1'])
  const { mismatches } = await verifyContent({ client, expected: payload() })
  assert.ok(mismatches.some(m => /posts id=p1 like_count: 저장값 99 vs 실제 좋아요 1/.test(m)))
  await client.execute('update posts set like_count = 1 where id = ?', ['p1'])
})

test('개인정보 컬럼이 어긋나면 검증은 컬럼명과 id만 낸다 — 값은 절대 찍지 않는다', async () => {
  await client.execute("update member_profiles set account_number = '999-999' where id = ?", ['u1'])
  const { mismatches } = await verifyContent({ client, expected: payload() })
  const hit = mismatches.find(m => /member_profiles id=u1 account_number/.test(m))
  assert.ok(hit, '불일치가 감지되어야 한다')
  assert.ok(!hit.includes('999-999'), '원본 계좌번호 값이 출력되면 안 된다')
  assert.ok(!hit.includes('123-456'), '기존 계좌번호 값이 출력되면 안 된다')
  await client.execute("update member_profiles set account_number = '123-456' where id = ?", ['u1'])
})

test('parseArgs는 identity.mjs 것을 그대로 재사용한다', () => {
  assert.deepEqual(parseArgs(['--dump', 'public.sql']), { dumpPath: 'public.sql', apply: false })
  assert.throws(() => parseArgs(['--apply']), /usage/)
})
