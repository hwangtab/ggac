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

/**
 * 코드리뷰 Important 1 대응: 관리자 화면의 boolean 필터 에디터
 * (`src/components/filters/FilterConditionEditor.tsx`)는 `<option
 * value="true">예</option>`처럼 **문자열** `'true'`/`'false'`를 보낸다 —
 * JS boolean이 아니다. 라우트가 이 값을 그대로 `simpleFilters.is_pinned`에
 * 실어 넘기므로, 쿼리 계층이 `typeof === 'boolean'`만 검사하면 이 문자열은
 * 항상 걸러져 필터가 조용히 사라진다(에러 없이 "전체 결과"가 나온다). UI가
 * 실제로 보내는 형태(문자열)로 필터가 걸리는지 확인한다.
 */
test('searchPostsAdvanced: is_pinned가 문자열 "true"/"false"로 와도(UI가 실제로 보내는 형태) 필터가 걸린다', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const category = `문자열불리언테스트-${++seedCounter}`
  const pinnedId = await seedPost({ category, title: '고정2', is_pinned: true })
  const normalId = await seedPost({ category, title: '일반2', is_pinned: false })

  const pinnedOnly = await searchPostsAdvanced({
    simpleFilters: { category, is_pinned: 'true' },
    page: 1,
    limit: 20,
  })
  assert.equal(pinnedOnly.total, 1, '문자열 "true"도 is_pinned=true로 정확히 좁혀야 한다')
  assert.equal(pinnedOnly.rows[0].id, pinnedId)

  const unpinnedOnly = await searchPostsAdvanced({
    simpleFilters: { category, is_pinned: 'false' },
    page: 1,
    limit: 20,
  })
  assert.equal(unpinnedOnly.total, 1, '문자열 "false"도 is_pinned=false로 정확히 좁혀야 한다')
  assert.equal(unpinnedOnly.rows[0].id, normalId)

  // 부정 대조: 필터를 아예 안 걸면(빈 문자열/미지정) 두 건 다 나와야 한다 —
  // "필터가 항상 걸린다"가 아니라 "값이 있을 때만 걸린다"는 것을 함께 확인.
  const noFilter = await searchPostsAdvanced({
    simpleFilters: { category, is_pinned: '' },
    page: 1,
    limit: 20,
  })
  assert.equal(noFilter.total, 2, '빈 문자열은 필터 미지정으로 취급해야 한다')
})

test('searchPostsAdvanced: is_deleted가 문자열 "true"로 와도 삭제된 글만 좁힌다', async () => {
  const { searchPostsAdvanced, softDeletePost } = await loadFreshPostsModule()
  const category = `삭제문자열불리언테스트-${++seedCounter}`
  await seedPost({ category, title: '활성유지' })
  const deletedId = await seedPost({ category, title: '삭제예정' })
  await softDeletePost(deletedId)

  const { rows, total } = await searchPostsAdvanced({
    simpleFilters: { category, is_deleted: 'true' },
    page: 1,
    limit: 20,
  })
  assert.equal(total, 1)
  assert.equal(rows[0].id, deletedId)
})

test('searchPostsAdvanced: comment_count 정렬(단일 페이지)이 실제 댓글 수 내림차순이다', async () => {
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

/**
 * 코드리뷰 Important 2 대응: 옛 구현은 DB에서 `created_at desc LIMIT n`으로
 * 한 페이지만 뽑은 뒤 그 페이지 안에서만 댓글 수로 재정렬했다 — 전역 정렬이
 * 아니라 페이지 국소 정렬이었다. 게시글 수가 `limit`을 넘으면 2페이지에
 * 1페이지보다 댓글이 많은 글이 나올 수 있었다. 이 테스트는 댓글 수가
 * created_at 순서와 **일부러 무관하게** 되도록 심어서, 그 결함이 있었다면
 * 반드시 걸리게 만든다 — 페이지 크기(2)보다 많은 게시글(5)을 심고 전 구간에
 * 걸친 정렬을 확인한다.
 */
test('searchPostsAdvanced: comment_count 정렬은 페이지를 넘어 전역적으로 정확하다(다중 페이지 회귀)', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const { createComment } = await loadFreshCommentsModule()
  const category = `댓글정렬다중페이지테스트-${++seedCounter}`

  // 작성 순서(=created_at 오름차순)와 댓글 수를 일부러 어긋나게 심는다.
  const plan = [
    { title: 'post-0', commentCount: 1 },
    { title: 'post-1', commentCount: 5 },
    { title: 'post-2', commentCount: 2 },
    { title: 'post-3', commentCount: 4 },
    { title: 'post-4', commentCount: 0 },
  ]
  const postIds = []
  for (const item of plan) {
    const id = await seedPost({ category, title: item.title })
    for (let i = 0; i < item.commentCount; i++) {
      await createComment({ post_id: id, author_id: authorId, content: `c${i}` })
    }
    postIds.push(id)
  }
  const [id0, id1, id2, id3, id4] = postIds
  // 기대하는 전역 내림차순: post-1(5) > post-3(4) > post-2(2) > post-0(1) > post-4(0)
  const expectedOrder = [id1, id3, id2, id0, id4]

  const limit = 2
  const page1 = await searchPostsAdvanced({
    simpleFilters: { category },
    sortField: 'comment_count',
    sortDirection: 'desc',
    page: 1,
    limit,
  })
  const page2 = await searchPostsAdvanced({
    simpleFilters: { category },
    sortField: 'comment_count',
    sortDirection: 'desc',
    page: 2,
    limit,
  })
  const page3 = await searchPostsAdvanced({
    simpleFilters: { category },
    sortField: 'comment_count',
    sortDirection: 'desc',
    page: 3,
    limit,
  })

  assert.deepEqual(
    page1.rows.map(r => r.id),
    expectedOrder.slice(0, 2),
    '1페이지: 전역 1~2위(post-1, post-3)여야 한다'
  )
  assert.deepEqual(
    page2.rows.map(r => r.id),
    expectedOrder.slice(2, 4),
    '2페이지: 전역 3~4위(post-2, post-0)여야 한다 — 페이지 국소 정렬이었다면 여기서 순서가 틀어진다'
  )
  assert.deepEqual(
    page3.rows.map(r => r.id),
    expectedOrder.slice(4, 5),
    '3페이지: 전역 5위(post-4)'
  )

  // 페이지 경계를 넘는 단조성 직접 확인: 1페이지 최솟값 >= 2페이지 최댓값 >= 3페이지 최댓값.
  const page1Min = Math.min(...page1.rows.map(r => r.comment_count))
  const page2Max = Math.max(...page2.rows.map(r => r.comment_count))
  const page2Min = Math.min(...page2.rows.map(r => r.comment_count))
  const page3Max = Math.max(...page3.rows.map(r => r.comment_count))
  assert.ok(
    page1Min >= page2Max,
    `1페이지 최소 댓글수(${page1Min})는 2페이지 최대 댓글수(${page2Max})보다 크거나 같아야 한다`
  )
  assert.ok(
    page2Min >= page3Max,
    `2페이지 최소 댓글수(${page2Min})는 3페이지 최대 댓글수(${page3Max})보다 크거나 같아야 한다`
  )
})

test('searchPostsAdvanced: comment_count 오름차순 정렬도 전역적으로 정확하다', async () => {
  const { searchPostsAdvanced } = await loadFreshPostsModule()
  const { createComment } = await loadFreshCommentsModule()
  const category = `댓글정렬오름차순테스트-${++seedCounter}`

  const zeroId = await seedPost({ category, title: 'zero' })
  const threeId = await seedPost({ category, title: 'three' })
  const oneId = await seedPost({ category, title: 'one' })
  for (let i = 0; i < 3; i++) {
    await createComment({ post_id: threeId, author_id: authorId, content: `c${i}` })
  }
  await createComment({ post_id: oneId, author_id: authorId, content: 'c0' })

  const { rows } = await searchPostsAdvanced({
    simpleFilters: { category },
    sortField: 'comment_count',
    sortDirection: 'asc',
    page: 1,
    limit: 20,
  })
  assert.deepEqual(
    rows.map(r => r.id),
    [zeroId, oneId, threeId]
  )
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
