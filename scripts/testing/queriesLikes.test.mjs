import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/likes.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesAttachments.test.mjs`(Task 5)와 동일.
 *
 * 이 스위트의 핵심은 "좋아요 수는 매번 재계산한다"는 계약이다 —
 * `togglePostLike`/`toggleCommentLike`를 여러 번 토글해도 `like_count`가 항상
 * `post_likes`/`comment_likes`의 실제 행 수와 일치해야 한다(브리프 결함 1번:
 * `+1`/`-1` 증감 방식으로 되돌리면 이 불변식이 깨진다). 오라클(정답)은 이
 * 모듈이 아니라 `setupClient`(원시 libsql 클라이언트)로 직접 COUNT해서 구한다
 * — 테스트 대상 코드와 같은 계산 로직을 오라클로 재사용하면 버그를 놓친다.
 */

const DB_PATH = 'scripts/testing/.queries-likes-test.db'
const LIKES_MODULE_URL = new URL('../../src/db/queries/likes.ts', import.meta.url)
const COMMENTS_MODULE_URL = new URL('../../src/db/queries/comments.ts', import.meta.url)
const POSTS_MODULE_URL = new URL('../../src/db/queries/posts.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshLikesModule() {
  return import(`${LIKES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshCommentsModule() {
  return import(`${COMMENTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshPostsModule() {
  return import(`${POSTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: togglePostLike이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { togglePostLike } = await loadFreshLikesModule()
    await assert.rejects(() => togglePostLike('any-post', 'any-user'))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
let seededAuthorId
let seededLikerId

async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `likes-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '좋아요테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function seedPost(overrides = {}) {
  const { createPost } = await loadFreshPostsModule()
  const post = await createPost({
    title: overrides.title ?? `좋아요테스트글-${++seedCounter}`,
    content: '내용',
    content_format: 'plain',
    category: overrides.category ?? '잡담',
    author_id: overrides.authorId ?? seededAuthorId,
  })
  return post.id
}

async function seedComment(postId, overrides = {}) {
  const { createComment } = await loadFreshCommentsModule()
  const comment = await createComment({
    post_id: postId,
    author_id: overrides.authorId ?? seededAuthorId,
    content: overrides.content ?? '댓글',
  })
  return comment.id
}

async function countPostLikesRaw(postId) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?',
    args: [postId],
  })
  return Number(result.rows[0].c)
}

async function countCommentLikesRaw(commentId) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM comment_likes WHERE comment_id = ?',
    args: [commentId],
  })
  return Number(result.rows[0].c)
}

test('사전 준비: 공통 저자/좋아요 누를 사용자를 심는다', async () => {
  seededAuthorId = await seedProfile({ id: 'likes-author-common', display_name: '작성자' })
  seededLikerId = await seedProfile({ id: 'likes-liker-common', display_name: '좋아요누른사람' })
  assert.ok(seededAuthorId)
  assert.ok(seededLikerId)
})

// ---------------------------------------------------------------- togglePostLike

test('togglePostLike: 좋아요가 없으면 추가하고 liked:true, like_count:1을 돌려준다', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()

  const result = await togglePostLike(postId, seededLikerId)
  assert.equal(result.liked, true)
  assert.equal(result.like_count, 1)
  assert.equal(await countPostLikesRaw(postId), 1)
})

test('togglePostLike: 좋아요가 있으면 취소하고 liked:false, like_count:0을 돌려준다', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()

  await togglePostLike(postId, seededLikerId)
  const result = await togglePostLike(postId, seededLikerId)
  assert.equal(result.liked, false)
  assert.equal(result.like_count, 0)
  assert.equal(await countPostLikesRaw(postId), 0)
})

test('togglePostLike: 5회 반복 토글해도 like_count가 실제 post_likes 행 수와 항상 일치한다(핵심 불변식)', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()

  for (let i = 0; i < 5; i++) {
    const on = await togglePostLike(postId, seededLikerId)
    assert.equal(on.liked, true)
    assert.equal(on.like_count, await countPostLikesRaw(postId))
    const off = await togglePostLike(postId, seededLikerId)
    assert.equal(off.liked, false)
    assert.equal(off.like_count, await countPostLikesRaw(postId))
  }
})

test('togglePostLike: 저장된 like_count가 실제 행 수와 어긋나 있어도(트리거 드리프트 재현) 토글 한 번으로 진짜 값으로 교정한다(행위 테스트)', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const liker = await seedProfile({ display_name: '오염테스트좋아요누른사람' })

  // 저장된 값을 일부러 오염시킨다(운영에서 실제로 있었던 트리거 드리프트
  // 재현) — 실제 post_likes 행은 0개인데 posts.like_count는 99로 심는다.
  // 증감 구현(likeCount + 1)이면 오염된 99에 얹혀 100을 반환/저장한다 —
  // 재계산(COUNT) 구현만 실제 행 수(1)로 되돌린다. 소스 가드
  // (/likeCount:\s*sql`[^`]*\+\s*1/)는 SQL 리터럴 증감만 잡고
  // `.set({ likeCount: prev + 1 })` 같은 JS 계산 증감은 못 잡는다 — 이
  // 테스트가 구현 형태와 무관하게 실제 동작으로 이 계약을 고정한다.
  await setupClient.execute({
    sql: 'UPDATE posts SET like_count = 99 WHERE id = ?',
    args: [postId],
  })

  const result = await togglePostLike(postId, liker)
  const actualRows = await countPostLikesRaw(postId)
  assert.equal(actualRows, 1, '토글 후 실제 post_likes 행은 1개여야 한다')
  assert.equal(
    result.like_count,
    1,
    '반환값이 실제 행 수(1)와 같아야 한다 — 증감 구현이면 100을 반환해 이 단언이 실패한다'
  )

  const stored = await setupClient.execute({
    sql: 'SELECT like_count FROM posts WHERE id = ?',
    args: [postId],
  })
  assert.equal(
    Number(stored.rows[0].like_count),
    1,
    'DB에 저장된 like_count도 실제 행 수와 일치해야 한다(반환값만 맞고 저장값은 오염된 채로 남는 회귀까지 잡는다)'
  )
})

test('togglePostLike: 서로 다른 사용자의 좋아요는 독립적으로 누적된다', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const userA = await seedProfile({ display_name: 'A' })
  const userB = await seedProfile({ display_name: 'B' })
  const userC = await seedProfile({ display_name: 'C' })

  await togglePostLike(postId, userA)
  await togglePostLike(postId, userB)
  const result = await togglePostLike(postId, userC)

  assert.equal(result.like_count, 3)
  assert.equal(await countPostLikesRaw(postId), 3)

  // A가 취소하면 2로 줄어야 한다(다른 사용자의 좋아요는 건드리지 않는다).
  const afterCancel = await togglePostLike(postId, userA)
  assert.equal(afterCancel.liked, false)
  assert.equal(afterCancel.like_count, 2)
})

test('togglePostLike: 같은 사용자가 두 번 눌러도 행이 하나만 생기지 않는다 — 유니크 인덱스', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  await togglePostLike(postId, seededLikerId)

  // 동시 요청을 흉내내 직접 INSERT를 시도하면 유니크 제약(post_likes_post_user_idx)에
  // 걸려야 한다.
  await assert.rejects(
    () =>
      setupClient.execute({
        sql: 'INSERT INTO post_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        args: [`dup-${Date.now()}`, postId, seededLikerId, Date.now()],
      }),
    err => /UNIQUE/i.test(`${err?.message ?? ''}`)
  )
  assert.equal(await countPostLikesRaw(postId), 1, '중복 삽입 시도 후에도 행은 여전히 1개여야 한다')
})

test('togglePostLike: 존재하지 않는 게시글 id는 FK 위반으로 거부된다', async () => {
  const { togglePostLike } = await loadFreshLikesModule()
  await assert.rejects(
    () => togglePostLike('ghost-post-nope', seededLikerId),
    err => {
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
      return /FOREIGN KEY|FOREIGNKEY/.test(combined)
    }
  )
})

// ------------------------------------------------------------- toggleCommentLike

test('toggleCommentLike: 5회 반복 토글해도 like_count가 실제 comment_likes 행 수와 항상 일치한다', async () => {
  const { toggleCommentLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const commentId = await seedComment(postId)

  for (let i = 0; i < 5; i++) {
    const on = await toggleCommentLike(commentId, seededLikerId)
    assert.equal(on.liked, true)
    assert.equal(on.like_count, await countCommentLikesRaw(commentId))
    const off = await toggleCommentLike(commentId, seededLikerId)
    assert.equal(off.liked, false)
    assert.equal(off.like_count, await countCommentLikesRaw(commentId))
  }
})

test('toggleCommentLike: 같은 사용자가 두 번 눌러도 행이 하나만 생기지 않는다 — 유니크 인덱스', async () => {
  const { toggleCommentLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const commentId = await seedComment(postId)
  await toggleCommentLike(commentId, seededLikerId)

  await assert.rejects(
    () =>
      setupClient.execute({
        sql: 'INSERT INTO comment_likes (id, comment_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        args: [`dup-${Date.now()}`, commentId, seededLikerId, Date.now()],
      }),
    err => /UNIQUE/i.test(`${err?.message ?? ''}`)
  )
  assert.equal(
    await countCommentLikesRaw(commentId),
    1,
    '중복 삽입 시도 후에도 행은 여전히 1개여야 한다'
  )
})

test('toggleCommentLike: 다른 댓글의 좋아요 수에 영향을 주지 않는다', async () => {
  const { toggleCommentLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const commentA = await seedComment(postId)
  const commentB = await seedComment(postId)

  await toggleCommentLike(commentA, seededLikerId)
  const resultB = await toggleCommentLike(commentB, seededLikerId)
  assert.equal(resultB.like_count, 1)
  assert.equal(await countCommentLikesRaw(commentA), 1)
})

test('toggleCommentLike: 저장된 like_count가 실제 행 수와 어긋나 있어도(원본 Postgres가 실제로 드리프트를 남기던 케이스) 토글 한 번으로 진짜 값으로 교정한다(행위 테스트)', async () => {
  const { toggleCommentLike } = await loadFreshLikesModule()
  const postId = await seedPost()
  const commentId = await seedComment(postId)
  const liker = await seedProfile({ display_name: '댓글오염테스트좋아요누른사람' })

  // comment_likes는 원본 Postgres 트리거(update_comment_like_count)가 실제로
  // 드리프트를 남기던 테이블이다(운영에서 20260703210026_restore_comments_
  // like_count.sql로 컬럼·트리거·백필을 교정한 이력이 있다) — 그 시나리오를
  // 오염된 저장값으로 재현한다. 실제 comment_likes 행은 0개인데
  // comments.like_count는 99로 심는다.
  await setupClient.execute({
    sql: 'UPDATE comments SET like_count = 99 WHERE id = ?',
    args: [commentId],
  })

  const result = await toggleCommentLike(commentId, liker)
  const actualRows = await countCommentLikesRaw(commentId)
  assert.equal(actualRows, 1, '토글 후 실제 comment_likes 행은 1개여야 한다')
  assert.equal(
    result.like_count,
    1,
    '반환값이 실제 행 수(1)와 같아야 한다 — 증감 구현이면 100을 반환해 이 단언이 실패한다'
  )

  const stored = await setupClient.execute({
    sql: 'SELECT like_count FROM comments WHERE id = ?',
    args: [commentId],
  })
  assert.equal(
    Number(stored.rows[0].like_count),
    1,
    'DB에 저장된 like_count도 실제 행 수와 일치해야 한다'
  )
})

// --------------------------------------------------- 소스 가드: 증감(+1/-1) 금지

test('togglePostLike/toggleCommentLike 구현은 재계산(COUNT) 방식이다 — +1/-1 증감을 쓰면 안 된다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/likes.ts', 'utf8')

  const postMatch = src.match(/export async function togglePostLike\([\s\S]*?\n\}\n/)
  assert.ok(postMatch, 'togglePostLike 함수 본문을 찾지 못했다')
  const postBody = postMatch[0]

  const commentMatch = src.match(/export async function toggleCommentLike\([\s\S]*?\n\}\n/)
  assert.ok(commentMatch, 'toggleCommentLike 함수 본문을 찾지 못했다')
  const commentBody = commentMatch[0]

  for (const [name, body] of [
    ['togglePostLike', postBody],
    ['toggleCommentLike', commentBody],
  ]) {
    assert.match(body, /db\.transaction\(/, `${name}은 db.transaction 안에서 실행해야 한다`)
    assert.match(body, /count\(\)/, `${name}은 COUNT 재계산을 써야 한다`)
    assert.doesNotMatch(
      body,
      /likeCount:\s*sql`[^`]*\+\s*1/,
      `${name}은 like_count를 +1 증감으로 갱신하면 안 된다 — 결함 1번을 재현한다`
    )
    assert.doesNotMatch(
      body,
      /likeCount:\s*sql`[^`]*-\s*1/,
      `${name}은 like_count를 -1 증감으로 갱신하면 안 된다 — 결함 1번을 재현한다`
    )
    assert.doesNotMatch(
      body,
      /GREATEST/i,
      `${name}에 원본 Postgres 트리거의 GREATEST(like_count - 1, 0) 패턴이 남아있으면 안 된다`
    )
  }
})

// ---------------------------------------------------------------- isPostLikedByUser

test('isPostLikedByUser: 좋아요 여부를 정확히 판정한다', async () => {
  const { togglePostLike, isPostLikedByUser } = await loadFreshLikesModule()
  const postId = await seedPost()

  assert.equal(await isPostLikedByUser(postId, seededLikerId), false)
  await togglePostLike(postId, seededLikerId)
  assert.equal(await isPostLikedByUser(postId, seededLikerId), true)
})

// ---------------------------------------------------------------- getLikedCommentIds

test('getLikedCommentIds: 여러 댓글 중 해당 사용자가 좋아요한 것만 배치로 돌려준다', async () => {
  const { toggleCommentLike, getLikedCommentIds } = await loadFreshLikesModule()
  const postId = await seedPost()
  const c1 = await seedComment(postId)
  const c2 = await seedComment(postId)
  const c3 = await seedComment(postId)

  await toggleCommentLike(c1, seededLikerId)
  await toggleCommentLike(c3, seededLikerId)

  const liked = await getLikedCommentIds(seededLikerId, [c1, c2, c3])
  assert.deepEqual([...liked].sort(), [c1, c3].sort())
})

test('getLikedCommentIds: commentIds가 비어있으면 쿼리 없이 즉시 빈 Set을 돌려준다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getLikedCommentIds } = await loadFreshLikesModule()
    const result = await getLikedCommentIds('any-user', [])
    assert.deepEqual(result, new Set())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- getLikedPostIds

test('getLikedPostIds: 여러 게시글 중 해당 사용자가 좋아요한 것만 배치로 돌려준다(게시판 목록 표시용)', async () => {
  const { togglePostLike, getLikedPostIds } = await loadFreshLikesModule()
  const liker = await seedProfile({ display_name: '목록좋아요테스트' })
  const p1 = await seedPost()
  const p2 = await seedPost()
  const p3 = await seedPost()

  await togglePostLike(p1, liker)
  await togglePostLike(p3, liker)

  const liked = await getLikedPostIds(liker, [p1, p2, p3])
  assert.deepEqual([...liked].sort(), [p1, p3].sort())
})

test('getLikedPostIds: 방금 좋아요한 게시글이 즉시 집합에 포함된다(컷오버 후 목록 하트 표시 회귀 방지)', async () => {
  const { togglePostLike, getLikedPostIds } = await loadFreshLikesModule()
  const liker = await seedProfile({ display_name: '즉시반영테스트' })
  const postId = await seedPost()

  const before = await getLikedPostIds(liker, [postId])
  assert.equal(before.has(postId), false)

  await togglePostLike(postId, liker)

  const after = await getLikedPostIds(liker, [postId])
  assert.equal(after.has(postId), true, '방금 누른 좋아요가 배치 조회에 즉시 나타나야 한다')
})

test('getLikedPostIds: postIds가 비어있으면 쿼리 없이 즉시 빈 Set을 돌려준다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getLikedPostIds } = await loadFreshLikesModule()
    const result = await getLikedPostIds('any-user', [])
    assert.deepEqual(result, new Set())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

test('getLikedPostIds: userId가 비어있으면 쿼리 없이 즉시 빈 Set을 돌려준다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getLikedPostIds } = await loadFreshLikesModule()
    const result = await getLikedPostIds('', ['any-post'])
    assert.deepEqual(result, new Set())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- listUserLikes

test('listUserLikes: 반환 필드명(post_id/post_title/post_category/post_author_name/liked_at)을 그대로 유지한다', async () => {
  const { togglePostLike, listUserLikes } = await loadFreshLikesModule()
  // 격리된 사용자를 새로 심는다 — seededLikerId는 앞선 테스트들이 이미 여러
  // 게시글에 좋아요를 남겨둔 공유 상태라 행 개수(1건)를 단정할 수 없다.
  const liker = await seedProfile({ display_name: '필드명테스트용 좋아요누른사람' })
  const postId = await seedPost({ title: '좋아요 목록 테스트글', category: '홍보' })
  await togglePostLike(postId, liker)

  const rows = await listUserLikes(liker, { limit: 20, offset: 0 })
  assert.equal(rows.length, 1)
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'liked_at',
    'post_author_name',
    'post_category',
    'post_id',
    'post_title',
  ])
  assert.equal(rows[0].post_id, postId)
  assert.equal(rows[0].post_title, '좋아요 목록 테스트글')
  assert.equal(rows[0].post_category, '홍보')
  assert.equal(rows[0].post_author_name, '작성자')
  assert.ok(!Number.isNaN(Date.parse(rows[0].liked_at)))
})

test('listUserLikes: liked_at 내림차순으로 정렬한다(최근 좋아요가 먼저)', async () => {
  const { togglePostLike, listUserLikes } = await loadFreshLikesModule()
  const liker = await seedProfile({ display_name: '정렬테스트' })
  const postA = await seedPost({ title: '먼저 좋아요' })
  await togglePostLike(postA, liker)
  await new Promise(resolve => setTimeout(resolve, 5))
  const postB = await seedPost({ title: '나중에 좋아요' })
  await togglePostLike(postB, liker)

  const rows = await listUserLikes(liker, { limit: 20, offset: 0 })
  assert.deepEqual(
    rows.map(r => r.post_id),
    [postB, postA]
  )
})

test('listUserLikes: 삭제된 게시글에 대한 좋아요는 목록에서 빠진다(p.is_deleted = false 필터)', async () => {
  const { togglePostLike, listUserLikes } = await loadFreshLikesModule()
  const { softDeletePost } = await loadFreshPostsModule()
  const liker = await seedProfile({ display_name: '삭제필터테스트' })
  const alivePost = await seedPost({ title: '살아있는 글' })
  const deletedPost = await seedPost({ title: '삭제될 글' })
  await togglePostLike(alivePost, liker)
  await togglePostLike(deletedPost, liker)
  await softDeletePost(deletedPost)

  const rows = await listUserLikes(liker, { limit: 20, offset: 0 })
  assert.deepEqual(
    rows.map(r => r.post_id),
    [alivePost],
    '삭제된 게시글의 좋아요는 목록에 나오면 안 된다'
  )
})

test('listUserLikes: limit/offset으로 페이지네이션한다', async () => {
  const { togglePostLike, listUserLikes } = await loadFreshLikesModule()
  const liker = await seedProfile({ display_name: '페이지네이션테스트' })
  const ids = []
  for (let i = 0; i < 3; i++) {
    const postId = await seedPost({ title: `페이지글-${i}` })
    await togglePostLike(postId, liker)
    ids.unshift(postId) // liked_at DESC이므로 나중에 좋아요한 게 앞으로 온다
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  const page1 = await listUserLikes(liker, { limit: 2, offset: 0 })
  const page2 = await listUserLikes(liker, { limit: 2, offset: 2 })
  assert.deepEqual(
    [...page1, ...page2].map(r => r.post_id),
    ids
  )
})

// ------------------------------------------------------------- countUserLikes

// 단계 4 Task 6b: countUserLikes의 스코프를 listUserLikes에 맞췄다(동작 변경).
// 그전에는 삭제된 글의 좋아요까지 세어, `/api/users/[id]/likes` 한 응답 안에서
// 목록과 total_count가 서로 다른 기준을 말했다 — total_pages가 부풀어 빈
// 마지막 페이지가 생기고, 회원은 볼 수 없는 글까지 포함한 숫자를 봤다.
test('countUserLikes: 삭제된 게시글의 좋아요는 세지 않는다(listUserLikes와 같은 스코프)', async () => {
  const { togglePostLike, countUserLikes, listUserLikes } = await loadFreshLikesModule()
  const { softDeletePost } = await loadFreshPostsModule()
  const liker = await seedProfile({ display_name: '카운트테스트' })
  const alivePost = await seedPost()
  const deletedPost = await seedPost()
  await togglePostLike(alivePost, liker)
  await togglePostLike(deletedPost, liker)
  assert.equal(await countUserLikes(liker), 2, '삭제 전에는 둘 다 세어야 한다')

  await softDeletePost(deletedPost)

  assert.equal(await countUserLikes(liker), 1)
  // 이 테스트의 요점은 숫자 1이 아니라 **두 함수가 같은 답을 낸다**는 것이다.
  const rows = await listUserLikes(liker, { limit: 100, offset: 0 })
  assert.equal(
    await countUserLikes(liker),
    rows.length,
    '총계와 목록이 갈리면 total_pages가 어긋나 빈 페이지가 생긴다'
  )
})

test('countUserLikes: 좋아요가 없으면 0을 돌려준다', async () => {
  const { countUserLikes } = await loadFreshLikesModule()
  const liker = await seedProfile({ display_name: '무좋아요테스트' })
  assert.equal(await countUserLikes(liker), 0)
})
