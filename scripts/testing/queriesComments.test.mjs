import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/comments.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesAttachments.test.mjs`(Task 5)와 동일. `comments`는
 * `posts(id)`/`member_profiles(id)`를 참조하는 FK라 먼저 저자 프로필 + 게시글을
 * 심는다.
 */

const DB_PATH = 'scripts/testing/.queries-comments-test.db'
const COMMENTS_MODULE_URL = new URL('../../src/db/queries/comments.ts', import.meta.url)
const POSTS_MODULE_URL = new URL('../../src/db/queries/posts.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

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
  await setupClient.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: createComment이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { createComment } = await loadFreshCommentsModule()
    await assert.rejects(() =>
      createComment({ post_id: 'any-id', author_id: 'any-author', content: '내용' })
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
let seededAuthorId

async function seedAuthor(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `comment-author-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '댓글테스트작성자',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function seedPost(overrides = {}) {
  const { createPost } = await loadFreshPostsModule()
  const post = await createPost({
    title: overrides.title ?? `댓글테스트글-${++seedCounter}`,
    content: '내용',
    content_format: 'plain',
    category: '잡담',
    author_id: overrides.authorId ?? seededAuthorId,
  })
  return post.id
}

test('사전 준비: 공통 저자를 심는다', async () => {
  seededAuthorId = await seedAuthor()
  assert.ok(seededAuthorId)
})

// ---------------------------------------------------------------- createComment

test('createComment: 댓글을 생성하고 comments 컬럼(author 임베드 없이)을 그대로 돌려준다', async () => {
  const { createComment } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const comment = await createComment({
    post_id: postId,
    author_id: seededAuthorId,
    content: '첫 댓글입니다',
  })
  assert.ok(comment.id)
  assert.equal(comment.post_id, postId)
  assert.equal(comment.author_id, seededAuthorId)
  assert.equal(comment.content, '첫 댓글입니다')
  assert.equal(comment.like_count, 0)
  assert.ok(!Number.isNaN(Date.parse(comment.created_at)))
  assert.ok(!Number.isNaN(Date.parse(comment.updated_at)))
  assert.equal('author' in comment, false, 'createComment 응답에는 author 임베드가 없어야 한다')

  for (const key of Object.keys(comment)) {
    assert.doesNotMatch(key, /[A-Z]/, `${key}는 camelCase 흔적이다`)
  }
})

test('createComment: 존재하지 않는 post_id는 FK 위반으로 거부된다', async () => {
  const { createComment } = await loadFreshCommentsModule()
  await assert.rejects(
    () =>
      createComment({ post_id: 'ghost-post-nope', author_id: seededAuthorId, content: '유령 글' }),
    err => {
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
      return /FOREIGN KEY|FOREIGNKEY/.test(combined)
    }
  )
})

test('createComment: 존재하지 않는 author_id는 FK 위반으로 거부된다', async () => {
  const { createComment } = await loadFreshCommentsModule()
  const postId = await seedPost()
  await assert.rejects(
    () => createComment({ post_id: postId, author_id: 'ghost-author-nope', content: '유령 저자' }),
    err => {
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
      return /FOREIGN KEY|FOREIGNKEY/.test(combined)
    }
  )
})

// ---------------------------------------------------------------- getCommentById

test('getCommentById: id + post_id로 스코프된 단건 조회, 없으면 null', async () => {
  const { createComment, getCommentById } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const created = await createComment({ post_id: postId, author_id: seededAuthorId, content: 'x' })

  const found = await getCommentById(created.id, postId)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.author_id, seededAuthorId)

  const wrongPost = await getCommentById(created.id, await seedPost())
  assert.equal(wrongPost, null, '다른 게시글 id로 조회하면 null이어야 한다(스코프 강제)')

  const notFound = await getCommentById('00000000-0000-4000-8000-000000000000', postId)
  assert.equal(notFound, null)
})

// ---------------------------------------------------------------- deleteComment

test('deleteComment: id + post_id로 삭제한다(하드 삭제)', async () => {
  const { createComment, deleteComment, getCommentById } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const created = await createComment({ post_id: postId, author_id: seededAuthorId, content: 'x' })

  await deleteComment(created.id, postId)
  const found = await getCommentById(created.id, postId)
  assert.equal(found, null)
})

test('deleteComment: post_id가 다르면 삭제되지 않는다(스코프 강제)', async () => {
  const { createComment, deleteComment, getCommentById } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const otherPostId = await seedPost()
  const created = await createComment({ post_id: postId, author_id: seededAuthorId, content: 'x' })

  await deleteComment(created.id, otherPostId)
  const stillThere = await getCommentById(created.id, postId)
  assert.ok(stillThere, '다른 post_id로 삭제를 시도하면 아무 일도 일어나지 않아야 한다')
})

// ---------------------------------------------------------------- listCommentsKeyset

test('listCommentsKeyset: created_at 오름차순으로 정렬하고, 다른 게시글의 댓글은 섞이지 않는다', async () => {
  const { createComment, listCommentsKeyset } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const otherPostId = await seedPost()
  await createComment({ post_id: otherPostId, author_id: seededAuthorId, content: '다른 글 댓글' })

  const c1 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '첫번째' })
  await new Promise(resolve => setTimeout(resolve, 5))
  const c2 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '두번째' })
  await new Promise(resolve => setTimeout(resolve, 5))
  const c3 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '세번째' })

  const rows = await listCommentsKeyset(postId, { limit: 20 })
  assert.deepEqual(
    rows.map(r => r.id),
    [c1.id, c2.id, c3.id]
  )
  assert.ok(
    rows.every(r => r.author && r.author.display_name === '댓글테스트작성자'),
    '각 댓글에 저자 임베드(display_name)가 있어야 한다'
  )
})

test('listCommentsKeyset: 커서 이후의 댓글만 돌려준다((created_at, id) 커서)', async () => {
  const { createComment, listCommentsKeyset } = await loadFreshCommentsModule()
  const postId = await seedPost()
  const c1 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '1' })
  await new Promise(resolve => setTimeout(resolve, 5))
  const c2 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '2' })
  await new Promise(resolve => setTimeout(resolve, 5))
  const c3 = await createComment({ post_id: postId, author_id: seededAuthorId, content: '3' })

  const nextPage = await listCommentsKeyset(postId, {
    createdAt: c1.created_at,
    id: c1.id,
    limit: 20,
  })
  assert.deepEqual(
    nextPage.map(r => r.id),
    [c2.id, c3.id],
    '커서(c1) 이후의 댓글만(c1 자신 제외) 나와야 한다'
  )
})

test('listCommentsKeyset: created_at이 동일한 댓글들은 id로 타이브레이크하고, 커서 페이지네이션이 겹치거나 빠뜨리지 않는다', async () => {
  const { listCommentsKeyset } = await loadFreshCommentsModule()
  const postId = await seedPost()
  // 동일 timestamp_ms를 강제하기 위해 setupClient로 직접 INSERT한다(id는
  // 사전식 순서를 고정: idA < idB < idC).
  const fixedMs = Date.parse('2026-03-01T00:00:00.000Z')
  const rowsToInsert = [
    { id: 'cmt-tie-a', content: 'A' },
    { id: 'cmt-tie-b', content: 'B' },
    { id: 'cmt-tie-c', content: 'C' },
  ]
  for (const row of rowsToInsert) {
    await setupClient.execute({
      sql: `INSERT INTO comments (id, post_id, author_id, content, created_at, updated_at, like_count)
            VALUES (?, ?, ?, ?, ?, ?, 0)`,
      args: [row.id, postId, seededAuthorId, row.content, fixedMs, fixedMs],
    })
  }

  const firstPage = await listCommentsKeyset(postId, { limit: 2 })
  assert.deepEqual(
    firstPage.map(r => r.id),
    ['cmt-tie-a', 'cmt-tie-b']
  )

  const last = firstPage[firstPage.length - 1]
  const secondPage = await listCommentsKeyset(postId, {
    createdAt: last.created_at,
    id: last.id,
    limit: 2,
  })
  assert.deepEqual(
    secondPage.map(r => r.id),
    ['cmt-tie-c']
  )

  const combined = new Set([...firstPage, ...secondPage].map(r => r.id))
  assert.equal(combined.size, 3, '두 페이지를 합치면 겹치거나 빠진 것 없이 3건이어야 한다')
})

test('listCommentsKeyset: 존재하지 않는 게시글 id는 빈 배열을 돌려준다', async () => {
  const { listCommentsKeyset } = await loadFreshCommentsModule()
  const rows = await listCommentsKeyset('00000000-0000-4000-8000-000000000000', { limit: 20 })
  assert.deepEqual(rows, [])
})

// ------------------------------------------------------- 소스 가드: 배치 저자 조회

test('listCommentsKeyset 구현은 getProfilesByIds(배치)를 쓴다 — 댓글마다 프로필을 조회하지 않는다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/comments.ts', 'utf8')
  assert.match(src, /import\s*\{\s*getProfilesByIds\s*\}\s*from\s*['"]\.\/profiles\.ts['"]/)
  assert.match(src, /getProfilesByIds\(authorIds\)/)
  assert.doesNotMatch(
    src,
    /for\s*\(\s*const\s+row\s+of\s+rows\s*\)\s*\{\s*await\s+getProfileById/,
    '댓글마다 순차적으로 getProfileById를 부르면 N+1이다'
  )
})
