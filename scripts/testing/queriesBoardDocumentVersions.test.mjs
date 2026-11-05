import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 서류 버전 기록(마이그레이션 0038 `board_document_versions`)을 실제 SQLite 파일 DB로 본다 —
 * docs/board-work/05-이사회-서류-앱-편집.md §2.
 *
 * - backfill 없음: 고치지 않은 서류에는 행이 없고, 처음 저장할 때 지금 file_* 칸이 v1 행(올린 사람·올린 때·본문)이 된다.
 * - 새 버전은 서류의 file_*·body_markdown 을 바꾸고, 파일 본문 추출 결과를 지운다(검색이 옛 글자를 내주지 않게).
 * - 기준 버전이 최신이 아니면 conflict — 남의 저장을 덮지 않는다. 되돌리기는 새 버전이고, 최신으로는 되돌리지 못한다.
 * - 다른 서류의 버전 id 로는 읽지도 되돌리지도 못한다. 서류를 지우면 버전 행이 CASCADE 로 지워진다.
 */

const DB_PATH = 'scripts/testing/.queries-board-document-versions-test.db'
const src = rel => new URL(`../../src/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let Q

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = {
    profiles: await import(src('db/queries/profiles.ts')),
    board: await import(src('db/queries/board.ts')),
    versions: await import(src('db/queries/boardDocumentVersions.ts')),
    docTexts: await import(src('db/queries/work/boardDocumentTexts.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedDirector() {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bdv-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    is_director: true,
  })
  return id
}

async function seedDocument(uploader, { body = null, fileName = '회의록.docx' } = {}) {
  const { id } = await Q.board.createDocument({
    title: '제9차 이사회 회의록',
    category: '회의록',
    filePath: `${uploader}/1750000000000_${fileName}`,
    fileName,
    fileSize: 1234,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    uploadedBy: uploader,
    visibility: 'board',
    bodyMarkdown: body,
  })
  return id
}

function newVersion(documentId, editor, overrides = {}) {
  const id = crypto.randomUUID()
  return {
    id,
    filePath: `versions/${documentId}/${id}/minutes.docx`,
    fileName: '회의록.docx',
    fileSize: 2048,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    source: 'office-editor',
    createdBy: editor,
    ...overrides,
  }
}

test('고치지 않은 서류에는 버전 행이 없다(backfill 없음) — 최신 번호는 null', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  assert.deepEqual(await Q.versions.listBoardDocumentVersions(doc), [])
  assert.equal(await Q.versions.latestRecordedVersionNo(doc), null)
  const row = await Q.versions.getBoardDocumentForEdit(doc)
  assert.equal(row.uploadedBy, me)
  assert.equal(row.fileName, '회의록.docx')
})

test('처음 저장: 지금 파일이 v1 행이 되고 새 파일이 v2 — 서류 칸은 v2 를 가리킨다', async () => {
  const uploader = await seedDirector()
  const admin = await seedDirector()
  const doc = await seedDocument(uploader, { body: '# 옛 본문' })
  const before = await Q.versions.getBoardDocumentForEdit(doc)
  const v2 = newVersion(doc, admin)
  const added = await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: v2,
    body: { mode: 'set', value: '# 새 본문' },
  })
  assert.equal(added.versionNo, 2)
  assert.ok(added.initialVersionId)

  const list = await Q.versions.listBoardDocumentVersions(doc)
  assert.deepEqual(
    list.map(v => [v.versionNo, v.source]),
    [
      [2, 'office-editor'],
      [1, 'upload'],
    ]
  )
  const [latest, first] = list
  // v1 은 옛 칸 그대로 — 올린 사람·올린 때·그때의 본문
  assert.equal(first.filePath, before.filePath)
  assert.equal(first.fileName, '회의록.docx')
  assert.equal(first.fileSize, 1234)
  assert.equal(first.createdBy, uploader)
  assert.equal(first.createdByName, '이사' + (counter - 1))
  assert.equal(first.createdAt.getTime(), before.createdAt.getTime())
  assert.equal(first.bodyMarkdown, '# 옛 본문')
  // v2 는 저장한 사람·새 본문
  assert.equal(latest.createdBy, admin)
  assert.equal(latest.bodyMarkdown, '# 새 본문')

  const after = await Q.versions.getBoardDocumentForEdit(doc)
  assert.equal(after.filePath, v2.filePath)
  assert.equal(after.fileSize, 2048)
  assert.equal(after.bodyMarkdown, '# 새 본문')
  // 제목·올린 사람·등급은 바뀌지 않는다(지우기·편집 권한의 근거가 그대로다)
  assert.equal(after.title, before.title)
  assert.equal(after.uploadedBy, uploader)
  assert.equal(after.visibility, 'board')
})

test('본문 keep: 서류 본문을 바꾸지 않고, 새 버전의 본문 기록은 그대로의 본문이다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me, { body: '사무국이 다듬은 본문' })
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: null,
    version: newVersion(doc, me),
    body: { mode: 'keep' },
  })
  const after = await Q.versions.getBoardDocumentForEdit(doc)
  assert.equal(after.bodyMarkdown, '사무국이 다듬은 본문')
  const [v2] = await Q.versions.listBoardDocumentVersions(doc)
  assert.equal(v2.bodyMarkdown, '사무국이 다듬은 본문')
})

test('본문이 없던 서류는 NULL 그대로', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: newVersion(doc, me),
    body: { mode: 'set', value: null },
  })
  assert.equal((await Q.versions.getBoardDocumentForEdit(doc)).bodyMarkdown, null)
  for (const v of await Q.versions.listBoardDocumentVersions(doc))
    assert.equal(v.bodyMarkdown, null)
})

test('기준 버전이 최신이 아니면 conflict — 아무것도 바뀌지 않는다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: newVersion(doc, me),
    body: { mode: 'keep' },
  })
  const snapshot = await Q.versions.getBoardDocumentForEdit(doc)
  await assert.rejects(
    Q.versions.addBoardDocumentVersion({
      documentId: doc,
      baseVersionNo: 1, // 다른 탭에서 v2 가 먼저 저장됐다
      version: newVersion(doc, me),
      body: { mode: 'keep' },
    }),
    e => e instanceof Q.versions.BoardDocumentVersionWriteError && e.code === 'conflict'
  )
  assert.equal((await Q.versions.listBoardDocumentVersions(doc)).length, 2)
  assert.equal((await Q.versions.getBoardDocumentForEdit(doc)).filePath, snapshot.filePath)
})

test('같은 업로드 id 를 두 번 승격하지 못한다(PK) — 버전이 하나만 는다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  const v = newVersion(doc, me)
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: null,
    version: v,
    body: { mode: 'keep' },
  })
  await assert.rejects(
    Q.versions.addBoardDocumentVersion({
      documentId: doc,
      baseVersionNo: null,
      version: v,
      body: { mode: 'keep' },
    })
  )
  assert.equal((await Q.versions.listBoardDocumentVersions(doc)).length, 2)
})

test('되돌리기: 고른 버전을 새 버전으로 — 지나간 행은 그대로, 최신으로는 못 되돌린다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me, { body: 'v1 본문' })
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: newVersion(doc, me),
    body: { mode: 'set', value: 'v2 본문' },
  })
  const [v2, v1] = await Q.versions.listBoardDocumentVersions(doc)
  await assert.rejects(
    Q.versions.addBoardDocumentVersion({
      documentId: doc,
      baseVersionNo: 2,
      version: newVersion(doc, me, { source: 'revert' }),
      body: { mode: 'keep' },
      revertFromVersionId: v2.id,
    }),
    e => e.code === 'conflict'
  )
  const v3 = newVersion(doc, me, { source: 'revert', fileSize: v1.fileSize })
  const added = await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 2,
    version: v3,
    body: { mode: 'set', value: v1.bodyMarkdown },
    revertFromVersionId: v1.id,
  })
  assert.equal(added.versionNo, 3)
  assert.equal(added.initialVersionId, null)
  const list = await Q.versions.listBoardDocumentVersions(doc)
  assert.deepEqual(
    list.map(v => [v.versionNo, v.source]),
    [
      [3, 'revert'],
      [2, 'office-editor'],
      [1, 'upload'],
    ]
  )
  // 지나간 행은 고치지 않는다
  assert.equal(list[1].filePath, v2.filePath)
  assert.equal(list[2].filePath, v1.filePath)
  assert.equal((await Q.versions.getBoardDocumentForEdit(doc)).bodyMarkdown, 'v1 본문')
})

test('다른 서류의 버전 id 로는 읽지도 되돌리지도 못한다', async () => {
  const me = await seedDirector()
  const a = await seedDocument(me)
  const b = await seedDocument(me)
  await Q.versions.addBoardDocumentVersion({
    documentId: a,
    baseVersionNo: 1,
    version: newVersion(a, me),
    body: { mode: 'keep' },
  })
  await Q.versions.addBoardDocumentVersion({
    documentId: b,
    baseVersionNo: 1,
    version: newVersion(b, me),
    body: { mode: 'keep' },
  })
  const [, aV1] = await Q.versions.listBoardDocumentVersions(a)
  assert.equal(await Q.versions.getBoardDocumentVersion(b, aV1.id), null)
  assert.ok(await Q.versions.getBoardDocumentVersion(a, aV1.id))
  await assert.rejects(
    Q.versions.addBoardDocumentVersion({
      documentId: b,
      baseVersionNo: 2,
      version: newVersion(b, me, { source: 'revert' }),
      body: { mode: 'keep' },
      revertFromVersionId: aV1.id,
    }),
    e => e.code === 'not_found'
  )
  assert.equal((await Q.versions.listBoardDocumentVersions(b)).length, 2)
})

test('없는 서류에는 버전을 넣지 못한다', async () => {
  const me = await seedDirector()
  const ghost = crypto.randomUUID()
  await assert.rejects(
    Q.versions.addBoardDocumentVersion({
      documentId: ghost,
      baseVersionNo: null,
      version: newVersion(ghost, me),
      body: { mode: 'keep' },
    }),
    e => e.code === 'not_found'
  )
  assert.equal(await Q.versions.getBoardDocumentForEdit(ghost), null)
})

test('새 버전은 파일 본문 추출 결과를 지운다 — 서류가 추출 대상으로 돌아간다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  await Q.docTexts.upsertBoardDocumentText({
    documentId: doc,
    ext: 'docx',
    content: '옛 파일 속 글자',
    truncated: false,
    status: 'ok',
    extractorVersion: 'kordoc-test',
    attempts: 1,
  })
  assert.ok(await Q.docTexts.getBoardDocumentTextRecord(doc))
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: newVersion(doc, me),
    body: { mode: 'keep' },
  })
  assert.equal(await Q.docTexts.getBoardDocumentTextRecord(doc), null)
  const [candidate] = await Q.docTexts.getBoardDocumentExtractionCandidates([doc])
  assert.equal(candidate.done, false)
  assert.match(candidate.file_path ?? candidate.filePath, /^versions\//)
})

test('서류를 지우면 버전 행이 CASCADE 로 지워진다 — 지우기 전에 경로를 모을 수 있다', async () => {
  const me = await seedDirector()
  const doc = await seedDocument(me)
  const v2 = newVersion(doc, me)
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: v2,
    body: { mode: 'keep' },
  })
  const paths = await Q.versions.listBoardDocumentVersionPaths(doc)
  assert.equal(paths.length, 2)
  assert.ok(paths.includes(v2.filePath))
  await Q.board.deleteDocument(doc)
  assert.deepEqual(await Q.versions.listBoardDocumentVersionPaths(doc), [])
})

test('저장한 회원을 지워도 버전 기록은 남는다(created_by SET NULL)', async () => {
  const uploader = await seedDirector()
  const editor = await seedDirector()
  const doc = await seedDocument(uploader)
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: newVersion(doc, editor),
    body: { mode: 'keep' },
  })
  await setupClient.execute('PRAGMA foreign_keys = ON')
  await setupClient.execute({ sql: 'delete from member_profiles where id = ?', args: [editor] })
  const [v2] = await Q.versions.listBoardDocumentVersions(doc)
  assert.equal(v2.createdBy, null)
  assert.equal(v2.createdByName, null)
})

test('마이그레이션 0038 이 만든 표·색인·FK 가 스키마 선언과 같다', async () => {
  const idx = await setupClient.execute(
    "select name from sqlite_master where type = 'index' and tbl_name = 'board_document_versions' and name not like 'sqlite_%' order by name"
  )
  assert.deepEqual(
    idx.rows.map(r => r.name),
    ['board_document_versions_doc_no_key']
  )
  const fk = await setupClient.execute(
    `select "table", "from", on_delete from pragma_foreign_key_list('board_document_versions')`
  )
  assert.deepEqual(fk.rows.map(r => `${r.from}->${r.table}:${r.on_delete}`).sort(), [
    'created_by->member_profiles:SET NULL',
    'document_id->board_documents:CASCADE',
  ])
})
