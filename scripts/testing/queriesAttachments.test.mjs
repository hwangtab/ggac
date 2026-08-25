import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/attachments.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesPosts.test.mjs`(Task 4)와 동일. `post_attachments`는
 * `posts(id)`를 참조하는 FK라 먼저 저자 프로필 + 게시글을 심는다(둘 다 Task 5가
 * 만든 `createPost`로).
 */

const DB_PATH = 'scripts/testing/.queries-attachments-test.db'
const ATTACHMENTS_MODULE_URL = new URL('../../src/db/queries/attachments.ts', import.meta.url)
const POSTS_MODULE_URL = new URL('../../src/db/queries/posts.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshAttachmentsModule() {
  return import(`${ATTACHMENTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

test('부정 대조 기반: addAttachment이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { addAttachment } = await loadFreshAttachmentsModule()
    await assert.rejects(() =>
      addAttachment({
        post_id: 'any-id',
        file_name: 'a.png',
        file_url: 'https://example.public.blob.vercel-storage.com/a.png',
        file_type: 'image',
        file_size: 100,
        mime_type: 'image/png',
      })
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
let seededAuthorId

async function seedAuthor() {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = `attach-author-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: '첨부테스트작성자',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function seedPost(overrides = {}) {
  const { createPost } = await loadFreshPostsModule()
  const post = await createPost({
    title: overrides.title ?? `첨부테스트글-${++seedCounter}`,
    content: '내용',
    content_format: 'plain',
    category: '잡담',
    author_id: overrides.authorId ?? seededAuthorId,
  })
  return post.id
}

function fileInput(overrides = {}) {
  return {
    post_id: overrides.post_id,
    file_name: overrides.file_name ?? 'photo.png',
    file_url:
      overrides.file_url ?? 'https://example.public.blob.vercel-storage.com/attachments/photo.png',
    file_type: overrides.file_type ?? 'image',
    file_size: overrides.file_size ?? 12345,
    mime_type: overrides.mime_type ?? 'image/png',
    ...overrides,
  }
}

test('사전 준비: 공통 저자를 심는다', async () => {
  seededAuthorId = await seedAuthor()
  assert.ok(seededAuthorId)
})

// ---------------------------------------------------------------- addAttachment / sort_order

test('addAttachment: sort_order를 생략(0)하면 같은 post_id 안의 MAX(sort_order)+1을 자동 부여한다', async () => {
  const { addAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()

  const a = await addAttachment(fileInput({ post_id: postId, file_name: 'a.png', sort_order: 0 }))
  const b = await addAttachment(fileInput({ post_id: postId, file_name: 'b.png', sort_order: 0 }))
  assert.equal(a.sort_order, 1)
  assert.equal(b.sort_order, 2)
  assert.equal(a.post_id, postId)
  assert.equal(a.file_name, 'a.png')

  // snake_case 키만 있어야 한다.
  for (const key of Object.keys(a)) {
    assert.doesNotMatch(key, /[A-Z]/, `${key}는 camelCase 흔적이다`)
  }
})

test('addAttachment: sort_order를 아예 생략해도(undefined) 자동 부여된다', async () => {
  const { addAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const a = await addAttachment(fileInput({ post_id: postId, file_name: 'a.png' }))
  const b = await addAttachment(fileInput({ post_id: postId, file_name: 'b.png' }))
  assert.equal(a.sort_order, 1)
  assert.equal(b.sort_order, 2)
})

test('addAttachment: 명시된 sort_order는 존중한다', async () => {
  const { addAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(fileInput({ post_id: postId, file_name: 'a.png', sort_order: 0 }))
  const c = await addAttachment(fileInput({ post_id: postId, file_name: 'c.png', sort_order: 99 }))
  assert.equal(c.sort_order, 99, '명시된 sort_order는 자동 부여를 타지 않아야 한다')
})

test('addAttachment: sort_order는 게시글별로 독립적이다(다른 post_id는 서로의 MAX에 영향받지 않는다)', async () => {
  const { addAttachment } = await loadFreshAttachmentsModule()
  const postA = await seedPost()
  const postB = await seedPost()
  await addAttachment(fileInput({ post_id: postA, file_name: 'a1.png', sort_order: 0 }))
  await addAttachment(fileInput({ post_id: postA, file_name: 'a2.png', sort_order: 0 }))
  const firstOfB = await addAttachment(
    fileInput({ post_id: postB, file_name: 'b1.png', sort_order: 0 })
  )
  assert.equal(firstOfB.sort_order, 1, 'postB는 postA와 별개로 1부터 시작해야 한다')
})

// 참고: "진짜 동시(Promise.all) 업로드가 서로 다른 sort_order를 받는가"를 이
// 스위트에서 직접 재현하지 않는다 — 로컬 파일 DB 테스트가 쓰는 @libsql/client
// sqlite3 로컬 모드는 단일 네이티브 연결을 캐시해 재사용하는데(src/db/client.ts의
// cachedRawClient), 그 위에서 db.transaction()을 진짜 동시(Promise.all)로 여러 번
// 열면 두 번째 BEGIN이 SQLITE_BUSY로 즉시 거부되고, 그 실패한 트랜잭션이 연결을
// 잠긴 상태로 남겨 이후 같은 프로세스의 모든 쿼리가 연쇄로 깨진다(직접 재현해
// 확인함 — 이 테스트를 넣었더니 파일의 나머지 테스트 전부가 SQLITE_BUSY로
// 실패했다). 이건 테스트 하네스의 단일 연결 한계이지 실제 운영(Turso 원격,
// 요청마다 별도 세션)의 한계가 아니다 — 그래서 "하나의 트랜잭션 안에서
// MAX+INSERT를 실행하는가"는 아래 소스 가드로, "MAX+1 계산 자체가 맞는가"는 위
// 순차 테스트들로 검증하고, 진짜 동시성 재현은 하지 않는다.
test('addAttachment 구현은 MAX 조회와 INSERT를 하나의 트랜잭션(db.transaction) 안에서 실행한다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/attachments.ts', 'utf8')
  const match = src.match(/export async function addAttachment\([\s\S]*?\n\}\n/)
  assert.ok(match, 'addAttachment 함수 본문을 찾지 못했다')
  const body = match[0]
  assert.match(body, /db\.transaction\(/, 'addAttachment은 db.transaction을 써야 한다')
  assert.match(
    body,
    /max\(\$\{postAttachments\.sortOrder\}\)/,
    'MAX(sort_order) 조회가 있어야 한다'
  )
  assert.match(
    body,
    /tx\s*\.insert\(postAttachments\)/,
    'INSERT는 트랜잭션 핸들(tx)로 실행해야 한다'
  )
})

// ---------------------------------------------------------------- listAttachments

test('listAttachments: sort_order 오름차순으로 정렬한다', async () => {
  const { addAttachment, listAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const c = await addAttachment(fileInput({ post_id: postId, file_name: 'c.png', sort_order: 3 }))
  const a = await addAttachment(fileInput({ post_id: postId, file_name: 'a.png', sort_order: 1 }))
  const b = await addAttachment(fileInput({ post_id: postId, file_name: 'b.png', sort_order: 2 }))

  const rows = await listAttachments(postId)
  assert.deepEqual(
    rows.map(r => r.id),
    [a.id, b.id, c.id]
  )
})

test('listAttachments: 다른 게시글의 첨부는 섞이지 않는다', async () => {
  const { addAttachment, listAttachments } = await loadFreshAttachmentsModule()
  const postA = await seedPost()
  const postB = await seedPost()
  await addAttachment(fileInput({ post_id: postA, file_name: 'onlyA.png' }))
  const rows = await listAttachments(postB)
  assert.equal(rows.length, 0)
})

// ---------------------------------------------------------------- getAttachmentById / getAttachmentWithPost

test('getAttachmentById: id + post_id로 스코프된 단건 조회, 없으면 null', async () => {
  const { addAttachment, getAttachmentById } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const created = await addAttachment(fileInput({ post_id: postId }))

  const found = await getAttachmentById(created.id, postId)
  assert.ok(found)
  assert.equal(found.id, created.id)

  const wrongPost = await getAttachmentById(created.id, await seedPost())
  assert.equal(wrongPost, null, '다른 게시글 id로 조회하면 null이어야 한다(스코프 강제)')

  const notFound = await getAttachmentById('00000000-0000-4000-8000-000000000000', postId)
  assert.equal(notFound, null)
})

test('getAttachmentWithPost: 소속 게시글의 author_id/category를 posts 임베드로 담아 돌려준다', async () => {
  const { addAttachment, getAttachmentWithPost } = await loadFreshAttachmentsModule()
  const postId = await seedPost({ title: '권한판정용글' })
  const created = await addAttachment(fileInput({ post_id: postId }))

  const found = await getAttachmentWithPost(created.id, postId)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.ok(found.posts)
  assert.equal(found.posts.author_id, seededAuthorId)
  assert.equal(found.posts.category, '잡담')
})

// ---------------------------------------------------------------- getAttachmentUploadStats

test('getAttachmentUploadStats: 개수와 총 용량을 집계한다', async () => {
  const { addAttachment, getAttachmentUploadStats } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(fileInput({ post_id: postId, file_size: 100 }))
  await addAttachment(fileInput({ post_id: postId, file_size: 250 }))

  const stats = await getAttachmentUploadStats(postId)
  assert.equal(stats.count, 2)
  assert.equal(stats.total_size, 350)
})

test('getAttachmentUploadStats: 첨부가 없으면 0/0', async () => {
  const { getAttachmentUploadStats } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const stats = await getAttachmentUploadStats(postId)
  assert.equal(stats.count, 0)
  assert.equal(stats.total_size, 0)
})

// ---------------------------------------------------------------- unsetPrimaryForPost

test('unsetPrimaryForPost: 같은 게시글의 대표 이미지를 전부 해제한다', async () => {
  const { addAttachment, unsetPrimaryForPost, listAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({ post_id: postId, file_name: 'old-primary.png', is_primary: true })
  )
  await unsetPrimaryForPost(postId)
  const rows = await listAttachments(postId)
  assert.ok(rows.every(r => r.is_primary === false))
})

test('unsetPrimaryForPost: excludeAttachmentId로 지정한 첨부는 건드리지 않는다', async () => {
  const { addAttachment, unsetPrimaryForPost, getAttachmentById } =
    await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const keep = await addAttachment(
    fileInput({ post_id: postId, file_name: 'keep.png', is_primary: true })
  )
  const other = await addAttachment(
    fileInput({ post_id: postId, file_name: 'other.png', is_primary: true })
  )
  await unsetPrimaryForPost(postId, keep.id)

  const keptAfter = await getAttachmentById(keep.id, postId)
  const otherAfter = await getAttachmentById(other.id, postId)
  assert.equal(keptAfter.is_primary, true, 'exclude로 지정한 첨부는 그대로 유지돼야 한다')
  assert.equal(otherAfter.is_primary, false)
})

// ---------------------------------------------------------------- updateAttachment

test('updateAttachment: alt_text/is_primary/sort_order를 부분 갱신한다', async () => {
  const { addAttachment, updateAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const created = await addAttachment(fileInput({ post_id: postId }))

  const updated = await updateAttachment(created.id, postId, {
    alt_text: '대체 텍스트',
    is_primary: true,
    sort_order: 5,
  })
  assert.ok(updated)
  assert.equal(updated.alt_text, '대체 텍스트')
  assert.equal(updated.is_primary, true)
  assert.equal(updated.sort_order, 5)
})

test('updateAttachment: 다른 게시글 id로는 갱신되지 않는다(null)', async () => {
  const { addAttachment, updateAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const otherPostId = await seedPost()
  const created = await addAttachment(fileInput({ post_id: postId }))

  const result = await updateAttachment(created.id, otherPostId, { alt_text: '해킹 시도' })
  assert.equal(result, null)
})

// ---------------------------------------------------------------- removeAttachment

test('removeAttachment: id + post_id로 삭제한다(하드 삭제)', async () => {
  const { addAttachment, removeAttachment, getAttachmentById } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const created = await addAttachment(fileInput({ post_id: postId }))

  await removeAttachment(created.id, postId)
  const found = await getAttachmentById(created.id, postId)
  assert.equal(found, null)
})

test('removeAttachment: post_id가 다르면 삭제되지 않는다(스코프 강제)', async () => {
  const { addAttachment, removeAttachment, getAttachmentById } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const otherPostId = await seedPost()
  const created = await addAttachment(fileInput({ post_id: postId }))

  await removeAttachment(created.id, otherPostId)
  const stillThere = await getAttachmentById(created.id, postId)
  assert.ok(stillThere, '다른 post_id로 삭제를 시도하면 아무 일도 일어나지 않아야 한다')
})

// ---------------------------------------------------------- deleteExpiredTempAttachments

test('deleteExpiredTempAttachments: 만료된 임시 첨부만 지운다 — 살아있는 첨부는 건드리지 않는다', async () => {
  const { addAttachment, deleteExpiredTempAttachments, getAttachmentById, listAttachments } =
    await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const now = new Date('2026-06-15T00:00:00.000Z')

  const expiredTemp = await addAttachment(
    fileInput({
      post_id: postId,
      file_name: 'expired-temp.png',
      is_temporary: true,
      expires_at: new Date(now.getTime() - 1000).toISOString(),
    })
  )
  const activeTemp = await addAttachment(
    fileInput({
      post_id: postId,
      file_name: 'active-temp.png',
      is_temporary: true,
      expires_at: new Date(now.getTime() + 1000 * 60 * 60).toISOString(),
    })
  )
  const permanentNoExpiry = await addAttachment(
    fileInput({ post_id: postId, file_name: 'permanent.png', is_temporary: false })
  )
  // is_temporary=false인데 expires_at이 과거인 이상 데이터(정상 경로에선 안 나오지만
  // 방어적으로) — is_temporary 조건이 없으면 이것도 지워질 것이므로 대조가 된다.
  const nonTempWithPastExpiry = await addAttachment(
    fileInput({
      post_id: postId,
      file_name: 'non-temp-past-expiry.png',
      is_temporary: false,
      expires_at: new Date(now.getTime() - 1000).toISOString(),
    })
  )

  const deleted = await deleteExpiredTempAttachments(now)
  assert.deepEqual(
    deleted.map(r => r.id).sort(),
    [expiredTemp.id].sort(),
    '만료된 임시 첨부만 삭제 결과에 포함돼야 한다'
  )

  assert.equal(await getAttachmentById(expiredTemp.id, postId), null)
  assert.ok(
    await getAttachmentById(activeTemp.id, postId),
    '아직 만료되지 않은 임시 첨부는 살아있어야 한다'
  )
  assert.ok(await getAttachmentById(permanentNoExpiry.id, postId), '영구 첨부는 건드리면 안 된다')
  assert.ok(
    await getAttachmentById(nonTempWithPastExpiry.id, postId),
    'is_temporary=false면 expires_at이 지났어도 지우면 안 된다'
  )

  const remaining = await listAttachments(postId)
  assert.equal(remaining.length, 3)
})

test('deleteExpiredTempAttachments: 만료된 것이 없으면 빈 배열을 돌려주고 아무것도 지우지 않는다', async () => {
  const { addAttachment, deleteExpiredTempAttachments, listAttachments } =
    await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({
      post_id: postId,
      is_temporary: true,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    })
  )
  // `now`를 앞선 테스트들의 고정 타임스탬프(2026-06-15)보다도 훨씬 이전인
  // 값으로 줘서, DB 전체를 대상으로 하는 이 함수가 다른 테스트가 심어 둔
  // 행(예: 'active-temp.png', 실제 오늘 날짜 기준으로는 이미 지난 고정
  // 타임스탬프)까지 우연히 "만료됨"으로 잡는 것을 피한다 — 이 테스트는
  // "만료된 게 하나도 없을 때의 동작"만 격리해서 검증한다.
  const deleted = await deleteExpiredTempAttachments(new Date('2000-01-01T00:00:00.000Z'))
  assert.deepEqual(deleted, [])
  const remaining = await listAttachments(postId)
  assert.equal(remaining.length, 1)
})

test('deleteExpiredTempAttachments 구현은 is_temporary와 expires_at 조건을 함께 검사한다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/attachments.ts', 'utf8')
  const match = src.match(/export async function deleteExpiredTempAttachments\([\s\S]*?\n\}\n/)
  assert.ok(match, 'deleteExpiredTempAttachments 함수 본문을 찾지 못했다')
  const body = match[0]
  assert.match(
    body,
    /eq\(postAttachments\.isTemporary,\s*true\)/,
    'is_temporary=true 조건이 있어야 한다'
  )
  assert.match(
    body,
    /lt\(postAttachments\.expiresAt,\s*now\)/,
    'expires_at < now 조건이 있어야 한다'
  )
})

// ---------------------------------------------------------------- listTemporaryAttachments

test('listTemporaryAttachments: is_temporary=true인 행만 돌려준다(만료 여부 무관)', async () => {
  const { addAttachment, listTemporaryAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const temp = await addAttachment(
    fileInput({
      post_id: postId,
      is_temporary: true,
      expires_at: new Date(Date.now() + 1000).toISOString(),
    })
  )
  await addAttachment(fileInput({ post_id: postId, is_temporary: false }))

  const rows = await listTemporaryAttachments()
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(temp.id))
  assert.ok(rows.every(r => r.is_temporary === true))
})

// ---------------------------------------------------------------- listAttachments(orderBy)

test('listAttachments: orderBy 생략 시 sort_order 오름차순(기존 동작 그대로)', async () => {
  const { addAttachment, listAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  const c = await addAttachment(fileInput({ post_id: postId, file_name: 'c.png', sort_order: 3 }))
  const a = await addAttachment(fileInput({ post_id: postId, file_name: 'a.png', sort_order: 1 }))
  const b = await addAttachment(fileInput({ post_id: postId, file_name: 'b.png', sort_order: 2 }))

  const rows = await listAttachments(postId)
  assert.deepEqual(
    rows.map(r => r.id),
    [a.id, b.id, c.id]
  )
})

test("listAttachments: orderBy:'created_at'을 넘기면 sort_order와 무관하게 업로드 순서로 정렬한다", async () => {
  const { addAttachment, listAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  // sort_order는 일부러 created_at 순서와 반대로 준다 — 정렬 기준이 실제로
  // 바뀌었는지(sort_order를 무시하고 created_at을 쓰는지) 구분하기 위해서다.
  const first = await addAttachment(
    fileInput({ post_id: postId, file_name: 'first.png', sort_order: 99 })
  )
  const second = await addAttachment(
    fileInput({ post_id: postId, file_name: 'second.png', sort_order: 1 })
  )

  const bySortOrder = await listAttachments(postId)
  assert.deepEqual(
    bySortOrder.map(r => r.id),
    [second.id, first.id],
    'orderBy 생략 시 sort_order(1 < 99) 기준이어야 한다'
  )

  const byCreatedAt = await listAttachments(postId, { orderBy: 'created_at' })
  assert.deepEqual(
    byCreatedAt.map(r => r.id),
    [first.id, second.id],
    "orderBy:'created_at'이면 업로드 순서(first가 먼저)여야 한다"
  )
})

// ---------------------------------------------------------------- listAttachmentsByPostIds

test('listAttachmentsByPostIds: 여러 게시글의 첨부를 한 쿼리로 배치 조회한다(N+1 아님)', async () => {
  const { addAttachment, listAttachmentsByPostIds } = await loadFreshAttachmentsModule()
  const postA = await seedPost()
  const postB = await seedPost()
  const postC = await seedPost()
  await addAttachment(fileInput({ post_id: postA, file_name: 'a1.png' }))
  await addAttachment(fileInput({ post_id: postA, file_name: 'a2.png' }))
  await addAttachment(fileInput({ post_id: postB, file_name: 'b1.png' }))
  // postC는 첨부 없음 — 결과에 postC 관련 행이 없어야 한다.

  const rows = await listAttachmentsByPostIds([postA, postB, postC])
  const byPost = new Map()
  for (const r of rows) {
    byPost.set(r.post_id, (byPost.get(r.post_id) || 0) + 1)
  }
  assert.equal(byPost.get(postA), 2)
  assert.equal(byPost.get(postB), 1)
  assert.equal(byPost.has(postC), false)
})

test('listAttachmentsByPostIds: postIds가 비어있으면 쿼리 없이 즉시 빈 배열을 돌려준다', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { listAttachmentsByPostIds } = await loadFreshAttachmentsModule()
    const result = await listAttachmentsByPostIds([])
    assert.deepEqual(result, [])
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- listImageAttachments

test('listImageAttachments: is_primary 우선, 그다음 created_at 오름차순으로 이미지만 돌려준다', async () => {
  const { addAttachment, listImageAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({
      post_id: postId,
      file_name: 'doc.pdf',
      file_type: 'document',
      mime_type: 'application/pdf',
    })
  )
  const olderImage = await addAttachment(
    fileInput({ post_id: postId, file_name: 'older.png', file_type: 'image' })
  )
  const primaryImage = await addAttachment(
    fileInput({ post_id: postId, file_name: 'primary.png', file_type: 'image', is_primary: true })
  )

  const rows = await listImageAttachments(postId)
  assert.deepEqual(
    rows.map(r => r.id),
    [primaryImage.id, olderImage.id],
    '대표 이미지가 먼저, 그다음 업로드 순서여야 하고 문서는 빠져야 한다'
  )
  assert.ok(rows.every(r => r.file_type === 'image'))
})

test('listImageAttachments: 이미지 첨부가 없으면 빈 배열을 돌려준다', async () => {
  const { addAttachment, listImageAttachments } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({ post_id: postId, file_type: 'document', mime_type: 'application/pdf' })
  )
  const rows = await listImageAttachments(postId)
  assert.deepEqual(rows, [])
})

// ---------------------------------------------------------------- getPrimaryImageAttachment (단계 4 Task 6b)

test('getPrimaryImageAttachment: listImageAttachments의 첫 원소와 같은 행을 돌려준다', async () => {
  const { addAttachment, listImageAttachments, getPrimaryImageAttachment } =
    await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({
      post_id: postId,
      file_name: 'doc.pdf',
      file_type: 'document',
      mime_type: 'application/pdf',
    })
  )
  await addAttachment(fileInput({ post_id: postId, file_name: 'older.png', file_type: 'image' }))
  const primaryImage = await addAttachment(
    fileInput({ post_id: postId, file_name: 'primary.png', file_type: 'image', is_primary: true })
  )

  const all = await listImageAttachments(postId)
  const one = await getPrimaryImageAttachment(postId)
  assert.ok(all.length > 1, '두 판이 갈리는지 보려면 이미지가 둘 이상이어야 한다')
  assert.equal(one.id, primaryImage.id)
  assert.deepEqual(one, all[0], '정렬 규칙이 두 함수에서 갈리면 대표 이미지가 달라진다')
})

test('getPrimaryImageAttachment 구현은 LIMIT 1을 건다 (소스 가드 — 전체 조회 회귀 방지)', () => {
  const src = readFileSync('src/db/queries/attachments.ts', 'utf8')
  const match = src.match(/export async function getPrimaryImageAttachment\([\s\S]*?\n\}\n/)
  assert.ok(match, 'getPrimaryImageAttachment 함수 본문을 찾지 못했다')
  // 첫 한 건만 쓰는 호출부(OG 라우트)를 위해 존재하는 함수다. limit이 빠지면
  // listImageAttachments와 같은 전체 조회가 되어 존재 이유가 사라진다 —
  // 반환값만 보는 위 테스트로는 그 회귀가 잡히지 않는다.
  assert.match(match[0], /\.limit\(1\)/)
})

test('getPrimaryImageAttachment: 이미지 첨부가 없으면 null을 돌려준다', async () => {
  const { addAttachment, getPrimaryImageAttachment } = await loadFreshAttachmentsModule()
  const postId = await seedPost()
  await addAttachment(
    fileInput({ post_id: postId, file_type: 'document', mime_type: 'application/pdf' })
  )
  assert.equal(await getPrimaryImageAttachment(postId), null)
})
