import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 서류의 두 쿼리를 실제 SQLite 파일 DB로 본다.
 *
 * - `findReferencedBoardDocumentPaths`: 고아 청소가 "가리킨다"로 볼 경로 — 서류 행의 `file_path`, 버전 행의 `file_path`
 *   (v1 의 옛 경로 `<올린 사람>/<파일>` 과 `versions/<서류>/<버전>/<이름>`). 둘 다 저장소 접두 없이 저장된다.
 * - `createDocumentIfPathFree`: 이미 쓰는 경로(서류·버전 행)면 null. 동시 등록 경합은 DB 를 못 쓰게 만들어
 *   `queriesBoardDocumentRegisterRace.test.mjs`에 따로 둔다.
 */

const DB_PATH = 'scripts/testing/.queries-board-document-orphans-test.db'
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
    email: `bdo-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    is_director: true,
  })
  return id
}

function docInput(uploader, filePath) {
  return {
    title: '제10차 이사회 회의록',
    category: '회의록',
    filePath,
    fileName: '회의록.pdf',
    fileSize: 1234,
    mimeType: 'application/pdf',
    uploadedBy: uploader,
    visibility: 'board',
  }
}

async function countByPath(filePath) {
  const r = await setupClient.execute({
    sql: 'SELECT count(*) AS n FROM board_documents WHERE file_path = ?',
    args: [filePath],
  })
  return Number(r.rows[0].n)
}

test('findReferenced: 서류 행·버전 행(v1 옛 경로와 versions/ 경로) 모두 가리킨다로 본다 — 행 없는 경로는 아니다', async () => {
  const me = await seedDirector()
  const original = `${me}/1750000000000_abc_minutes.pdf`
  const { id: doc } = await Q.board.createDocument(docInput(me, original))
  // 앱에서 한 번 고치면 서류 칸은 versions/… 로 바뀌고 옛 경로는 v1 행에만 남는다
  const v2 = crypto.randomUUID()
  const v2Path = `versions/${doc}/${v2}/minutes.pdf`
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: {
      id: v2,
      filePath: v2Path,
      fileName: '회의록.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      source: 'office-editor',
      createdBy: me,
    },
    body: { mode: 'keep' },
  })
  const pendingEdit = `versions/${doc}/${crypto.randomUUID()}/minutes.pdf` // 승격 전에 끊긴 저장본
  const unregistered = `${me}/1750000000001_def_scan.pdf` // 올리고 등록하지 않은 업로드

  const referenced = await Q.board.findReferencedBoardDocumentPaths([
    original,
    v2Path,
    pendingEdit,
    unregistered,
  ])
  assert.deepEqual([...referenced].sort(), [original, v2Path].sort())
  // 접두(`board-documents/`)가 붙은 값은 행의 값과 다르다 — 호출부가 떼고 물어야 한다
  const prefixed = await Q.board.findReferencedBoardDocumentPaths([`board-documents/${v2Path}`])
  assert.equal(prefixed.size, 0)
})

test('findReferenced: 대소문자만 다른 키도 가리킨다로 본다(지우는 쪽으로 틀리지 않게) — 받은 문자열을 그대로 돌려준다', async () => {
  const me = await seedDirector()
  const filePath = `${me}/1750000000002_ghi_Report.PDF`
  await Q.board.createDocument(docInput(me, filePath))
  const asked = filePath.toUpperCase().replace(me.toUpperCase(), me)
  const referenced = await Q.board.findReferencedBoardDocumentPaths([asked])
  assert.deepEqual([...referenced], [asked])
})

test('findReferenced: 200개 넘게 물어도 나눠서 본다', async () => {
  const me = await seedDirector()
  const filePath = `${me}/1750000000003_jkl_last.pdf`
  await Q.board.createDocument(docInput(me, filePath))
  const many = Array.from({ length: 450 }, (_, i) => `${me}/x_${i}.pdf`)
  many.push(filePath)
  const referenced = await Q.board.findReferencedBoardDocumentPaths(many)
  assert.deepEqual([...referenced], [filePath])
})

test('createDocumentIfPathFree: 버전 행에만 남은 경로(v1 옛 경로)로도 새 서류를 만들지 않는다', async () => {
  const me = await seedDirector()
  const original = `${me}/1750000000005_pqr_old.pdf`
  const { id: doc } = await Q.board.createDocument(docInput(me, original))
  const v2 = crypto.randomUUID()
  await Q.versions.addBoardDocumentVersion({
    documentId: doc,
    baseVersionNo: 1,
    version: {
      id: v2,
      filePath: `versions/${doc}/${v2}/old.pdf`,
      fileName: '회의록.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      source: 'office-editor',
      createdBy: me,
    },
    body: { mode: 'keep' },
  })
  assert.equal(await countByPath(original), 0, '서류 칸은 이제 versions/ 경로다')
  assert.equal(await Q.board.createDocumentIfPathFree(docInput(me, original)), null)
  assert.equal(await countByPath(original), 0)
})

test('createDocumentIfPathFree: 빈 경로면 만든다', async () => {
  const me = await seedDirector()
  const filePath = `${me}/1750000000006_stu_new.pdf`
  const row = await Q.board.createDocumentIfPathFree(docInput(me, filePath))
  assert.ok(row?.id)
  assert.equal(await countByPath(filePath), 1)
})

test('createDocumentIfPathFree: 서류 행이 이미 쓰는 경로면 null — 행을 더 만들지 않는다', async () => {
  const me = await seedDirector()
  const filePath = `${me}/1750000000007_vwx_taken.pdf`
  assert.ok((await Q.board.createDocumentIfPathFree(docInput(me, filePath)))?.id)
  assert.equal(await Q.board.createDocumentIfPathFree(docInput(me, filePath)), null)
  assert.equal(await countByPath(filePath), 1)
})
