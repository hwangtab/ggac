import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/posts.ts`의 쓰기 함수(`createPost`/`updatePost`/
 * `softDeletePost`/`incrementViewCount`)를 실제 SQLite 파일 DB로 검증한다.
 * 패턴은 `scripts/testing/queriesPosts.test.mjs`(Task 4)와 동일.
 */

const DB_PATH = 'scripts/testing/.queries-posts-write-test.db'
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

let seedCounter = 0

async function seedAuthor(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `author-${++seedCounter}`
  await upsertProfile(
    makeProfile({ id, email: `${id}@test.local`, display_name: overrides.display_name ?? id })
  )
  return id
}

let seededAuthorId

test('사전 준비: 공통 저자 프로필을 심는다', async () => {
  seededAuthorId = await seedAuthor({ id: 'author-common-write', display_name: '테스트작성자' })
  assert.ok(seededAuthorId)
})

// ---------------------------------------------------------------- createPost

test('createPost: 게시글을 생성하고 posts 컬럼(author 임베드 없이)을 그대로 돌려준다', async () => {
  const { createPost } = await loadFreshPostsModule()
  const post = await createPost({
    title: '새 글',
    content: '<p>본문</p>',
    content_format: 'html',
    category: '잡담',
    author_id: seededAuthorId,
  })
  assert.ok(post.id)
  assert.equal(post.title, '새 글')
  assert.equal(post.content, '<p>본문</p>')
  assert.equal(post.content_format, 'html')
  assert.equal(post.category, '잡담')
  assert.equal(post.author_id, seededAuthorId)
  assert.equal(post.is_deleted, false)
  assert.equal(post.is_pinned, false)
  assert.equal(post.pinned_at, null)
  assert.equal(post.like_count, 0)
  assert.equal(post.view_count, 0)
  assert.ok(!Number.isNaN(Date.parse(post.created_at)))
  assert.ok(!Number.isNaN(Date.parse(post.updated_at)))
  assert.equal('author' in post, false, 'createPost 응답에는 author 임베드가 없어야 한다')

  // snake_case 키만 있어야 한다.
  for (const key of Object.keys(post)) {
    assert.doesNotMatch(key, /[A-Z]/, `${key}는 camelCase 흔적이다`)
  }
})

test('createPost: is_pinned/pinned_at을 명시하면 그대로 저장한다(공지 작성 시나리오)', async () => {
  const { createPost } = await loadFreshPostsModule()
  const pinnedAt = new Date('2026-01-01T00:00:00.000Z').toISOString()
  const post = await createPost({
    title: '공지',
    content: '내용',
    content_format: 'html',
    category: '공지',
    author_id: seededAuthorId,
    is_pinned: true,
    pinned_at: pinnedAt,
  })
  assert.equal(post.is_pinned, true)
  assert.equal(post.pinned_at, pinnedAt)
})

test('createPost: 존재하지 않는 author_id는 FK 위반으로 거부된다', async () => {
  const { createPost } = await loadFreshPostsModule()
  await assert.rejects(
    () =>
      createPost({
        title: '유령 저자',
        content: 'x',
        content_format: 'plain',
        category: '잡담',
        author_id: 'ghost-author-nope',
      }),
    err => {
      // Drizzle은 원인을 `Failed query: ...` 메시지로 감싸고 실제 SQLite
      // 오류는 `err.cause.message`에 둔다 — 둘을 합쳐 검사한다.
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
      return /FOREIGN KEY|FOREIGNKEY/.test(combined)
    }
  )
})

// ---------------------------------------------------------------- updatePost

test('updatePost가 updated_at을 갱신한다 — 트리거가 없어서 스키마 $onUpdate가 대신한다', async () => {
  const { createPost, updatePost, getPostById } = await loadFreshPostsModule()
  const created = await createPost({
    title: '수정 전',
    content: '수정 전 내용',
    content_format: 'plain',
    category: '잡담',
    author_id: seededAuthorId,
  })
  const before = await getPostById(created.id, { includeDeleted: false })
  // SQLite timestamp_ms는 밀리초 해상도라 같은 틱에 생성+수정하면 값이 같을
  // 수 있다 — 실제 시계 경과를 보장하기 위해 짧게 대기한다.
  await new Promise(resolve => setTimeout(resolve, 5))

  const updated = await updatePost(created.id, { title: '새 제목' })
  assert.ok(updated)
  assert.equal(updated.title, '새 제목')
  const after = await getPostById(created.id, { includeDeleted: false })
  assert.ok(
    new Date(after.updated_at).getTime() > new Date(before.updated_at).getTime(),
    `updated_at이 갱신되지 않았다: before=${before.updated_at}, after=${after.updated_at}`
  )
  // created_at은 그대로여야 한다.
  assert.equal(after.created_at, before.created_at)
})

test('updatePost: 제목/본문/카테고리/고정 여부를 부분 갱신한다 — 넘기지 않은 필드는 그대로다', async () => {
  const { createPost, updatePost } = await loadFreshPostsModule()
  const created = await createPost({
    title: '원래 제목',
    content: '원래 내용',
    content_format: 'plain',
    category: '잡담',
    author_id: seededAuthorId,
  })
  const updated = await updatePost(created.id, {
    content: '바뀐 내용',
    is_pinned: true,
    pinned_at: new Date('2026-02-02T00:00:00.000Z').toISOString(),
  })
  assert.ok(updated)
  assert.equal(updated.title, '원래 제목', '넘기지 않은 title은 그대로 유지돼야 한다')
  assert.equal(updated.content, '바뀐 내용')
  assert.equal(updated.category, '잡담')
  assert.equal(updated.is_pinned, true)
  assert.equal(updated.pinned_at, new Date('2026-02-02T00:00:00.000Z').toISOString())
})

test('updatePost: 공지 해제 시 pinned_at을 null로 되돌릴 수 있다', async () => {
  const { createPost, updatePost } = await loadFreshPostsModule()
  const created = await createPost({
    title: '공지였던 글',
    content: '내용',
    content_format: 'plain',
    category: '공지',
    author_id: seededAuthorId,
    is_pinned: true,
    pinned_at: new Date().toISOString(),
  })
  const updated = await updatePost(created.id, {
    category: '잡담',
    is_pinned: false,
    pinned_at: null,
  })
  assert.ok(updated)
  assert.equal(updated.is_pinned, false)
  assert.equal(updated.pinned_at, null)
})

test('updatePost: 존재하지 않는 id는 null을 돌려준다', async () => {
  const { updatePost } = await loadFreshPostsModule()
  const result = await updatePost('00000000-0000-4000-8000-000000000000', { title: '없음' })
  assert.equal(result, null)
})

// ------------------------------------------------------------ softDeletePost

test('softDeletePost: is_deleted를 true로 바꾸고, 다른 컬럼은 건드리지 않는다(하드 삭제가 아니다)', async () => {
  const { createPost, softDeletePost, getPostById } = await loadFreshPostsModule()
  const created = await createPost({
    title: '지워질 글',
    content: '내용',
    content_format: 'plain',
    category: '잡담',
    author_id: seededAuthorId,
  })
  await softDeletePost(created.id)

  const hidden = await getPostById(created.id)
  assert.equal(hidden, null, '기본 조회에서는 삭제된 글이 안 보여야 한다')

  const shown = await getPostById(created.id, { includeDeleted: true })
  assert.ok(shown, '행 자체는 여전히 존재해야 한다 — 하드 삭제가 아니다')
  assert.equal(shown.is_deleted, true)
  assert.equal(shown.title, '지워질 글', '소프트 삭제는 다른 컬럼을 건드리면 안 된다')
})

// -------------------------------------------------------- incrementViewCount

test('incrementViewCount: view_count를 1 증가시키고 갱신된 값을 돌려준다', async () => {
  const { createPost, incrementViewCount, getPostById } = await loadFreshPostsModule()
  const created = await createPost({
    title: '조회수 테스트',
    content: '내용',
    content_format: 'plain',
    category: '잡담',
    author_id: seededAuthorId,
  })
  assert.equal(created.view_count, 0)

  const first = await incrementViewCount(created.id)
  assert.equal(first, 1)
  const second = await incrementViewCount(created.id)
  assert.equal(second, 2)

  const post = await getPostById(created.id)
  assert.equal(post.view_count, 2)
})

test('incrementViewCount: 동시 호출 10건이 전부 반영된다(원자적 UPDATE — 읽고-쓰기 왕복이면 유실된다)', async () => {
  const { createPost, incrementViewCount, getPostById } = await loadFreshPostsModule()
  const created = await createPost({
    title: '동시성 테스트',
    content: '내용',
    content_format: 'plain',
    category: '잡담',
    author_id: seededAuthorId,
  })

  await Promise.all(Array.from({ length: 10 }, () => incrementViewCount(created.id)))

  const post = await getPostById(created.id)
  assert.equal(post.view_count, 10, '동시 호출 10건이 모두 반영돼야 한다(유실 없음)')
})

test('incrementViewCount: 존재하지 않는 id는 null을 돌려준다', async () => {
  const { incrementViewCount } = await loadFreshPostsModule()
  const result = await incrementViewCount('00000000-0000-4000-8000-000000000000')
  assert.equal(result, null)
})

test('incrementViewCount 구현은 단일 UPDATE 문이다 — 별도 SELECT 왕복이 없다 (소스 가드 — 읽고-쓰기 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/posts.ts', 'utf8')
  const match = src.match(/export async function incrementViewCount\([\s\S]*?\n\}\n/)
  assert.ok(match, 'incrementViewCount 함수 본문을 찾지 못했다')
  const body = match[0]

  const selectCalls = body.match(/db\s*\.select\(/g) ?? []
  assert.equal(
    selectCalls.length,
    0,
    'incrementViewCount는 db.select를 쓰면 안 된다 — 읽고-쓰기 왕복은 동시 조회에서 카운트가 유실된다'
  )
  const updateCalls = body.match(/db\s*\.update\(/g) ?? []
  assert.equal(updateCalls.length, 1, 'incrementViewCount는 db.update를 정확히 한 번만 써야 한다')
  assert.match(
    body,
    /viewCount:\s*sql`\$\{posts\.viewCount\}\s*\+\s*1`/,
    'view_count 증가는 SQL 표현식(view_count + 1)으로 DB에서 계산해야 한다 — JS에서 읽은 값에 1을 더해 쓰면 안 된다'
  )
})
