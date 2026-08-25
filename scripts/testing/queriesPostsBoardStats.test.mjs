import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/posts.ts`의 Task 8 신설 함수(`listBoardPostsWithStats`
 * — `board_posts_with_stats` 뷰 대체, `searchPostsAdvanced`/
 * `countPostsAdvanced` — 없는 RPC `search_posts_advanced`/`count_posts_advanced`
 * 대체, `listPostsForAdmin`/`getAdminPostStats` — 관리자 게시글 목록/통계)를
 * 실제 SQLite 파일 DB로 검증한다. 패턴은 `scripts/testing/queriesLikes.test.mjs`
 * 와 동일.
 */

const DB_PATH = 'scripts/testing/.queries-posts-board-stats-test.db'
const POSTS_MODULE_URL = new URL('../../src/db/queries/posts.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)
const COMMENTS_MODULE_URL = new URL('../../src/db/queries/comments.ts', import.meta.url)
const ATTACHMENTS_MODULE_URL = new URL('../../src/db/queries/attachments.ts', import.meta.url)

async function loadFreshPostsModule() {
  return import(`${POSTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshCommentsModule() {
  return import(`${COMMENTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshAttachmentsModule() {
  return import(`${ATTACHMENTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
let authorId

async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `board-stats-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? `저자${seedCounter}`,
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function seedPost(overrides = {}) {
  const { createPost } = await loadFreshPostsModule()
  const post = await createPost({
    title: overrides.title ?? `게시글-${++seedCounter}`,
    content: overrides.content ?? '내용',
    content_format: 'plain',
    category: overrides.category ?? '잡담',
    author_id: overrides.authorId ?? authorId,
    is_pinned: overrides.is_pinned ?? false,
  })
  return post.id
}

test('사전 준비: 공통 저자를 심는다', async () => {
  authorId = await seedProfile({ id: 'board-stats-author', display_name: '공통저자' })
  assert.ok(authorId)
})

// ---------------------------------------------------------------- listBoardPostsWithStats

test('listBoardPostsWithStats: 댓글수·첨부통계·저자명을 배치로 집계한다', async () => {
  const { listBoardPostsWithStats } = await loadFreshPostsModule()
  const { createComment } = await loadFreshCommentsModule()
  const { addAttachment } = await loadFreshAttachmentsModule()

  const postId = await seedPost({ title: '집계테스트글' })
  await createComment({ post_id: postId, author_id: authorId, content: '댓글1' })
  await createComment({ post_id: postId, author_id: authorId, content: '댓글2' })
  await addAttachment({
    post_id: postId,
    file_name: 'a.png',
    file_url: 'https://example.com/a.png',
    file_type: 'image',
    file_size: 1000,
    mime_type: 'image/png',
  })
  await addAttachment({
    post_id: postId,
    file_name: 'b.pdf',
    file_url: 'https://example.com/b.pdf',
    file_type: 'document',
    file_size: 2000,
    mime_type: 'application/pdf',
  })
  // 임시 첨부는 집계에서 제외돼야 한다(뷰의 is_temporary IS NOT TRUE와 동일).
  await addAttachment({
    post_id: postId,
    file_name: 'temp.png',
    file_url: 'https://example.com/temp.png',
    file_type: 'image',
    file_size: 500,
    mime_type: 'image/png',
    is_temporary: true,
  })

  const { rows } = await listBoardPostsWithStats({ category: '전체', offset: 0, limit: 20 })
  const row = rows.find(r => r.id === postId)
  assert.ok(row, '방금 심은 게시글이 목록에 있어야 한다')
  assert.equal(row.comment_count, 2)
  assert.equal(row.total_attachments, 2, '임시 첨부는 집계에서 빠져야 한다')
  assert.equal(row.total_size, 3000)
  assert.equal(row.image_count, 1)
  assert.equal(row.document_count, 1)
  assert.equal(row.author_display_name, '공통저자')
  assert.equal(row.content_head, '내용')
})

test('listBoardPostsWithStats: content_head는 2000자로 절단된다(left(content,2000) 대체)', async () => {
  const { listBoardPostsWithStats } = await loadFreshPostsModule()
  const longContent = 'x'.repeat(3000)
  const postId = await seedPost({ title: '긴글', content: longContent })

  const { rows } = await listBoardPostsWithStats({ category: '전체', offset: 0, limit: 50 })
  const row = rows.find(r => r.id === postId)
  assert.equal(row.content_head.length, 2000)
})

test('listBoardPostsWithStats: 댓글/첨부가 없는 게시글은 0으로 채워진다', async () => {
  const { listBoardPostsWithStats } = await loadFreshPostsModule()
  const postId = await seedPost({ title: '빈글' })

  const { rows } = await listBoardPostsWithStats({ category: '전체', offset: 0, limit: 50 })
  const row = rows.find(r => r.id === postId)
  assert.equal(row.comment_count, 0)
  assert.equal(row.total_attachments, 0)
  assert.equal(row.total_size, 0)
})

test('listBoardPostsWithStats: is_pinned desc, created_at desc, id desc로 정렬된다', async () => {
  const { listBoardPostsWithStats } = await loadFreshPostsModule()
  const category = `정렬테스트-${++seedCounter}`
  const normalId = await seedPost({ category, title: '일반글' })
  const pinnedId = await seedPost({ category, title: '고정글', is_pinned: true })

  const { rows } = await listBoardPostsWithStats({ category, offset: 0, limit: 10 })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, pinnedId, '고정글이 먼저 와야 한다')
  assert.equal(rows[1].id, normalId)
})

test('listBoardPostsWithStats: hasNext는 limit+1행 존재 여부로 판정한다', async () => {
  const { listBoardPostsWithStats } = await loadFreshPostsModule()
  const category = `페이지테스트-${++seedCounter}`
  for (let i = 0; i < 3; i++) {
    await seedPost({ category, title: `페이지글-${i}` })
  }

  const page1 = await listBoardPostsWithStats({ category, offset: 0, limit: 2 })
  assert.equal(page1.rows.length, 2)
  assert.equal(page1.hasNext, true)

  const page2 = await listBoardPostsWithStats({ category, offset: 2, limit: 2 })
  assert.equal(page2.rows.length, 1)
  assert.equal(page2.hasNext, false)
})

test('listBoardPostsWithStats: 삭제된 게시글은 제외된다', async () => {
  const { listBoardPostsWithStats, softDeletePost } = await loadFreshPostsModule()
  const category = `삭제테스트-${++seedCounter}`
  const postId = await seedPost({ category, title: '삭제될글' })
  await softDeletePost(postId)

  const { rows } = await listBoardPostsWithStats({ category, offset: 0, limit: 10 })
  assert.equal(rows.length, 0)
})

// ---------------------------------------------------------------- searchPostsAdvanced / countPostsAdvanced

test('searchPostsAdvanced: title/content LIKE 검색이 동작한다', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const category = `검색테스트-${++seedCounter}`
  await seedPost({ category, title: '자몽 케이크 레시피', content: '평범한 내용' })
  await seedPost({ category, title: '평범한 제목', content: '자몽 향이 나는 내용' })
  await seedPost({ category, title: '무관한 글', content: '무관한 내용' })

  const { rows, total } = await searchPostsAdvanced({
    simpleFilters: { category },
    searchText: '자몽',
    searchFields: ['title', 'content'],
    page: 1,
    limit: 20,
  })
  assert.equal(total, 2)
  assert.equal(rows.length, 2)
})

test('searchPostsAdvanced: is_pinned/category 단순 필터가 함께 적용된다', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const category = `필터테스트-${++seedCounter}`
  await seedPost({ category, title: '고정1', is_pinned: true })
  await seedPost({ category, title: '일반1', is_pinned: false })

  const { rows, total } = await searchPostsAdvanced({
    simpleFilters: { category, is_pinned: true },
    page: 1,
    limit: 20,
  })
  assert.equal(total, 1)
  assert.equal(rows[0].is_pinned, true)
})

test('searchPostsAdvanced: comment_count 정렬은 배치 집계 후 JS에서 정렬한다', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const { createComment } = await loadFreshCommentsModule()
  const category = `댓글정렬테스트-${++seedCounter}`
  const fewId = await seedPost({ category, title: '댓글적음' })
  const manyId = await seedPost({ category, title: '댓글많음' })
  await createComment({ post_id: fewId, author_id: authorId, content: 'c1' })
  await createComment({ post_id: manyId, author_id: authorId, content: 'c1' })
  await createComment({ post_id: manyId, author_id: authorId, content: 'c2' })
  await createComment({ post_id: manyId, author_id: authorId, content: 'c3' })

  const { rows } = await searchPostsAdvanced({
    simpleFilters: { category },
    sortField: 'comment_count',
    sortDirection: 'desc',
    page: 1,
    limit: 20,
  })
  assert.equal(rows[0].id, manyId)
  assert.equal(rows[0].comment_count, 3)
  assert.equal(rows[1].id, fewId)
  assert.equal(rows[1].comment_count, 1)
})

test('searchPostsAdvanced: 기본은 삭제된 글을 제외한다', async () => {
  const { searchPostsAdvanced, softDeletePost } = await loadFreshPostsModule()
  const category = `삭제필터테스트-${++seedCounter}`
  const postId = await seedPost({ category, title: '삭제됨' })
  await softDeletePost(postId)

  const { total } = await searchPostsAdvanced({ simpleFilters: { category }, page: 1, limit: 20 })
  assert.equal(total, 0)
})

test('countPostsAdvanced: searchPostsAdvanced의 total과 일치한다(경계 페이지에서도 정확)', async () => {
  const { searchPostsAdvanced, countPostsAdvanced } = await loadFreshPostsModule()
  const category = `카운트테스트-${++seedCounter}`
  for (let i = 0; i < 5; i++) {
    await seedPost({ category, title: `카운트글-${i}` })
  }

  // 마지막 페이지를 넘어서는 요청 — searchPostsAdvanced의 count(*) over()는
  // 이 경우 행이 0개라 total도 0으로 잘못 떨어진다(brief 경고). countPostsAdvanced는
  // 별도 COUNT 쿼리라 이 경계에서도 정확해야 한다.
  const overPage = await searchPostsAdvanced({
    simpleFilters: { category },
    page: 100,
    limit: 20,
  })
  assert.equal(overPage.total, 0, '경계 확인: count(*) over()는 빈 페이지에서 0이 된다')

  const accurateCount = await countPostsAdvanced({ simpleFilters: { category } })
  assert.equal(accurateCount, 5, 'countPostsAdvanced는 별도 쿼리라 페이지 위치와 무관하게 정확하다')
})

// ---------------------------------------------------------------- listPostsForAdmin

test('listPostsForAdmin: filter=all은 삭제된 글도 포함한다(기존 Supabase 동작 보존)', async () => {
  const { listPostsForAdmin, softDeletePost } = await loadFreshPostsModule()
  const category = `관리자all테스트-${++seedCounter}`
  const activeId = await seedPost({ category, title: '활성글' })
  const deletedId = await seedPost({ category, title: '삭제글' })
  await softDeletePost(deletedId)

  const { rows, total } = await listPostsForAdmin({ filter: category, page: 1, limit: 20 })
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(activeId))
  assert.ok(ids.includes(deletedId), '카테고리 필터는 is_deleted를 걸지 않는다 — 기존 동작 보존')
  assert.equal(total, 2)
})

test('listPostsForAdmin: filter=deleted는 삭제된 글만 보여준다', async () => {
  const { listPostsForAdmin, softDeletePost } = await loadFreshPostsModule()
  const category = `관리자deleted테스트-${++seedCounter}`
  await seedPost({ category, title: '활성글2' })
  const deletedId = await seedPost({ category, title: '삭제글2' })
  await softDeletePost(deletedId)

  const { rows } = await listPostsForAdmin({ filter: 'deleted', page: 1, limit: 1000 })
  assert.ok(rows.every(r => r.is_deleted === true))
  assert.ok(rows.some(r => r.id === deletedId))
})

test('listPostsForAdmin: total은 별도 COUNT라 마지막 페이지를 넘어도 정확하다', async () => {
  const { listPostsForAdmin } = await loadFreshPostsModule()
  const category = `관리자경계테스트-${++seedCounter}`
  for (let i = 0; i < 3; i++) {
    await seedPost({ category, title: `관리자글-${i}` })
  }

  const { rows, total } = await listPostsForAdmin({ filter: category, page: 100, limit: 20 })
  assert.equal(rows.length, 0, '경계 페이지라 행은 0개')
  assert.equal(total, 3, 'total은 count(*) over()가 아니라 별도 쿼리라 0으로 떨어지지 않는다')
})

test('listPostsForAdmin: 검색어는 title/content에 LIKE로 매칭된다', async () => {
  const { listPostsForAdmin } = await loadFreshPostsModule()
  const category = `관리자검색테스트-${++seedCounter}`
  await seedPost({ category, title: '검색어포함제목' })
  await seedPost({ category, title: '무관', content: '검색어포함내용' })
  await seedPost({ category, title: '전혀무관' })

  const { rows, total } = await listPostsForAdmin({
    filter: category,
    search: '검색어포함',
    page: 1,
    limit: 20,
  })
  assert.equal(total, 2)
  assert.equal(rows.length, 2)
})

// ---------------------------------------------------------------- getAdminPostStats

test('getAdminPostStats: 전체/삭제/고정/카테고리별 집계가 실제 행 수와 일치한다', async () => {
  const { getAdminPostStats, softDeletePost } = await loadFreshPostsModule()
  const before_ = await getAdminPostStats()

  const noticeId = await seedPost({ category: '공지', title: '공지글', is_pinned: true })
  await seedPost({ category: '잡담', title: '잡담글' })
  const deletedId = await seedPost({ category: '건의', title: '삭제될건의글' })
  await softDeletePost(deletedId)

  const after_ = await getAdminPostStats()
  assert.equal(after_.totalPosts, before_.totalPosts + 3)
  assert.equal(after_.totalDeleted, before_.totalDeleted + 1)
  assert.equal(after_.totalPinned, before_.totalPinned + 1)
  assert.equal(after_.categoryStats['공지'], before_.categoryStats['공지'] + 1)
  assert.equal(after_.categoryStats['잡담'], before_.categoryStats['잡담'] + 1)
  // 삭제된 글은 카테고리 집계(is_deleted=false 조건)에서 제외된다.
  assert.equal(after_.categoryStats['건의'], before_.categoryStats['건의'])
  assert.ok(noticeId)
})
