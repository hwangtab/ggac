import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/posts.ts`를 실제 SQLite 파일 DB(스텁 mock이 아니라)로
 * 검증한다. 스키마는 `src/db/migrations/0000_dizzy_krista_starr.sql`을 그대로
 * 실행해 만든다 — `scripts/testing/queriesProfiles.test.mjs`와 같은 패턴이다.
 *
 * `posts`는 `member_profiles(id)`를 참조하는 FK라 먼저 `profiles.ts`의
 * `upsertProfile`로 저자를 심고, `posts` 행 자체는 이 모듈에 쓰기 함수가 없어
 * (Task 5 몫) `setupClient.execute`로 직접 INSERT한다.
 */

const DB_PATH = 'scripts/testing/.queries-posts-test.db'
const POSTS_MODULE_URL = new URL('../../src/db/queries/posts.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

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

test('부정 대조 기반: getPostById가 실제로 DB에 접속하지 못하면 던진다(조용히 null로 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { getPostById } = await loadFreshPostsModule()
    await assert.rejects(() => getPostById('any-id'))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

function makeProfile(overrides = {}) {
  return {
    id: overrides.id,
    email: overrides.email,
    display_name: overrides.display_name ?? '테스트회원',
    registration_status: overrides.registration_status ?? 'approved',
    is_active: overrides.is_active ?? true,
    ...overrides,
  }
}

let seededAuthorId
let seedCounter = 0

async function seedAuthor(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `author-${++seedCounter}`
  await upsertProfile(
    makeProfile({ id, email: `${id}@test.local`, display_name: overrides.display_name ?? id })
  )
  return id
}

async function insertPost(overrides = {}) {
  const id = overrides.id ?? `post-${++seedCounter}`
  const now = overrides.createdAtMs ?? Date.now()
  const updatedAt = overrides.updatedAtMs ?? now
  await setupClient.execute({
    sql: `INSERT INTO posts (id, title, content, category, author_id, created_at, updated_at, is_deleted, is_pinned, pinned_at, content_format, like_count, view_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      overrides.title ?? `제목-${id}`,
      overrides.content ?? `내용-${id}`,
      overrides.category ?? '잡담',
      overrides.authorId ?? seededAuthorId,
      now,
      updatedAt,
      overrides.isDeleted ? 1 : 0,
      overrides.isPinned ? 1 : 0,
      overrides.pinnedAtMs ?? null,
      overrides.contentFormat ?? 'plain',
      overrides.likeCount ?? 0,
      overrides.viewCount ?? 0,
    ],
  })
  return id
}

test('사전 준비: 공통 저자 프로필을 심는다', async () => {
  seededAuthorId = await seedAuthor({ id: 'author-common', display_name: '테스트회원' })
  assert.ok(seededAuthorId)
})

// ---------------------------------------------------------------- getPostById

test('getPostById: author를 PostgREST 임베드와 같은 모양(id, display_name, email 객체)으로 돌려준다', async () => {
  const { getPostById } = await loadFreshPostsModule()
  const postId = await insertPost({ title: '단건 조회 테스트' })

  const post = await getPostById(postId, { includeDeleted: false })
  assert.ok(post)
  assert.equal(post.id, postId)
  assert.equal(post.title, '단건 조회 테스트')
  assert.equal(typeof post.author, 'object')
  assert.equal(post.author, post.author) // 존재 확인(널 아님)
  assert.ok(post.author, 'author는 null이면 안 된다 — post.author.display_name에서 죽는다')
  assert.equal(post.author.id, seededAuthorId)
  assert.equal(post.author.display_name, '테스트회원')
  assert.equal(typeof post.author.email, 'string')

  // snake_case 키만 있어야 한다.
  for (const key of Object.keys(post)) {
    assert.doesNotMatch(key, /[A-Z]/, `${key}는 camelCase 흔적이다`)
  }
  assert.equal(typeof post.created_at, 'string')
  assert.ok(!Number.isNaN(Date.parse(post.created_at)))
})

test('getPostById: 존재하지 않는 id는 null', async () => {
  const { getPostById } = await loadFreshPostsModule()
  const result = await getPostById('00000000-0000-4000-8000-000000000000')
  assert.equal(result, null)
})

test('getPostById: 삭제된 글은 기본적으로 안 보인다(includeDeleted 기본값 false)', async () => {
  const { getPostById } = await loadFreshPostsModule()
  const postId = await insertPost({ title: '삭제된 글', isDeleted: true })

  const hidden = await getPostById(postId)
  assert.equal(hidden, null, 'includeDeleted 생략 시 삭제된 글은 null이어야 한다')

  const shown = await getPostById(postId, { includeDeleted: true })
  assert.ok(shown, 'includeDeleted: true면 삭제된 글도 보여야 한다')
  assert.equal(shown.is_deleted, true)
})

// 참고: `posts.author_id`는 `member_profiles(id)`를 참조하는 FK이고, 로컬
// SQLite 파일 DB에서도 실제로 강제된다(직접 확인함 — 존재하지 않는 저자 id로
// INSERT를 시도하면 SQLITE_CONSTRAINT_FOREIGNKEY로 즉시 거부된다). 그래서
// "프로필을 못 찾는 저자" 시나리오는 실제 DB로 재현할 수 없다 — `attachAuthors`의
// `알 수 없는 사용자` 폴백은 방어적 코드로 남겨두되(참조 무결성이 깨질 수 있는
// 배치 임포트·마이그레이션 경합 등을 대비), 이 사실 자체가 이 폴백이 정상
// 경로에서는 절대 타지 않는다는 걸 실측으로 증명한다.
test('참고: author_id는 실제 FK로 강제된다 — 존재하지 않는 저자로는 글을 심을 수조차 없다', async () => {
  await assert.rejects(
    () => insertPost({ title: '유령 저자', authorId: 'ghost-author-id' }),
    /FOREIGN KEY|FOREIGNKEY/
  )
})

// ---------------------------------------------------------------- listPosts

test('listPosts: 목록 조회에서 저자를 배치로 가져온다 — 게시글마다 쿼리하지 않는다(N+1 아님, 실제 정확성)', async () => {
  const { listPosts } = await loadFreshPostsModule()
  const authorA = await seedAuthor({ display_name: '작가A' })
  const authorB = await seedAuthor({ display_name: '작가B' })
  const ids = []
  for (let i = 0; i < 6; i++) {
    ids.push(
      await insertPost({
        title: `배치테스트-${i}`,
        category: '공지',
        authorId: i % 2 === 0 ? authorA : authorB,
        createdAtMs: Date.now() + i,
      })
    )
  }

  const { rows } = await listPosts({ category: '공지', page: 1, limit: 20 })
  const found = rows.filter(r => ids.includes(r.id))
  assert.equal(found.length, 6)
  for (const row of found) {
    assert.ok(row.author.display_name === '작가A' || row.author.display_name === '작가B')
  }
})

test('listPosts 구현은 db.select를 정확히 한 번만 호출한다 (소스 가드 — N+1 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/posts.ts', 'utf8')
  const match = src.match(/export async function listPosts\([\s\S]*?\n\}\n/)
  assert.ok(match, 'listPosts 함수 본문을 찾지 못했다')
  const body = match[0]

  const selectCalls = body.match(/db\s*\.select\(/g) ?? []
  assert.equal(selectCalls.length, 1, 'listPosts 자체는 db.select 호출이 정확히 한 번이어야 한다')
  assert.match(body, /attachAuthors\(/, '저자는 attachAuthors(배치)로 붙여야 한다')
})

test('attachAuthors 구현은 getProfilesByIds(배치)를 쓰고 id별 getProfileById 루프를 쓰지 않는다 (소스 가드 — N+1 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/posts.ts', 'utf8')
  const match = src.match(/async function attachAuthors\([\s\S]*?\n\}\n/)
  assert.ok(match, 'attachAuthors 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.match(body, /getProfilesByIds\(/, '저자 배치 조회는 getProfilesByIds를 써야 한다')
  assert.doesNotMatch(
    body,
    /getProfileById\(/,
    'attachAuthors가 단건 조회 함수를 id별로 호출하면 N+1이다'
  )
})

test('listPosts: is_deleted=true인 글은 기본적으로 목록에서 빠진다', async () => {
  const { listPosts } = await loadFreshPostsModule()
  const deletedId = await insertPost({ title: '목록에서 사라져야 함', isDeleted: true })

  const { rows } = await listPosts({ page: 1, limit: 200 })
  assert.ok(!rows.some(r => r.id === deletedId), '삭제된 글이 목록에 되살아나면 안 된다')

  const { rows: withDeleted } = await listPosts({ page: 1, limit: 200, includeDeleted: true })
  assert.ok(
    withDeleted.some(r => r.id === deletedId),
    'includeDeleted: true면 보여야 한다'
  )
})

test('listPosts: category 필터·정렬(created_at desc 기본)·페이지네이션·total이 동작한다', async () => {
  const { listPosts } = await loadFreshPostsModule()
  const cat = `카테고리테스트-${Date.now()}`
  const first = await insertPost({ category: cat, createdAtMs: 1000 })
  const second = await insertPost({ category: cat, createdAtMs: 2000 })
  const third = await insertPost({ category: cat, createdAtMs: 3000 })

  const { rows, total } = await listPosts({ category: cat, page: 1, limit: 50 })
  assert.equal(total, 3)
  assert.deepEqual(
    rows.map(r => r.id),
    [third, second, first],
    'created_at 내림차순이어야 한다'
  )

  const page1 = await listPosts({ category: cat, page: 1, limit: 1 })
  const page2 = await listPosts({ category: cat, page: 2, limit: 1 })
  assert.equal(page1.rows[0].id, third)
  assert.equal(page2.rows[0].id, second)
})

// ---------------------------------------------------------------- listPostsKeyset

test('listPostsKeyset: 커서 없는 첫 페이지는 is_pinned를 우선 정렬한다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `핀테스트-${Date.now()}`
  const normal1 = await insertPost({ category: cat, createdAtMs: 5000 })
  const pinned = await insertPost({ category: cat, createdAtMs: 1000, isPinned: true })
  const normal2 = await insertPost({ category: cat, createdAtMs: 4000 })

  const { rows, hasNext } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  assert.equal(hasNext, false)
  assert.deepEqual(
    rows.map(r => r.id),
    [pinned, normal1, normal2],
    'pinned 글이 created_at과 무관하게 맨 앞이어야 한다'
  )
})

test('listPostsKeyset: 커서가 있으면 is_pinned 우선 정렬을 적용하지 않는다(기존 동작)', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `핀커서테스트-${Date.now()}`
  const older = await insertPost({ category: cat, createdAtMs: 1000 })
  const pinnedNewer = await insertPost({ category: cat, createdAtMs: 9000, isPinned: true })
  const newest = await insertPost({ category: cat, createdAtMs: 10000 })

  // newest를 커서로 다음 페이지 요청 — is_pinned 우선순위 없이 순수 created_at desc여야 한다.
  const { rows } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 20,
    cursor: { createdAt: new Date(10000).toISOString(), id: newest },
  })
  assert.deepEqual(
    rows.map(r => r.id),
    [pinnedNewer, older],
    'pinned이어도 커서 있는 페이지에서는 created_at 순서를 따라야 한다'
  )
})

test('listPostsKeyset: hasNext는 limit+1로 판단하고, 초과분은 응답에서 잘린다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `페이지네이션테스트-${Date.now()}`
  for (let i = 0; i < 5; i++) {
    await insertPost({ category: cat, createdAtMs: 1000 + i })
  }

  const { rows, hasNext } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 3,
    cursor: null,
  })
  assert.equal(rows.length, 3)
  assert.equal(hasNext, true)

  const { rows: allRows, hasNext: noMore } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 10,
    cursor: null,
  })
  assert.equal(allRows.length, 5)
  assert.equal(noMore, false)
})

test('listPostsKeyset: search는 title/content 부분일치 OR, 2글자 미만 토큰은 무시한다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `검색테스트-${Date.now()}`
  const matchTitle = await insertPost({
    category: cat,
    title: '공지사항 안내드립니다',
    content: 'x',
  })
  const matchContent = await insertPost({
    category: cat,
    title: 'x',
    content: '중요 공지사항 내용',
  })
  const noMatch = await insertPost({ category: cat, title: '무관한 글', content: '무관한 내용' })

  const { rows } = await listPostsKeyset({
    category: cat,
    search: '공지사항',
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  const foundIds = rows.map(r => r.id)
  assert.ok(foundIds.includes(matchTitle))
  assert.ok(foundIds.includes(matchContent))
  assert.ok(!foundIds.includes(noMatch))
})

test('listPostsKeyset: is_deleted=true인 글은 검색·목록에서 빠진다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `삭제필터테스트-${Date.now()}`
  const deletedId = await insertPost({ category: cat, isDeleted: true })
  const aliveId = await insertPost({ category: cat })

  const { rows } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  const ids = rows.map(r => r.id)
  assert.ok(!ids.includes(deletedId))
  assert.ok(ids.includes(aliveId))
})
