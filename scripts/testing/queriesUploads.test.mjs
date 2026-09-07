import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 에디터 업로드 원장. 실제 SQLite로 검증한다.
 *
 * 이 표가 존재하는 이유는 하나다 — "올라왔지만 아무 데서도 참조하지 않는
 * 파일"을 물어볼 대상이 필요해서다. 그래서 이 파일의 대부분은 **정리 후보
 * 판정**에 관한 것이다:
 *
 * - 게시글 본문이 URL을 품고 있으면 후보가 아니다.
 * - 첨부 원장이 가리키고 있으면 후보가 아니다.
 * - 삭제된 게시글의 본문은 참조로 치지 않는다.
 * - 아직 7일이 안 된 업로드는 후보가 아니다(에디터에 붙이는 중일 수 있다).
 */

const DB_PATH = 'scripts/testing/.queries-uploads-test.db'
const MODULE_URL = new URL('../../src/db/queries/uploads.ts', import.meta.url)

async function loadFresh() {
  return import(`${MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

const DAY = 24 * 60 * 60 * 1000

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)

  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO member_profiles (id, display_name, email, created_at, updated_at)
          VALUES ('member-1', '홍길동', 'hong@test.local', ?, ?)`,
    args: [now, now],
  })
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seq = 0

/** 후보 판정만 보는 테스트들이 서로의 행에 걸리지 않도록 URL을 매번 새로 만든다. */
function uploadInput(overrides = {}) {
  const n = ++seq
  return {
    user_id: 'member-1',
    bucket: 'attachments',
    path: `editor/member-1/file-${n}.webp`,
    url: `https://blob.example.com/attachments/editor/member-1/file-${n}.webp`,
    mime_type: 'image/webp',
    size_bytes: 1234,
    ...overrides,
  }
}

/** 원장 행의 created_at을 과거로 밀어 "오래된 업로드"를 만든다. */
async function ageUpload(url, ms) {
  await setupClient.execute({
    sql: 'UPDATE media_uploads SET created_at = ? WHERE url = ?',
    args: [Date.now() - ms, url],
  })
}

async function insertPost(content, { isDeleted = false } = {}) {
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO posts (id, title, content, category, author_id, is_deleted, created_at, updated_at)
          VALUES (?, '글', ?, '잡담', 'member-1', ?, ?, ?)`,
    args: [`post-${++seq}`, content, isDeleted ? 1 : 0, now, now],
  })
}

test('기록한 업로드를 URL로 되찾는다', async () => {
  const { recordUpload, getUploadByUrl, listUploadsByUser } = await loadFresh()
  const input = uploadInput()

  const created = await recordUpload(input)
  assert.equal(created.url, input.url)
  assert.equal(created.user_id, 'member-1')
  assert.equal(created.size_bytes, 1234)
  // 응답 키는 다른 쿼리 계층과 같이 snake_case이고 시각은 ISO 문자열이다.
  assert.equal(typeof created.created_at, 'string')

  const found = await getUploadByUrl(input.url)
  assert.equal(found.id, created.id)

  const mine = await listUploadsByUser('member-1')
  assert.ok(mine.some(row => row.url === input.url))
})

test('같은 URL을 다시 기록해도 행이 늘지 않는다', async () => {
  const { recordUpload } = await loadFresh()
  const input = uploadInput()

  await recordUpload(input)
  const again = await recordUpload(input)
  assert.equal(again, null, '중복 기록은 조용히 무시된다')

  const count = await setupClient.execute({
    sql: 'SELECT count(*) AS n FROM media_uploads WHERE url = ?',
    args: [input.url],
  })
  assert.equal(Number(count.rows[0].n), 1)
})

test('7일이 지나고 아무도 참조하지 않으면 정리 후보다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  const input = uploadInput()

  await recordUpload(input)
  await ageUpload(input.url, 8 * DAY)

  const candidates = await listCleanupCandidates()
  assert.ok(candidates.some(row => row.url === input.url))
})

test('최근 업로드는 참조가 없어도 후보가 아니다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  const input = uploadInput()

  // 방금 올린 파일은 에디터에 붙이는 중일 수 있다. 지우면 작성 중인 글에서
  // 이미지가 깨진다.
  await recordUpload(input)
  await ageUpload(input.url, 1 * DAY)

  const candidates = await listCleanupCandidates()
  assert.ok(!candidates.some(row => row.url === input.url))
})

test('게시글 본문이 URL을 품고 있으면 후보가 아니다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  const input = uploadInput()

  await recordUpload(input)
  await ageUpload(input.url, 30 * DAY)
  await insertPost(`<p>사진</p><img src="${input.url}" />`)

  const candidates = await listCleanupCandidates()
  assert.ok(!candidates.some(row => row.url === input.url))
})

test('삭제된 게시글의 본문은 참조로 치지 않는다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  const input = uploadInput()

  await recordUpload(input)
  await ageUpload(input.url, 30 * DAY)
  await insertPost(`<img src="${input.url}" />`, { isDeleted: true })

  const candidates = await listCleanupCandidates()
  assert.ok(candidates.some(row => row.url === input.url))
})

test('첨부 원장이 가리키는 파일은 후보가 아니다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  const input = uploadInput()

  await recordUpload(input)
  await ageUpload(input.url, 30 * DAY)

  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO posts (id, title, content, category, author_id, created_at, updated_at)
          VALUES ('post-att', '첨부 글', '본문', '잡담', 'member-1', ?, ?)`,
    args: [now, now],
  })
  await setupClient.execute({
    sql: `INSERT INTO post_attachments
            (id, post_id, file_name, file_url, file_type, file_size, mime_type, created_at, updated_at)
          VALUES ('att-1', 'post-att', 'file.webp', ?, 'image', 10, 'image/webp', ?, ?)`,
    args: [input.url, now, now],
  })

  const candidates = await listCleanupCandidates()
  assert.ok(!candidates.some(row => row.url === input.url))
})

test('URL에 LIKE 와일드카드가 들어 있어도 참조 판정이 정확하다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()
  // `%`·`_`가 든 파일명은 실제로 생긴다(인코딩된 한글 파일명 등). LIKE로
  // 판정했다면 이 URL이 엉뚱한 본문에 "포함된" 것으로 읽혀 삭제를 면했을 것이다.
  const input = uploadInput({
    url: 'https://blob.example.com/attachments/editor/member-1/100%_a_b.webp',
  })

  await recordUpload(input)
  await ageUpload(input.url, 30 * DAY)
  await insertPost('https://blob.example.com/attachments/editor/member-1/100XYaXb.webp')

  const candidates = await listCleanupCandidates()
  assert.ok(candidates.some(row => row.url === input.url))
})

test('정리한 행은 원장에서 사라진다', async () => {
  const { recordUpload, deleteUpload, getUploadByUrl } = await loadFresh()
  const input = uploadInput()

  const created = await recordUpload(input)
  assert.equal(await deleteUpload(created.id), true)
  assert.equal(await getUploadByUrl(input.url), null)
  assert.equal(await deleteUpload(created.id), false, '없는 행 삭제는 false')
})

test('후보는 한 번에 limit 건까지만 준다', async () => {
  const { recordUpload, listCleanupCandidates } = await loadFresh()

  for (let i = 0; i < 3; i++) {
    const input = uploadInput()
    await recordUpload(input)
    await ageUpload(input.url, 30 * DAY)
  }

  const candidates = await listCleanupCandidates({ limit: 2 })
  assert.equal(candidates.length, 2)
})
