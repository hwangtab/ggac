import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 알림 발송 3종(댓글/공지/회원 상태 변경) 앱 코드 복구 검증.
 *
 * 원본 트리거(`supabase/migrations/20250719090050_create_notifications_table.sql`)는
 * 운영 DB에 적용된 적이 없다(전수감사로 확인) — 이 스위트는 그 SQL 트리거의
 * 의미를 그대로 옮긴 앱 코드(`src/lib/server/commentNotify.ts`,
 * `src/lib/server/postNotify.ts`, `src/lib/server/memberStatusNotify.ts`)를
 * 실제 SQLite 파일 DB로 검증한다. 패턴은 `queriesNotifications.test.mjs`와
 * 같다.
 *
 * 라우트(comments/route.ts, posts/route.ts, member-action/route.ts,
 * artists/[id]/members/route.ts, members/bulk/route.ts)는
 * `next/headers`/`next/server` 요청 스코프에 묶여 있어 plain `node --test`에서
 * 핸들러를 직접 호출할 수 없다(`turso-stage2c-memberRoutes.test.mjs`가 이미
 * 마주친 제약과 동일) — 그 라우트들의 "언제 알림 함수를 부르는가" 판단
 * 로직은 소스 가드로 검증한다.
 */

// 소스 정규식으로 "이 호출이 있다/없다/어디보다 먼저다"를 검사하기 전에
// 주석을 걷어낸다 — 관례는 `scripts/testing/assert-runtime-risks.mjs`의
// `stripComments`/`stripCommentsAndImports`(코드리뷰 대응: 그 파일이 이미
// 겪은 "호출을 `//`로 주석 처리해도 원본 소스 그대로 훑으면 거짓 통과한다"
// 문제를 여기서도 그대로 마주쳤다). 그 파일은 독립 스크립트라 export가
// 없어 동일 구현을 그대로 복제한다. URL의 `//`를 자르지 않도록 앞 문자가
// `:`인 경우는 건드리지 않는다.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// 순서 비교(`indexOf` 두 값 비교)에 쓰는 소스. import 문 줄까지 걷어내
// import 위치가 실제 호출 순서 비교에 끼어드는 것을 막는다.
function stripCommentsAndImports(source) {
  return stripComments(source)
    .split('\n')
    .filter(line => !/^\s*import\b/.test(line))
    .join('\n')
}

const DB_PATH = 'scripts/testing/.notify-triggers-test.db'

const MODULE_URLS = {
  commentNotify: new URL('../../src/lib/server/commentNotify.ts', import.meta.url),
  postNotify: new URL('../../src/lib/server/postNotify.ts', import.meta.url),
  memberStatusNotify: new URL('../../src/lib/server/memberStatusNotify.ts', import.meta.url),
  notifications: new URL('../../src/db/queries/notifications.ts', import.meta.url),
  profiles: new URL('../../src/db/queries/profiles.ts', import.meta.url),
  posts: new URL('../../src/db/queries/posts.ts', import.meta.url),
  comments: new URL('../../src/db/queries/comments.ts', import.meta.url),
}

function fresh(key) {
  return import(`${MODULE_URLS[key].href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0

async function seedProfile(overrides = {}) {
  const { upsertProfile } = await fresh('profiles')
  const id = overrides.id ?? `notify-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '알림트리거테스트회원',
    registration_status: overrides.registration_status ?? 'approved',
    is_active: overrides.is_active ?? true,
    is_artist: overrides.is_artist ?? false,
  })
  return id
}

async function seedPost(overrides = {}) {
  const { createPost } = await fresh('posts')
  const authorId = overrides.author_id ?? (await seedProfile())
  const post = await createPost({
    title: overrides.title ?? '게시글 제목',
    content: overrides.content ?? '본문',
    content_format: 'html',
    category: overrides.category ?? '잡담',
    author_id: authorId,
  })
  return post
}

async function notificationsForUser(userId) {
  const result = await setupClient.execute({
    sql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at ASC',
    args: [userId],
  })
  return result.rows
}

async function allNotificationsOfType(type) {
  const result = await setupClient.execute({
    sql: 'SELECT * FROM notifications WHERE type = ?',
    args: [type],
  })
  return result.rows
}

// ==================================================================
// 1. 댓글 알림(post_reply) — src/lib/server/commentNotify.ts
// ==================================================================

test('notifyNewComment: 댓글 작성자 != 게시글 작성자면 게시글 작성자에게 post_reply 알림을 만든다', async () => {
  const { notifyNewComment } = await fresh('commentNotify')
  const { createComment } = await fresh('comments')

  const postAuthor = await seedProfile()
  const commenter = await seedProfile()
  const post = await seedPost({ author_id: postAuthor, title: '댓글알림테스트글' })
  const comment = await createComment({
    post_id: post.id,
    author_id: commenter,
    content: '댓글 내용',
  })

  await notifyNewComment({ postId: post.id, commentId: comment.id, commentAuthorId: commenter })

  const rows = await notificationsForUser(postAuthor)
  assert.equal(rows.length, 1, '게시글 작성자에게 알림이 정확히 1건 생성돼야 한다')
  assert.equal(rows[0].type, 'post_reply')
  assert.equal(rows[0].title, '댓글이 달렸습니다')
  assert.equal(rows[0].message, '댓글알림테스트글에 새로운 댓글이 달렸습니다.')
  assert.equal(rows[0].related_post_id, post.id)
  assert.equal(rows[0].related_user_id, commenter)
  assert.deepEqual(JSON.parse(rows[0].data), { post_id: post.id, comment_id: comment.id })
  assert.ok(rows[0].expires_at, '만료 시각이 채워져야 한다')
  const expiresInDays = (Number(rows[0].expires_at) - Date.now()) / (24 * 60 * 60 * 1000)
  assert.ok(
    expiresInDays > 29 && expiresInDays <= 30,
    `만료가 대략 30일 뒤여야 한다 (실측 ${expiresInDays})`
  )
})

// 부정 대조: 자기 글에 자기가 단 댓글은 알림이 가면 안 된다.
test('부정 대조: 댓글 작성자 == 게시글 작성자면 알림을 만들지 않는다(자기 글 자기 댓글)', async () => {
  const { notifyNewComment } = await fresh('commentNotify')
  const { createComment } = await fresh('comments')

  const author = await seedProfile()
  const post = await seedPost({ author_id: author })
  const comment = await createComment({ post_id: post.id, author_id: author, content: '셀프댓글' })

  await notifyNewComment({ postId: post.id, commentId: comment.id, commentAuthorId: author })

  const rows = await notificationsForUser(author)
  assert.equal(rows.length, 0, '자기 글에 자기가 단 댓글은 알림이 없어야 한다')
})

test('notifyNewComment: 존재하지 않는 게시글이면 조용히 아무것도 하지 않는다(throw하지 않는다)', async () => {
  const { notifyNewComment } = await fresh('commentNotify')
  const commentAuthorId = await seedProfile()
  await assert.doesNotReject(() =>
    notifyNewComment({
      postId: 'ghost-post-id',
      commentId: 'ghost-comment-id',
      commentAuthorId,
    })
  )
})

// ==================================================================
// 2. 공지 알림(post_new) — src/lib/server/postNotify.ts
// ==================================================================

test('notifyNewPost: category === "공지"면 승인된 모든 회원에게 post_new 알림을 배치로 만든다', async () => {
  const { notifyNewPost } = await fresh('postNotify')

  const author = await seedProfile()
  const approved1 = await seedProfile({ registration_status: 'approved' })
  const approved2 = await seedProfile({ registration_status: 'approved' })
  const pending = await seedProfile({ registration_status: 'pending' })
  const post = await seedPost({ author_id: author, category: '공지', title: '중요 공지사항' })

  await notifyNewPost({
    postId: post.id,
    authorId: author,
    title: post.title,
    category: post.category,
  })

  assert.equal((await notificationsForUser(approved1)).length, 1, '승인 회원1은 알림을 받아야 한다')
  assert.equal((await notificationsForUser(approved2)).length, 1, '승인 회원2는 알림을 받아야 한다')
  assert.equal(
    (await notificationsForUser(pending)).length,
    0,
    'pending 회원은 알림을 받으면 안 된다'
  )

  const rows = await notificationsForUser(approved1)
  assert.equal(rows[0].type, 'post_new')
  assert.equal(rows[0].title, '새 공지사항이 등록되었습니다')
  assert.equal(rows[0].message, '중요 공지사항')
  assert.equal(rows[0].related_post_id, post.id)
  assert.equal(rows[0].related_user_id, author)
  assert.deepEqual(JSON.parse(rows[0].data), { post_id: post.id, category: '공지' })
  const expiresInDays = (Number(rows[0].expires_at) - Date.now()) / (24 * 60 * 60 * 1000)
  assert.ok(
    expiresInDays > 6 && expiresInDays <= 7,
    `만료가 대략 7일 뒤여야 한다 (실측 ${expiresInDays})`
  )
})

// 부정 대조: 공지가 아닌 카테고리에는 알림이 가면 안 된다.
test('부정 대조: category가 "공지"가 아니면 알림을 만들지 않는다', async () => {
  const { notifyNewPost } = await fresh('postNotify')
  const before = await allNotificationsOfType('post_new')

  const author = await seedProfile()
  const approved = await seedProfile({ registration_status: 'approved' })
  const post = await seedPost({ author_id: author, category: '잡담', title: '잡담글' })

  await notifyNewPost({
    postId: post.id,
    authorId: author,
    title: post.title,
    category: post.category,
  })

  assert.equal((await notificationsForUser(approved)).length, 0, '공지가 아니면 알림이 없어야 한다')
  const after = await allNotificationsOfType('post_new')
  assert.equal(after.length, before.length, 'post_new 알림 총수가 늘어나면 안 된다')
})

// 소스 가드 — postNotify가 회원마다 도는 루프로 되돌아가면 잡는다(대량 회원
// 환경에서 N+1로 회귀하는 것을 막는다).
test('notifyNewPost 구현은 createBulkNotifications를 한 번만 호출한다 (소스 가드, N+1 금지)', () => {
  const src = readFileSync('src/lib/server/postNotify.ts', 'utf8')
  const match = src.match(/export async function notifyNewPost\([\s\S]*?\n\}\n/)
  assert.ok(match, 'notifyNewPost 함수 본문을 찾지 못했다')
  const body = match[0]

  const bulkCalls = body.match(/createBulkNotifications\(/g) ?? []
  assert.equal(bulkCalls.length, 1, 'createBulkNotifications 호출은 정확히 한 번이어야 한다')
  const singleCalls = body.match(/(?<!Bulk)createNotification\(/g) ?? []
  assert.equal(singleCalls.length, 0, '회원마다 createNotification을 부르면 안 된다(N+1)')
  assert.doesNotMatch(
    body,
    /for\s*\(|while\s*\(|recipientIds\.forEach\(/,
    'recipientIds를 도는 루프를 쓰면 안 된다'
  )
})

// ==================================================================
// 3. 회원 상태 변경 알림 — src/lib/server/memberStatusNotify.ts
// ==================================================================

test('notifyMemberApproved: member_approved 알림을 만든다(문구/만료 90일)', async () => {
  const { notifyMemberApproved } = await fresh('memberStatusNotify')
  const member = await seedProfile()

  await notifyMemberApproved(member)

  const rows = await notificationsForUser(member)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'member_approved')
  assert.equal(rows[0].title, '회원 가입이 승인되었습니다')
  assert.equal(
    rows[0].message,
    '경기아트콜렉티브 협동조합에 오신 것을 환영합니다! 이제 모든 기능을 이용하실 수 있습니다.'
  )
  const expiresInDays = (Number(rows[0].expires_at) - Date.now()) / (24 * 60 * 60 * 1000)
  assert.ok(
    expiresInDays > 89 && expiresInDays <= 90,
    `만료가 대략 90일 뒤여야 한다 (실측 ${expiresInDays})`
  )
})

test('notifyMemberRejected: member_rejected 알림을 만든다(문구/만료 30일)', async () => {
  const { notifyMemberRejected } = await fresh('memberStatusNotify')
  const member = await seedProfile()

  await notifyMemberRejected(member)

  const rows = await notificationsForUser(member)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'member_rejected')
  assert.equal(rows[0].title, '회원 가입이 거부되었습니다')
  assert.equal(
    rows[0].message,
    '죄송합니다. 회원 가입 신청이 거부되었습니다. 문의사항이 있으시면 관리자에게 연락해 주세요.'
  )
  const expiresInDays = (Number(rows[0].expires_at) - Date.now()) / (24 * 60 * 60 * 1000)
  assert.ok(
    expiresInDays > 29 && expiresInDays <= 30,
    `만료가 대략 30일 뒤여야 한다 (실측 ${expiresInDays})`
  )
})

test('notifyArtistApproved: artist_approved 알림을 만든다(문구/만료 90일)', async () => {
  const { notifyArtistApproved } = await fresh('memberStatusNotify')
  const member = await seedProfile()

  await notifyArtistApproved(member)

  const rows = await notificationsForUser(member)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'artist_approved')
  assert.equal(rows[0].title, '아티스트 권한이 승인되었습니다')
  assert.equal(
    rows[0].message,
    '축하합니다! 아티스트 권한이 승인되어 아티스트 프로필을 관리할 수 있습니다.'
  )
})

test('notifyMembersApprovedBatch: 여러 회원에게 배치 INSERT 1회로 member_approved를 보낸다', async () => {
  const { notifyMembersApprovedBatch } = await fresh('memberStatusNotify')
  const m1 = await seedProfile()
  const m2 = await seedProfile()
  const m3 = await seedProfile()

  await notifyMembersApprovedBatch([m1, m2, m3])

  for (const m of [m1, m2, m3]) {
    const rows = await notificationsForUser(m)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].type, 'member_approved')
  }
})

test('notifyMembersApprovedBatch: 빈 배열이면 아무 것도 하지 않는다', async () => {
  const { notifyMembersApprovedBatch } = await fresh('memberStatusNotify')
  const before = await allNotificationsOfType('member_approved')
  await notifyMembersApprovedBatch([])
  const after = await allNotificationsOfType('member_approved')
  assert.equal(after.length, before.length)
})

test('notifyMembersRejectedBatch: 여러 회원에게 배치 INSERT 1회로 member_rejected를 보낸다', async () => {
  const { notifyMembersRejectedBatch } = await fresh('memberStatusNotify')
  const m1 = await seedProfile()
  const m2 = await seedProfile()

  await notifyMembersRejectedBatch([m1, m2])

  for (const m of [m1, m2]) {
    const rows = await notificationsForUser(m)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].type, 'member_rejected')
  }
})

// 소스 가드 — 대량 승인/거부가 회원마다 도는 루프로 되돌아가면 잡는다.
test('notifyMembersApprovedBatch/notifyMembersRejectedBatch는 createBulkNotifications만 쓰고 루프를 쓰지 않는다 (소스 가드)', () => {
  const src = readFileSync('src/lib/server/memberStatusNotify.ts', 'utf8')
  for (const fn of ['notifyMembersApprovedBatch', 'notifyMembersRejectedBatch']) {
    const re = new RegExp(`export async function ${fn}\\([\\s\\S]*?\\n\\}\\n`)
    const match = src.match(re)
    assert.ok(match, `${fn} 함수 본문을 찾지 못했다`)
    const body = match[0]
    assert.doesNotMatch(
      body,
      /for\s*\(|while\s*\(|memberIds\.forEach\(/,
      `${fn}는 루프를 쓰면 안 된다`
    )
    assert.match(body, /createBulkNotifications\(/, `${fn}는 createBulkNotifications를 써야 한다`)
  }
})

// ==================================================================
// 4. 라우트 소스 가드 — "언제 알림 함수를 부르는가"
//
// next/headers에 묶인 라우트 핸들러를 plain node --test에서 직접 호출할 수
// 없다(turso-stage2c-memberRoutes.test.mjs와 같은 제약). 대신 라우트 소스가
// "실제로 상태가 바뀐 경우에만" 알림 함수를 부르도록 배선돼 있는지를
// 구조적으로 확인한다.
// ==================================================================

test('부정 대조(구조): member-action route의 approve 분기는 pending 상태 검사를 통과해야만 notifyMemberApproved에 도달한다', () => {
  const raw = readFileSync('src/app/api/admin/member-action/route.ts', 'utf8')
  const src = stripCommentsAndImports(raw)

  // 코드리뷰 대응(I-2): 원래 `[\s\S]*?`가 파일 전체를 넘나들어서, approve
  // 분기의 pending 검사를 통째로 지워도 뒤쪽 reject 분기의 동일한 검사에
  // 걸려 거짓 통과했다(리뷰어가 실제로 이 변조로 확인함). `case 'approve':`
  // 부터 **다음 case까지**로 매칭 범위를 잘라 그 안에서만 검사한다.
  const approveBlockMatch = src.match(/case 'approve':[\s\S]*?(?=case 'reject':)/)
  assert.ok(approveBlockMatch, "approve 분기(case 'approve': ~ case 'reject': 앞)를 찾지 못했다")
  const approveBlock = approveBlockMatch[0]
  const approveBlockIndex = src.indexOf(approveBlock)
  assert.ok(approveBlockIndex >= 0)

  const pendingCheckMatch = approveBlock.match(
    /if \(targetMember\.registration_status !== 'pending'\)[\s\S]*?return ApiError\.badRequest/
  )
  assert.ok(
    pendingCheckMatch,
    "approve 분기 안에 '이미 approved면 400' 사전 검사가 있어야 한다 — 없으면 재승인 시에도 알림이 나간다. " +
      'memberStatusNotify.notifyMemberApproved는 전이 여부를 스스로 재검사하지 않으므로(모듈 설계), 이 검사가 유일한 방어선이다.'
  )
  const guardIndex = approveBlockIndex + pendingCheckMatch.index

  // 코드리뷰 대응(M-1): `indexOf`가 못 찾으면 -1을 반환한다. `notifyIndex >
  // updateIndex` 비교만 하면 함수명이 바뀌어 updateIndex가 -1이 될 때도
  // "찾은 notifyIndex(>=0) > -1"이 항상 참이라 거짓 통과한다(리뷰어가 실제로
  // updateProfile 이름을 바꿔 확인함). 비교 전에 각 인덱스가 실제로 발견됐는지
  // 먼저 단정한다.
  const updateIndex = src.indexOf('await updateProfile(memberId, updateData)')
  assert.ok(updateIndex >= 0, 'updateProfile(memberId, updateData) 호출을 찾지 못했다')
  const notifyIndex = src.indexOf('await notifyMemberApproved(memberId)')
  assert.ok(notifyIndex >= 0, 'notifyMemberApproved(memberId) 호출을 찾지 못했다')

  assert.ok(
    notifyIndex > guardIndex,
    'notifyMemberApproved 호출은 approve 분기의 pending 검사보다 뒤에 있어야 한다'
  )
  assert.ok(notifyIndex > updateIndex, 'notifyMemberApproved 호출은 DB 업데이트 성공 이후여야 한다')
})

test('부정 대조(구조): member-action route의 reject 분기도 동일한 사전 검사 뒤에만 notifyMemberRejected를 부른다', () => {
  const src = readFileSync('src/app/api/admin/member-action/route.ts', 'utf8')

  const rejectCaseMatch = src.match(
    /case 'reject':[\s\S]*?if \(targetMember\.registration_status !== 'pending'\)[\s\S]*?return ApiError\.badRequest/
  )
  assert.ok(rejectCaseMatch, "reject 분기에 '이미 처리됨' 사전 검사가 있어야 한다")

  const guardIndex = src.indexOf(rejectCaseMatch[0])
  const notifyIndex = src.indexOf('await notifyMemberRejected(memberId)')
  assert.ok(
    notifyIndex > guardIndex,
    'notifyMemberRejected 호출은 pending 검사보다 뒤에 있어야 한다'
  )
})

test('부정 대조(구조): artist 배정 route는 wasArtist(기존 is_artist)가 false일 때만 notifyArtistApproved를 부른다', () => {
  const raw = readFileSync('src/app/api/admin/artists/[id]/members/route.ts', 'utf8')
  const src = stripCommentsAndImports(raw)

  assert.match(
    src,
    /const wasArtist = targetMember\.is_artist/,
    '업데이트 전 is_artist 값을 미리 캡처해야 한다(업데이트 후엔 항상 true라 비교 불가)'
  )
  assert.match(
    src,
    /if \(!wasArtist\) \{\s*await notifyArtistApproved\(memberId\)/,
    'notifyArtistApproved는 wasArtist가 false일 때만 불려야 한다 — 이미 아티스트인 회원 재배정 시 알림이 가면 안 된다'
  )

  // 코드리뷰 대응(M-2): 위 두 단정만으로는 알림 블록을 updateProfile try
  // *앞*으로 옮겨도 통과한다(리뷰어가 실제로 이 변조로 확인함) — 그러면
  // 배정이 500으로 실패해도 회원은 "아티스트 권한이 승인되었습니다"를
  // 받는다. catch 블록 안의 실패 메시지(고유 마커)보다 notify 호출이
  // 뒤에 있는지로 "updateProfile의 try/catch를 실제로 통과한 뒤에만
  // 실행된다"는 실행 순서를 확인한다.
  const catchMarkerIndex = src.indexOf("'아티스트 배정에 실패했습니다.'")
  assert.ok(catchMarkerIndex >= 0, 'updateProfile catch 블록의 실패 메시지를 찾지 못했다')
  const notifyIndex = src.indexOf('await notifyArtistApproved(memberId)')
  assert.ok(notifyIndex >= 0, 'notifyArtistApproved(memberId) 호출을 찾지 못했다')
  assert.ok(
    notifyIndex > catchMarkerIndex,
    'notifyArtistApproved 호출은 updateProfile try/catch 블록보다 뒤에 있어야 한다 — ' +
      '앞에 있으면 DB 업데이트가 실패해도(500 응답) 알림이 나간다'
  )
})

test('부정 대조(구조): bulk route는 실제로 업데이트된 id(updatedIdSet)에만 배치 알림을 보낸다(자격 미달 id 제외)', () => {
  const src = readFileSync('src/app/api/admin/members/bulk/route.ts', 'utf8')
  assert.match(
    src,
    /if \(operation_type === 'bulk_approve'\) \{\s*\n\s*await notifyMembersApprovedBatch\(Array\.from\(updatedIdSet\)\)/,
    'bulk_approve는 updatedIdSet(실제 갱신된 id)만 배치 알림 대상이어야 한다 — eligibleIds 전체를 넘기면 DB 갱신에 실패한 회원에게도 알림이 간다'
  )
  assert.match(
    src,
    /if \(operation_type === 'bulk_reject'\) \{\s*\n\s*await notifyMembersRejectedBatch\(Array\.from\(updatedIdSet\)\)/,
    'bulk_reject도 마찬가지로 updatedIdSet만 대상이어야 한다'
  )
})

// 코드리뷰 대응(I-1): 원래 이 테스트는 주석 포함 원본 소스를 그대로 정규식
// 매칭했다 — 호출을 `//`로 주석 처리해도, 혹은 인자를 엉뚱한 값으로
// 바꿔치기해도 거짓 통과했다(리뷰어가 두 변조 모두 실제로 확인함). 아래는
// (1) 주석 제거 후 매칭, (2) 인자 3개를 정확한 값으로 단언, (3) 실제 생성
// 호출(createComment/createPost)보다 뒤에 있는지 순서 단언, 셋을 모두
// 만족한다.

test('comments route는 notifyNewComment를 createComment 성공 이후, 올바른 인자로 부른다 (배선 가드)', () => {
  const raw = readFileSync('src/app/api/posts/[id]/comments/route.ts', 'utf8')
  const commentsOnly = stripComments(raw)
  const code = stripCommentsAndImports(raw)

  assert.match(
    commentsOnly,
    /import \{ notifyNewComment \} from '@\/lib\/server\/commentNotify'/,
    'notifyNewComment를 import해야 한다'
  )

  const createIndex = code.indexOf('await createComment({')
  assert.ok(createIndex >= 0, 'createComment 호출을 찾지 못했다')

  const notifyCallMatch = code.match(/await notifyNewComment\(\{([\s\S]*?)\}\)/)
  assert.ok(
    notifyCallMatch,
    'notifyNewComment 호출을 찾지 못했다 — 주석 처리됐거나 삭제됐을 수 있다'
  )
  const notifyIndex = code.indexOf(notifyCallMatch[0])
  assert.ok(notifyIndex > createIndex, 'notifyNewComment 호출은 createComment 성공 이후여야 한다')

  const args = notifyCallMatch[1]
  assert.match(args, /postId:\s*validPostId/, 'postId 인자가 검증된 게시글 id가 아니다')
  assert.match(args, /commentId:\s*created\.id/, 'commentId 인자가 방금 만든 댓글의 id가 아니다')
  assert.match(
    args,
    /commentAuthorId:\s*userId/,
    'commentAuthorId 인자가 실제 댓글 작성자가 아니다 — 엉뚱한 사람에게 알림이 갈 수 있다'
  )
})

test('posts route는 notifyNewPost를 createPost 성공 이후, 올바른 인자로 부른다 (배선 가드)', () => {
  const raw = readFileSync('src/app/api/posts/route.ts', 'utf8')
  const postsOnly = stripComments(raw)
  const code = stripCommentsAndImports(raw)

  assert.match(
    postsOnly,
    /import \{ notifyNewPost \} from '@\/lib\/server\/postNotify'/,
    'notifyNewPost를 import해야 한다'
  )

  const createIndex = code.indexOf('await createPost({')
  assert.ok(createIndex >= 0, 'createPost 호출을 찾지 못했다')

  const notifyCallMatch = code.match(/await notifyNewPost\(\{([\s\S]*?)\}\)/)
  assert.ok(notifyCallMatch, 'notifyNewPost 호출을 찾지 못했다 — 주석 처리됐거나 삭제됐을 수 있다')
  const notifyIndex = code.indexOf(notifyCallMatch[0])
  assert.ok(notifyIndex > createIndex, 'notifyNewPost 호출은 createPost 성공 이후여야 한다')

  const args = notifyCallMatch[1]
  assert.match(args, /postId:\s*post\.id/, 'postId 인자가 방금 만든 게시글의 id가 아니다')
  assert.match(args, /authorId:\s*post\.author_id/, 'authorId 인자가 게시글 작성자가 아니다')
  assert.match(args, /title:\s*post\.title/, 'title 인자가 게시글 제목이 아니다')
  assert.match(
    args,
    /category:\s*post\.category/,
    'category 인자가 게시글 카테고리가 아니다 — 공지 여부 판정이 틀어질 수 있다'
  )
})
