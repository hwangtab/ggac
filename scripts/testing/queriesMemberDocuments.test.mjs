import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 조합원 내 문서함 쿼리 계층(마이그레이션 0035)을 실제 SQLite 파일 DB로 본다 — docs/board-work/04-조합원-문서함.md §2·§5·§6.
 *
 * - **소유 경계는 데이터 규칙이다**: 남의 ownerId 로는 어떤 함수도 문서·버전·임시 업로드를 읽거나 바꾸지 못한다(null·false·not_found).
 * - 사용량은 모든 버전 + 24시간 안의 임시 업로드다. 임시 업로드를 만들 때와 승격할 때 같은 트랜잭션에서 다시 센다.
 * - 보존 후보 쿼리는 순수 판정 `retentionActionOf`와 같은 답을 낸다. 열면(touch) 시계가 처음부터 다시 간다.
 * - 문서를 지우면 버전·임시 업로드가 CASCADE 로 지워진다.
 */

const DB_PATH = 'scripts/testing/.queries-member-documents-test.db'
const src = rel => new URL(`../../src/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const DAY = 24 * 60 * 60 * 1000
const MB = 1024 * 1024

let setupClient
let Q
let R

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = {
    profiles: await import(src('db/queries/profiles.ts')),
    docs: await import(src('db/queries/memberDocuments.ts')),
  }
  R = await import(src('lib/memberDocuments/rules.ts'))
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedMember() {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `md-${++counter}@test.local`,
    display_name: `문서함${counter}`,
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

function pendingRow(ownerId, { size = 1000, documentId = null, name = 'a.docx' } = {}) {
  const id = crypto.randomUUID()
  return {
    id,
    ownerId,
    documentId,
    blobPath: `member-documents/${ownerId}/${id}/a.docx`,
    name,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size,
  }
}

/** 임시 업로드 → 새 문서 v1 */
async function seedDocument(ownerId, { size = 1000, now } = {}) {
  const row = pendingRow(ownerId, { size })
  await Q.docs.insertMemberDocumentUpload(row, { maxPending: 20, now })
  const created = await Q.docs.createMemberDocumentFromUpload({
    ownerId,
    uploadId: row.id,
    version: { name: row.name, mime: row.mime, size, blobPath: row.blobPath, source: 'upload' },
    maxDocuments: 500,
    now,
  })
  return created
}

async function setTimes(documentId, { lastOpenedAt, deletionNotifiedAt }) {
  await setupClient.execute({
    sql: 'update member_documents set last_opened_at = ?, deletion_notified_at = ? where id = ?',
    args: [lastOpenedAt, deletionNotifiedAt ?? null, documentId],
  })
}

// ── 소유 경계 ─────────────────────────────────────────────────────────────────

test('남의 ownerId 로는 문서·버전·임시 업로드를 읽지도 바꾸지도 못한다', async () => {
  const owner = await seedMember()
  const other = await seedMember()
  const { documentId, versionId } = await seedDocument(owner)

  // 읽기
  assert.ok(await Q.docs.getOwnedMemberDocument(owner, documentId))
  assert.equal(await Q.docs.getOwnedMemberDocument(other, documentId), null)
  assert.ok(await Q.docs.getOwnedMemberDocumentVersion(owner, versionId))
  assert.equal(await Q.docs.getOwnedMemberDocumentVersion(other, versionId), null)
  assert.equal((await Q.docs.listMemberDocuments(other)).length, 0)
  assert.equal((await Q.docs.listMemberDocuments(owner)).length, 1)

  // 바꾸기
  assert.equal(await Q.docs.touchOwnedMemberDocument(other, documentId), false)
  assert.equal(await Q.docs.renameOwnedMemberDocument(other, documentId, '남의 것.docx'), false)
  assert.equal(await Q.docs.deleteOwnedMemberDocumentRow(other, documentId), false)
  assert.equal((await Q.docs.getOwnedMemberDocument(owner, documentId)).document.name, 'a.docx')

  // 남의 문서로 임시 업로드·새 버전
  await assert.rejects(
    Q.docs.insertMemberDocumentUpload(pendingRow(other, { documentId }), { maxPending: 20 }),
    e => e.code === 'not_found'
  )
  const otherUpload = pendingRow(other)
  await Q.docs.insertMemberDocumentUpload(otherUpload, { maxPending: 20 })
  await assert.rejects(
    Q.docs.addMemberDocumentVersion({
      ownerId: other,
      documentId,
      uploadId: otherUpload.id,
      baseVersionNo: null,
      version: { ...otherUpload, source: 'upload' },
    }),
    e => e.code === 'not_found'
  )
  // 남의 임시 업로드
  assert.equal(await Q.docs.getOwnedMemberDocumentUpload(owner, otherUpload.id), null)
  assert.equal(await Q.docs.deleteOwnedMemberDocumentUpload(owner, otherUpload.id), null)
  assert.ok(await Q.docs.getOwnedMemberDocumentUpload(other, otherUpload.id))
  // 남의 임시 업로드로 내 문서 만들기
  await assert.rejects(
    Q.docs.createMemberDocumentFromUpload({
      ownerId: owner,
      uploadId: otherUpload.id,
      version: { ...otherUpload, source: 'upload' },
      maxDocuments: 500,
    }),
    e => e.code === 'not_found'
  )
})

// ── 사용량 ────────────────────────────────────────────────────────────────────

test('사용량은 모든 버전 + 24시간 안의 임시 업로드이고, 넘으면 임시 업로드를 만들지 않는다', async () => {
  const owner = await seedMember()
  const { documentId } = await seedDocument(owner, { size: 120 * MB })
  const now = new Date()

  // 버전을 하나 더(같은 크기) — 모든 버전을 센다
  const v2 = pendingRow(owner, { size: 50 * MB, documentId })
  await Q.docs.insertMemberDocumentUpload(v2, { maxPending: 20 })
  let usage = await Q.docs.getMemberDocumentUsage(owner)
  assert.deepEqual(usage, { stored: 120 * MB, pending: 50 * MB, total: 170 * MB })
  await Q.docs.addMemberDocumentVersion({
    ownerId: owner,
    documentId,
    uploadId: v2.id,
    baseVersionNo: 1,
    version: { ...v2, source: 'upload' },
  })
  usage = await Q.docs.getMemberDocumentUsage(owner)
  assert.deepEqual(usage, { stored: 170 * MB, pending: 0, total: 170 * MB })

  // 30MB 는 들어가고(=200MB) 1바이트 더는 안 된다
  const fits = pendingRow(owner, { size: 30 * MB })
  await Q.docs.insertMemberDocumentUpload(fits, { maxPending: 20, now })
  await assert.rejects(
    Q.docs.insertMemberDocumentUpload(pendingRow(owner, { size: 1 }), { maxPending: 20, now }),
    e => e.code === 'quota'
  )

  // 24시간이 지난 임시 업로드는 자리를 잡지 않는다
  const later = new Date(now.getTime() + DAY + 1000)
  assert.equal((await Q.docs.getMemberDocumentUsage(owner, later)).pending, 0)
  assert.equal(await Q.docs.getOwnedMemberDocumentUpload(owner, fits.id, later), null)
  // 다른 사람 사용량은 따로다
  const other = await seedMember()
  assert.equal((await Q.docs.getMemberDocumentUsage(other)).total, 0)
})

test('승격할 때 사용량을 다시 본다 — 그 사이 다른 업로드가 자리를 채웠으면 거절', async () => {
  const owner = await seedMember()
  const a = pendingRow(owner, { size: 150 * MB })
  const b = pendingRow(owner, { size: 50 * MB })
  await Q.docs.insertMemberDocumentUpload(a, { maxPending: 20 })
  await Q.docs.insertMemberDocumentUpload(b, { maxPending: 20 })
  // a 를 승격(실제 크기가 알린 것보다 컸다고 치면 넘친다)
  await assert.rejects(
    Q.docs.createMemberDocumentFromUpload({
      ownerId: owner,
      uploadId: a.id,
      version: { ...a, size: 151 * MB, source: 'upload' },
      maxDocuments: 500,
    }),
    e => e.code === 'quota'
  )
  // 알린 크기 그대로면 자기 몫을 두 번 세지 않으므로 통과
  await Q.docs.createMemberDocumentFromUpload({
    ownerId: owner,
    uploadId: a.id,
    version: { ...a, source: 'upload' },
    maxDocuments: 500,
  })
  // 같은 업로드로 두 번 만들지 못한다
  await assert.rejects(
    Q.docs.createMemberDocumentFromUpload({
      ownerId: owner,
      uploadId: a.id,
      version: { ...a, source: 'upload' },
      maxDocuments: 500,
    }),
    e => e.code === 'not_found' || e.code === 'quota'
  )
})

test('동시 임시 업로드 수 상한', async () => {
  const owner = await seedMember()
  await Q.docs.insertMemberDocumentUpload(pendingRow(owner), { maxPending: 2 })
  await Q.docs.insertMemberDocumentUpload(pendingRow(owner), { maxPending: 2 })
  await assert.rejects(
    Q.docs.insertMemberDocumentUpload(pendingRow(owner), { maxPending: 2 }),
    e => e.code === 'too_many'
  )
})

// ── 버전 ──────────────────────────────────────────────────────────────────────

test('새 버전은 최신 번호 다음이고, 기준 버전이 낡았으면 conflict', async () => {
  const owner = await seedMember()
  const { documentId } = await seedDocument(owner)
  const up = pendingRow(owner, { documentId, name: 'b.docx' })
  await Q.docs.insertMemberDocumentUpload(up, { maxPending: 20 })
  const added = await Q.docs.addMemberDocumentVersion({
    ownerId: owner,
    documentId,
    uploadId: up.id,
    baseVersionNo: 1,
    version: { ...up, name: 'a.docx', source: 'editor' },
  })
  assert.equal(added.versionNo, 2)
  const stale = pendingRow(owner, { documentId })
  await Q.docs.insertMemberDocumentUpload(stale, { maxPending: 20 })
  await assert.rejects(
    Q.docs.addMemberDocumentVersion({
      ownerId: owner,
      documentId,
      uploadId: stale.id,
      baseVersionNo: 1,
      version: { ...stale, source: 'editor' },
    }),
    e => e.code === 'conflict'
  )
  const found = await Q.docs.getOwnedMemberDocument(owner, documentId)
  assert.deepEqual(
    found.versions.map(v => v.versionNo),
    [2, 1]
  )
  assert.equal(found.document.latestVersionNo, 2)
  const [item] = await Q.docs.listMemberDocuments(owner)
  assert.equal(item.latestVersionId, added.versionId)
  assert.equal(item.versionCount, 2)
  assert.equal(item.totalSize, 2000)
})

test('문서를 지우면 버전·임시 업로드가 함께 지워진다(CASCADE)', async () => {
  const owner = await seedMember()
  const { documentId } = await seedDocument(owner)
  const up = pendingRow(owner, { documentId })
  await Q.docs.insertMemberDocumentUpload(up, { maxPending: 20 })
  assert.deepEqual(await Q.docs.listOwnedDocumentUploadPaths(owner, documentId), [up.blobPath])
  assert.equal(await Q.docs.deleteOwnedMemberDocumentRow(owner, documentId), true)
  const left = await setupClient.execute({
    sql: `select (select count(*) from member_document_versions where document_id = ?) v,
                 (select count(*) from member_document_uploads where document_id = ?) u`,
    args: [documentId, documentId],
  })
  assert.equal(Number(left.rows[0].v), 0)
  assert.equal(Number(left.rows[0].u), 0)
})

// ── 보존 ──────────────────────────────────────────────────────────────────────

test('보존 후보 쿼리는 순수 판정 retentionActionOf 와 같은 답을 낸다', async () => {
  const owner = await seedMember()
  const now = new Date(Date.now() + 3650 * DAY) // 다른 시험 문서와 섞이지 않게 먼 미래로 둔다
  const t = now.getTime()
  const cases = [
    { lastOpenedAt: t - 10 * DAY, deletionNotifiedAt: null },
    { lastOpenedAt: t - 364 * DAY, deletionNotifiedAt: null },
    { lastOpenedAt: t - 365 * DAY, deletionNotifiedAt: null },
    { lastOpenedAt: t - 900 * DAY, deletionNotifiedAt: null },
    { lastOpenedAt: t - 400 * DAY, deletionNotifiedAt: t - 29 * DAY },
    { lastOpenedAt: t - 400 * DAY, deletionNotifiedAt: t - 30 * DAY },
    // 알린 뒤 열었다(쿼리상 touch 가 알림을 지우지만, 비워지지 않은 행도 지우지 않아야 한다)
    { lastOpenedAt: t - 5 * DAY, deletionNotifiedAt: t - 40 * DAY },
  ]
  const ids = []
  for (const c of cases) {
    const { documentId } = await seedDocument(owner)
    await setTimes(documentId, c)
    ids.push(documentId)
  }
  const notify = new Set(
    (await Q.docs.listRetentionNotifyCandidates(now, 1000))
      .map(r => r.id)
      .filter(id => ids.includes(id))
  )
  const del = new Set(
    (await Q.docs.listRetentionDeleteCandidates(now, 1000))
      .map(r => r.id)
      .filter(id => ids.includes(id))
  )
  cases.forEach((c, i) => {
    const expected = R.retentionActionOf(c, now)
    const got = notify.has(ids[i]) ? 'notify' : del.has(ids[i]) ? 'delete' : 'keep'
    assert.equal(got, expected, `case ${i}: ${JSON.stringify(c)}`)
  })
  assert.deepEqual(
    cases.map(c => R.retentionActionOf(c, now)),
    ['keep', 'keep', 'notify', 'notify', 'keep', 'delete', 'keep']
  )
})

test('알림 표시는 그 사이 연 문서를 건너뛰고, 열면 알림이 지워져 지울 대상에서 빠진다', async () => {
  const owner = await seedMember()
  const now = new Date(Date.now() + 7300 * DAY)
  const t = now.getTime()
  const a = (await seedDocument(owner)).documentId
  const b = (await seedDocument(owner)).documentId
  await setTimes(a, { lastOpenedAt: t - 400 * DAY })
  await setTimes(b, { lastOpenedAt: t - 400 * DAY })
  // b 는 후보로 뽑힌 뒤 표시 전에 열렸다
  await Q.docs.touchOwnedMemberDocument(owner, b, now)
  const marked = await Q.docs.markDeletionNotified([a, b], now)
  assert.deepEqual(marked, [a])

  // 30일 뒤 — a 는 지울 대상이다. 그런데 직전에 열면(touch) 알림이 지워지고 지워지지 않는다
  const later = new Date(t + 31 * DAY)
  assert.ok((await Q.docs.listRetentionDeleteCandidates(later, 1000)).some(r => r.id === a))
  await Q.docs.touchOwnedMemberDocument(owner, a, new Date(t + 30 * DAY + 1))
  assert.equal(await Q.docs.deleteExpiredMemberDocument(a, later), false)
  const doc = await Q.docs.getOwnedMemberDocument(owner, a)
  assert.equal(doc.document.deletionNotifiedAt, null)
  assert.equal(R.retentionActionOf(doc.document, later), 'keep')
})

test('알린 지 30일이 지나도 안 열었으면 지워지고, 지울 대상에 버전 객체 경로가 실린다', async () => {
  const owner = await seedMember()
  const now = new Date(Date.now() + 10950 * DAY)
  const t = now.getTime()
  const { documentId, versionId } = await seedDocument(owner)
  await setTimes(documentId, { lastOpenedAt: t - 400 * DAY, deletionNotifiedAt: t - 31 * DAY })
  const [cand] = (await Q.docs.listRetentionDeleteCandidates(now, 1000)).filter(
    r => r.id === documentId
  )
  assert.deepEqual(cand.versionIds, [versionId])
  assert.equal(cand.blobPaths.length, 1)
  assert.ok(cand.blobPaths[0].startsWith(`member-documents/${owner}/`))
  assert.equal(await Q.docs.deleteExpiredMemberDocument(documentId, now), true)
  assert.equal(await Q.docs.getOwnedMemberDocument(owner, documentId), null)
})

test('24시간이 지난 임시 업로드만 정리 대상이다', async () => {
  const owner = await seedMember()
  const now = new Date(Date.now() + 14600 * DAY)
  const fresh = pendingRow(owner)
  const stale = pendingRow(owner)
  await Q.docs.insertMemberDocumentUpload(fresh, { maxPending: 20, now })
  await Q.docs.insertMemberDocumentUpload(stale, {
    maxPending: 20,
    now: new Date(now.getTime() - DAY - 1000),
  })
  const list = (await Q.docs.listExpiredMemberDocumentUploads(now, 1000)).map(r => r.id)
  assert.ok(list.includes(stale.id))
  assert.ok(!list.includes(fresh.id))
  assert.equal(await Q.docs.deleteMemberDocumentUploadRows([stale.id]), 1)
})

test('마이그레이션 0035 가 만든 표·색인·FK 가 스키마 선언과 같다', async () => {
  const idx = await setupClient.execute(
    "select tbl_name, name from sqlite_master where type = 'index' and tbl_name like 'member_document%' and name not like 'sqlite_%' order by tbl_name, name"
  )
  assert.deepEqual(
    idx.rows.map(r => `${r.tbl_name}.${r.name}`),
    [
      'member_document_uploads.member_document_uploads_blob_path_key',
      'member_document_uploads.member_document_uploads_created_idx',
      'member_document_uploads.member_document_uploads_owner_idx',
      'member_document_versions.member_document_versions_blob_path_key',
      'member_document_versions.member_document_versions_doc_no_key',
      'member_document_versions.member_document_versions_owner_idx',
      'member_documents.member_documents_last_opened_idx',
      'member_documents.member_documents_owner_idx',
    ]
  )
  const fk = await setupClient.execute(
    `select 'v' t, "table", "from", on_delete from pragma_foreign_key_list('member_document_versions')
     union all select 'u', "table", "from", on_delete from pragma_foreign_key_list('member_document_uploads')
     union all select 'd', "table", "from", on_delete from pragma_foreign_key_list('member_documents')`
  )
  const keys = fk.rows.map(r => `${r.t}:${r.from}->${r.table}:${r.on_delete}`).sort()
  assert.deepEqual(keys, [
    'd:owner_id->member_profiles:CASCADE',
    'u:document_id->member_documents:CASCADE',
    'u:owner_id->member_profiles:CASCADE',
    'v:document_id->member_documents:CASCADE',
    'v:owner_id->member_profiles:CASCADE',
  ])
})
