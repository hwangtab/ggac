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
import {
  loadContent,
  verifyContent,
  LOAD_ORDER,
  REFERENCE_CHECKS,
  findOrphans,
  excludeOrphans,
  resolveOrphans,
  parseExpect,
} from '../migrate/content.mjs'

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

// 픽스처는 완전한 합성값이다 — 이 저장소는 공개 저장소이고 이 파일은
// 커밋되어 영구히 남는다. 실제 조합원의 이름·생년월일과 겹치지 않도록
// 임의로 지어냈다(계좌·전화번호는 애초부터 형식만 갖춘 더미였다).
const PG_PROFILE = {
  id: 'u1',
  display_name: '홍길동',
  email: 'a@x.kr',
  phone_number: '010-0000-0000',
  birth_date: '1990-01-01',
  real_name: '홍길동',
  monthly_fee: 30000,
  bank_name: '국민',
  account_number: '123-456',
  account_holder: '홍길동',
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

test('toBool: 알려진 토큰 밖이면 조용히 0으로 떨어지지 않고 던진다 (Important 3)', () => {
  // toInt처럼 던져야 한다 — 덤프 표기가 바뀌었는데 여기서 침묵하면
  // is_deleted가 전부 0이 되어 지워진 게시글이 되살아나거나, is_admin이
  // 전부 0이 되어 관리자가 전원 권한을 잃는다.
  assert.throws(() => toBool('yes'), /boolean으로 해석할 수 없다/)
  assert.throws(() => toBool('TRUE'), /boolean으로 해석할 수 없다/)
  assert.throws(() => toBool(2), /boolean으로 해석할 수 없다/)
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

test('LOAD_ORDER는 REFERENCE_CHECKS가 아는 모든 부모를 자식보다 먼저 적재한다', () => {
  // 상수를 그대로 다시 쓰는 항진 테스트를 피하려고, REFERENCE_CHECKS(실제 FK
  // 관계 정의)에서 부모/자식 관계를 뽑아 LOAD_ORDER 안 위치를 비교한다.
  // LOAD_ORDER나 REFERENCE_CHECKS 중 하나만 바뀌어 순서가 깨지면 이 테스트가
  // 잡는다.
  const parentTableByPayloadKey = {
    profiles: 'member_profiles',
    posts: 'posts',
    comments: 'comments',
  }
  const tableByPayloadKey = Object.fromEntries(LOAD_ORDER.map(([table, key]) => [key, table]))
  const position = Object.fromEntries(LOAD_ORDER.map(([table], i) => [table, i]))

  for (const { key, parentKey } of REFERENCE_CHECKS) {
    const childTable = tableByPayloadKey[key]
    const parentTable = parentTableByPayloadKey[parentKey]
    assert.ok(
      position[childTable] > position[parentTable],
      `${childTable}(${position[childTable]})가 부모 ${parentTable}(${position[parentTable]})보다 먼저 오면 안 된다`
    )
  }
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

test('행이 여럿일 때 두 번째 posts 행에 컬럼이 빠지면 loadContent가 던진다', async () => {
  // Important 4-1: 선례(migrate-loader.test.mjs)는 loadIdentity라는 공개
  // 진입점으로 "두 번째 행에서 키가 빠지면 잡는다"를 검증한다. content.mjs가
  // 실제로 쓰는 assertAllRowsColumnCoverage는 export되지 않으므로, 여기서도
  // 같은 방식으로 loadContent(공개 진입점)를 직접 호출해 같은 케이스를 검증한다.
  const good = toPostRow(PG_POST)
  const bad = toPostRow({ ...PG_POST, id: 'p-second-row-missing-col' })
  delete bad.view_count

  await assert.rejects(
    () =>
      loadContent({
        client,
        profiles: [toMemberProfileRow(PG_PROFILE)],
        posts: [good, bad],
        comments: [],
        postLikes: [],
        commentLikes: [],
        postAttachments: [],
        notifications: [],
      }),
    /view_count/
  )
  // 커버리지 검사가 posts 배치보다 먼저 돌기 때문에, 첫 번째(정상) 행도
  // 들어가지 않았어야 한다.
  const r = await client.execute('select count(*) c from posts where id = ?', [
    'p-second-row-missing-col',
  ])
  assert.equal(r.rows[0].c, 0)
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

// ---------------------------------------------------------------- FK 고아 (리뷰 라운드 1: C1·C2)

function orphanFixture() {
  // posts.author_id가 존재하지 않는 회원을 가리킨다 — 허용 목록(post_likes.
  // post_id, comment_likes.comment_id) 밖의 "알 수 없는" 고아다.
  return {
    profiles: [],
    posts: [{ ...toPostRow(PG_POST), author_id: 'ghost-user' }],
    comments: [],
    postLikes: [],
    commentLikes: [],
    postAttachments: [],
    notifications: [],
  }
}

function knownOrphanFixture() {
  // post_likes.post_id가 존재하지 않는 게시글을 가리킨다 — 허용 목록 안.
  return {
    profiles: [toMemberProfileRow(PG_PROFILE)],
    posts: [],
    comments: [],
    postLikes: [{ ...toPostLikeRow(PG_POST_LIKE), post_id: 'deleted-post' }],
    commentLikes: [],
    postAttachments: [],
    notifications: [],
  }
}

test('findOrphans: 허용 목록 밖 고아(posts.author_id)를 찾는다', () => {
  const orphans = findOrphans(orphanFixture())
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].key, 'posts')
  assert.equal(orphans[0].column, 'author_id')
  assert.equal(orphans[0].missing, 'ghost-user')
})

test('resolveOrphans: 허용 목록 밖 고아는 플래그와 무관하게 중단시킨다 (Critical 1)', () => {
  const withoutFlag = resolveOrphans(orphanFixture(), { dropKnownOrphanLikes: false })
  assert.equal(withoutFlag.ok, false)
  assert.equal(withoutFlag.reason, 'unknown_orphans')

  const withFlag = resolveOrphans(orphanFixture(), { dropKnownOrphanLikes: true })
  assert.equal(
    withFlag.ok,
    false,
    '--drop-known-orphan-likes로도 허용 목록 밖 고아는 통과시키면 안 된다'
  )
  assert.equal(withFlag.reason, 'unknown_orphans')
})

test('resolveOrphans: 허용 목록 안 고아(post_likes.post_id)는 플래그 없으면 멈춘다', () => {
  const result = resolveOrphans(knownOrphanFixture(), { dropKnownOrphanLikes: false })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'known_orphans_need_flag')
})

test('resolveOrphans: 허용 목록 안 고아는 플래그가 있으면 제외하고 진행한다', () => {
  const result = resolveOrphans(knownOrphanFixture(), { dropKnownOrphanLikes: true })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, 1)
  assert.equal(result.payload.postLikes.length, 0)
})

test('resolveOrphans: 고아가 없으면 payload를 그대로 통과시킨다', () => {
  const clean = {
    profiles: [toMemberProfileRow(PG_PROFILE)],
    posts: [toPostRow(PG_POST)],
    comments: [],
    postLikes: [],
    commentLikes: [],
    postAttachments: [],
    notifications: [],
  }
  const result = resolveOrphans(clean, { dropKnownOrphanLikes: false })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, 0)
  assert.deepEqual(result.payload, clean)
})

test('excludeOrphans 이후 findOrphans 재검사가 잔여 고아를 잡는다 (Critical 2, 캐스케이드 안전망)', () => {
  // 리뷰어의 합성 재현을 그대로 옮긴다: 부모(post) 하나를 제외하면 그
  // post_id를 가리키던 comments·post_likes·post_attachments가 전부 새
  // 고아가 된다. resolveOrphans는 posts.author_id 고아를 애초에 "알 수
  // 없는 고아"로 즉시 중단시켜 이 상황에 도달하지 않지만(C1), excludeOrphans
  // + findOrphans 조합 자체가 이런 잔여 고아를 놓치지 않는다는 걸 별도로
  // 확인해둔다 — resolveOrphans의 residual_after_exclude 분기가 기대는
  // 안전망이 실제로 작동한다는 증거다.
  const payloadWithOrphanParent = {
    profiles: [],
    posts: [{ ...toPostRow(PG_POST), id: 'pX', author_id: 'ghost' }],
    comments: [{ ...toCommentRow(PG_COMMENT), id: 'c1', post_id: 'pX', author_id: 'u1' }],
    postLikes: [{ ...toPostLikeRow(PG_POST_LIKE), id: 'l1', post_id: 'pX', user_id: 'u1' }],
    commentLikes: [],
    postAttachments: [{ ...toPostAttachmentRow(PG_ATTACHMENT), id: 'a1', post_id: 'pX' }],
    notifications: [],
  }

  const orphansBefore = findOrphans(payloadWithOrphanParent)
  assert.ok(orphansBefore.some(o => o.key === 'posts' && o.column === 'author_id'))

  // posts.author_id 고아 하나만(마치 허용됐다는 듯) 제외해본다.
  const parentOnlyOrphan = orphansBefore.filter(o => o.key === 'posts')
  const filtered = excludeOrphans(payloadWithOrphanParent, parentOnlyOrphan)
  assert.equal(filtered.posts.length, 0, 'pX가 제외돼야 한다')

  const residual = findOrphans(filtered)
  assert.ok(residual.length > 0, '부모를 제외했으니 자식 쪽에서 새 고아가 나와야 한다')
  const residualKeys = residual.map(o => `${o.key}.${o.column}`)
  assert.ok(residualKeys.includes('comments.post_id'))
  assert.ok(residualKeys.includes('postLikes.post_id'))
  assert.ok(residualKeys.includes('postAttachments.post_id'))
})

// ---------------------------------------------------------------- --expect (Important 2)

test('parseExpect: table=N,table=N 형식을 파싱한다', () => {
  assert.deepEqual(parseExpect(['--expect', 'posts=39,comments=22']), { posts: 39, comments: 22 })
})

test('parseExpect: --expect가 없으면 null이다', () => {
  assert.equal(parseExpect(['--dump', 'x.sql']), null)
})

test('parseExpect: 형식이 틀리면 던진다', () => {
  assert.throws(() => parseExpect(['--expect', 'posts']), /--expect 형식이 잘못됐다/)
  assert.throws(() => parseExpect(['--expect', 'posts=abc']), /--expect 형식이 잘못됐다/)
  assert.throws(() => parseExpect(['--expect']), /usage/)
})
