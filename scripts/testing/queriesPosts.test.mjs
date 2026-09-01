import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/posts.ts`를 실제 SQLite 파일 DB(스텁 mock이 아니라)로
 * 검증한다. 스키마는 `src/db/migrations/`의 마이그레이션 전부를 그대로
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
  await applyMigrations(setupClient)
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

test('listPostsKeyset: search=%%·__는 LIKE 와일드카드로 해석되지 않는다(전체 목록을 반환하면 안 된다)', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `와일드카드테스트-${Date.now()}`
  await insertPost({ category: cat, title: '아무거나1', content: '내용1' })
  await insertPost({ category: cat, title: '아무거나2', content: '내용2' })

  const { rows: unfiltered } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  assert.equal(unfiltered.length, 2, '사전 조건: 이 카테고리에 글이 2건 있어야 한다')

  for (const needle of ['%%', '__']) {
    const { rows } = await listPostsKeyset({
      category: cat,
      search: needle,
      sortOrder: 'desc',
      limit: 20,
      cursor: null,
    })
    assert.equal(
      rows.length,
      0,
      `search=${JSON.stringify(needle)}는 제목/내용에 %나 _이 없는 글과 매치되면 안 된다(실측 회귀 — 이 값이 검색 없을 때와 같은 전체 목록을 냈었다)`
    )
  }
})

test('listPostsKeyset: 존재하지 않는 검색어는 빈 결과, 실제 검색어는 여전히 찾는다(회귀 방지)', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `정상검색회귀-${Date.now()}`
  const matched = await insertPost({ category: cat, title: '가나다검색어포함', content: 'x' })
  const notMatched = await insertPost({ category: cat, title: '무관한글', content: '무관한내용' })

  const { rows: none } = await listPostsKeyset({
    category: cat,
    search: 'zzzznonexistent',
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  assert.equal(none.length, 0)

  const { rows: found } = await listPostsKeyset({
    category: cat,
    search: '가나다검색어',
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  const foundIds = found.map(r => r.id)
  assert.ok(foundIds.includes(matched))
  assert.ok(!foundIds.includes(notMatched))
})

test('listPostsKeyset: 제목에 literal %가 있으면 % 검색으로 그 글만 찾는다(이스케이프 후에도 리터럴 매치는 유지)', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `리터럴퍼센트-${Date.now()}`
  const withPercent = await insertPost({ category: cat, title: '할인 50% 진행중', content: 'x' })
  const withoutPercent = await insertPost({ category: cat, title: '할인 진행중', content: 'x' })

  const { rows } = await listPostsKeyset({
    category: cat,
    search: '50%',
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(withPercent))
  assert.ok(!ids.includes(withoutPercent))
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

test('listPostsKeyset: sortOrder=asc는 커서 없는 첫 페이지에서도 created_at 오름차순을 지킨다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `오름차순테스트-${Date.now()}`
  // 전부 is_pinned: false — pinned 우선 정렬(cursor null일 때 적용)이 개입할
  // 여지를 없애 순수하게 created_at asc/desc 방향만 검증한다.
  const oldest = await insertPost({ category: cat, createdAtMs: 1000 })
  const middle = await insertPost({ category: cat, createdAtMs: 2000 })
  const newest = await insertPost({ category: cat, createdAtMs: 3000 })

  const { rows: ascRows } = await listPostsKeyset({
    category: cat,
    sortOrder: 'asc',
    limit: 20,
    cursor: null,
  })
  assert.deepEqual(
    ascRows.map(r => r.id),
    [oldest, middle, newest],
    'sortOrder: asc는 오래된 글부터(created_at 오름차순) 나와야 한다'
  )

  // 대조: 같은 데이터를 desc로 요청하면 정반대 순서여야 한다 — asc 테스트가
  // "우연히 통과"가 아니라 방향을 실제로 구분하고 있음을 증명한다.
  const { rows: descRows } = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 20,
    cursor: null,
  })
  assert.deepEqual(
    descRows.map(r => r.id),
    [newest, middle, oldest],
    'sortOrder: desc는 최신 글부터 나와야 한다'
  )
})

test('listPostsKeyset: created_at이 동일한 글들은 id로 타이브레이크하고, 커서 페이지네이션이 겹치거나 빠뜨리지 않는다', async () => {
  const { listPostsKeyset } = await loadFreshPostsModule()
  const cat = `타이브레이크테스트-${Date.now()}`
  const sameCreatedAtMs = 7777
  // id를 명시해 사전식 순서를 고정한다(insertPost 기본 id는 순번이라
  // 'post-9' < 'post-10'처럼 사전식 비교가 직관과 어긋나 타이브레이크
  // 단언이 흔들릴 수 있다).
  const idA = `${cat}-a`
  const idB = `${cat}-b`
  const idC = `${cat}-c`
  await insertPost({ id: idC, category: cat, createdAtMs: sameCreatedAtMs })
  await insertPost({ id: idA, category: cat, createdAtMs: sameCreatedAtMs })
  await insertPost({ id: idB, category: cat, createdAtMs: sameCreatedAtMs })

  // 커서 없는 첫 페이지: created_at이 전부 같으므로 id 내림차순(desc)만으로
  // 정렬돼야 한다 — 곧 idC, idB, idA 순.
  const firstPage = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 2,
    cursor: null,
  })
  assert.deepEqual(
    firstPage.rows.map(r => r.id),
    [idC, idB],
    'created_at이 같으면 id 내림차순으로 타이브레이크해야 한다'
  )
  assert.equal(firstPage.hasNext, true)

  // 커서(마지막 행의 created_at/id)로 다음 페이지를 요청 — 겹치지도(idB 재출현)
  // 빠뜨리지도(idA 누락) 않아야 한다.
  const lastOfFirstPage = firstPage.rows[firstPage.rows.length - 1]
  const secondPage = await listPostsKeyset({
    category: cat,
    sortOrder: 'desc',
    limit: 2,
    cursor: {
      createdAt: lastOfFirstPage.created_at,
      id: lastOfFirstPage.id,
    },
  })
  assert.deepEqual(
    secondPage.rows.map(r => r.id),
    [idA],
    '두 번째 페이지는 idA 하나만 와야 한다 — idB 중복도, idA 누락도 아니다'
  )
  assert.equal(secondPage.hasNext, false)

  // 두 페이지를 합치면 겹침·누락 없이 정확히 3건이어야 한다.
  const combined = [...firstPage.rows, ...secondPage.rows].map(r => r.id)
  assert.deepEqual(new Set(combined).size, 3, '두 페이지 합쳐 중복이 없어야 한다')
  assert.deepEqual(
    [...combined].sort(),
    [idA, idB, idC].sort(),
    '세 글 모두 정확히 한 번씩 나와야 한다'
  )
})
