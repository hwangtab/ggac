import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'
import JSZip from 'jszip'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 서류 파일 본문 추출·검색(03 §10, 마이그레이션 0034 `work_board_document_texts`)을 실제 SQLite 파일 DB로 본다.
 *
 * - 대기열: 추출 대상 확장자만, 최신 순, 업무툴 첨부와 섞여 한 대기열로 돈다. 재시도는 1시간 뒤 3회까지.
 * - 서류 경로는 `isSafeBoardDocumentFilePath`를 지나야 내려받는다(같은 저장소에 DB 백업이 있다).
 * - 서류를 지우면 결과 행도 지워진다(ON DELETE CASCADE).
 * - 검색(`searchDocuments`): 파일 속 글자도 AND 일치에 들고 첫 일치 주변 창을 돌려준다. 등급 밖 서류는 본문이 맞아도 없다.
 * 실제 추출기(kordoc)는 픽스처 DOCX(빈 서식 + 넣은 문구)로 한 번 끝까지 돌린다 — 저장소만 가짜(deps.download)다.
 */

const DB_PATH = 'scripts/testing/.queries-board-document-texts-test.db'
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
    docTexts: await import(src('db/queries/work/boardDocumentTexts.ts')),
    texts: await import(src('db/queries/work/texts.ts')),
    channels: await import(src('db/queries/work/channels.ts')),
    messages: await import(src('db/queries/work/messages.ts')),
    files: await import(src('db/queries/work/files.ts')),
    paths: await import(src('work/lib/files/paths.ts')),
    store: await import(src('work/lib/files/extract-store.ts')),
    snippet: await import(src('work/lib/search/documents.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedPerson() {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bdt-${++counter}@test.local`,
    display_name: `서류이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    is_director: true,
  })
  return id
}

/** 서류 행(바이트는 없다 — 내려받기는 deps 로 바꿔 끼운다). createdAt 을 정해 최신 순을 본다 */
async function seedDocument(uploader, { fileName, visibility = 'board', title, createdAt, path }) {
  const { id } = await Q.board.createDocument({
    title: title ?? `서류 ${fileName}`,
    category: '기타',
    filePath: path ?? `${uploader}/${Date.now()}_${fileName}`,
    fileName,
    fileSize: 1234,
    mimeType: 'application/octet-stream',
    uploadedBy: uploader,
    visibility,
  })
  if (createdAt !== undefined) {
    await setupClient.execute({
      sql: 'update board_documents set created_at = ? where id = ?',
      args: [createdAt, id],
    })
  }
  return id
}

/** 이 파일의 다른 테스트가 남긴 대상을 모두 처리해 둔다(배치 수를 정확히 세려고) */
async function drainPending() {
  for (const t of await Q.store.fetchPending(20_000, Date.now() + 365 * 24 * 3600 * 1000)) {
    const row = {
      ext: 'x',
      content: '',
      truncated: false,
      status: 'unsupported',
      extractorVersion: 'drain',
      attempts: 9,
    }
    if (t.kind === 'board_document') {
      await Q.docTexts.upsertBoardDocumentText({ documentId: t.id, ...row })
    } else {
      await Q.texts.upsertAttachmentText({ attachmentId: t.id, ...row })
    }
  }
}

const okDeps = text => ({
  download: async () => Buffer.from('ignored'),
  extract: async () => ({ status: 'ok', content: text, truncated: false }),
})

const putDocText = (documentId, content, status = 'ok') =>
  Q.docTexts.upsertBoardDocumentText({
    documentId,
    ext: 'pdf',
    content: status === 'ok' ? content : '',
    truncated: false,
    status,
    extractorVersion: 'test',
    attempts: 1,
  })

// ── 대기열 ───────────────────────────────────────────────────────────────────

test('대기열: 추출 대상 확장자의 서류만, 최신 순으로 — 파일 이름이 없으면 저장 경로의 확장자를 본다', async () => {
  const me = await seedPerson()
  await drainPending()
  const base = Date.now() - 10_000
  const older = await seedDocument(me, { fileName: '오래된.hwp', createdAt: base })
  const newer = await seedDocument(me, { fileName: '새.pdf', createdAt: base + 2_000 })
  const image = await seedDocument(me, { fileName: '도장.png', createdAt: base + 3_000 })
  const noName = await seedDocument(me, {
    fileName: '',
    path: `${me}/1790000000000_정관.docx`,
    createdAt: base + 1_000,
  })

  const pending = await Q.docTexts.listPendingBoardDocumentTextRows({
    exts: ['hwp', 'pdf', 'docx'],
    limit: 50,
    maxAttempts: 3,
    retryBefore: new Date(),
  })
  assert.deepEqual(
    pending.map(p => p.id),
    [newer, noName, older]
  )
  assert.ok(!pending.some(p => p.id === image), '추출 대상 확장자가 아니면 대기열에 없다')
  assert.equal(pending.find(p => p.id === noName).name, `${me}/1790000000000_정관.docx`)
  assert.equal(pending[0].size, 1234)
  assert.equal(pending[0].attempts, 0)
})

test('대기열: 업무툴 첨부와 이사회 서류가 한 대기열에서 올린 시각 최신 순으로 섞인다', async () => {
  const me = await seedPerson()
  await drainPending()
  const id = crypto.randomUUID()
  const label = `서류섞기-${id.slice(0, 8)}`
  const created = await Q.channels.createChannelRow({
    id,
    kind: 'public',
    name: label,
    slug: label.toLowerCase(),
    topic: null,
    categoryId: null,
    creatorId: me,
  })
  assert.equal(created.status, 'created')
  const messageId = crypto.randomUUID()
  await Q.messages.insertMessage({
    id: messageId,
    channelId: id,
    authorId: me,
    body: '첨부',
    canPostRestricted: true,
  })
  const uploadId = crypto.randomUUID()
  await Q.files.insertPendingUploads(
    [
      {
        id: uploadId,
        channelId: id,
        uploaderId: me,
        blobPath: Q.paths.buildUploadPath(uploadId, '첨부.hwp'),
        name: '첨부.hwp',
        mime: 'application/octet-stream',
        size: 10,
      },
    ],
    { maxPerUser: 100 }
  )
  const attachment = await Q.files.promotePendingUpload({
    uploadId,
    messageId,
    actorId: me,
    size: 10,
  })
  const now = Date.now()
  await setupClient.execute({
    sql: 'update work_attachments set created_at = ? where id = ?',
    args: [now - 5_000, attachment.id],
  })
  const docNew = await seedDocument(me, { fileName: '새 서류.pdf', createdAt: now - 1_000 })
  const docOld = await seedDocument(me, { fileName: '옛 서류.pdf', createdAt: now - 9_000 })

  const queue = await Q.store.fetchPending(10)
  assert.deepEqual(
    queue.map(t => [t.kind, t.id]),
    [
      ['board_document', docNew],
      ['attachment', attachment.id],
      ['board_document', docOld],
    ]
  )
  assert.deepEqual(
    (await Q.store.fetchPending(2)).map(t => t.id),
    [docNew, attachment.id],
    '상한은 섞은 뒤에 자른다'
  )
  const doc = queue[0]
  assert.equal(doc.channel_id, '')
  assert.match(doc.bucket_path, new RegExp(`^${me}/`))

  const r = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps: okDeps('섞인 본문') })
  assert.equal(r.processed, 3)
  assert.equal(r.extracted, 3)
  assert.equal((await Q.docTexts.getBoardDocumentTextRecord(docNew)).status, 'ok')
  assert.equal((await Q.texts.getAttachmentTextRecord(attachment.id)).status, 'ok')
})

// ── 상태 전이 ─────────────────────────────────────────────────────────────────

test('서류 추출 상태 전이: 실패는 선점 행이 남고 1시간 뒤에만 3회까지 다시 집는다', async () => {
  const me = await seedPerson()
  await drainPending()
  const good = await seedDocument(me, { fileName: '좋은 서류.docx' })
  const bad = await seedDocument(me, { fileName: '나쁜 서류.hwp' })
  const deps = {
    download: async () => Buffer.from('x'),
    extract: async (_buf, name) =>
      name.endsWith('.docx')
        ? { status: 'ok', content: '좋은 서류 본문', truncated: false }
        : { status: 'failed', reason: 'boom' },
  }
  const r1 = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
  assert.equal(r1.processed, 2)
  assert.equal(r1.extracted, 1)
  assert.equal(r1.failed, 1)
  assert.equal((await Q.docTexts.getBoardDocumentTextRecord(good)).status, 'ok')
  let rec = await Q.docTexts.getBoardDocumentTextRecord(bad)
  assert.equal(rec.status, 'failed')
  assert.equal(rec.attempts, 1)
  assert.equal(rec.ext, 'hwp')

  assert.equal((await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })).processed, 0)

  for (const expected of [2, 3]) {
    await setupClient.execute({
      sql: 'update work_board_document_texts set extracted_at = ? where document_id = ?',
      args: [Date.now() - 2 * 3600 * 1000, bad],
    })
    assert.equal((await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })).processed, 1)
    rec = await Q.docTexts.getBoardDocumentTextRecord(bad)
    assert.equal(rec.attempts, expected)
  }
  await setupClient.execute({
    sql: 'update work_board_document_texts set extracted_at = ? where document_id = ?',
    args: [Date.now() - 2 * 3600 * 1000, bad],
  })
  const capped = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
  assert.equal(capped.processed, 0, '3회 실패한 서류는 더 시도하지 않는다')
  assert.equal((await Q.docTexts.getBoardDocumentTextRecord(bad)).attempts, 3)
})

test('안전하지 않은 서류 경로는 내려받지 않고 failed 로 남긴다', async () => {
  const me = await seedPerson()
  await drainPending()
  const unsafe = await seedDocument(me, { fileName: '위장.pdf', path: 'backups/ggac-dump.pdf' })
  const asked = []
  const r = await Q.store.runExtractionBatch({
    budgetMs: 60_000,
    deps: {
      download: async path => {
        asked.push(path)
        return Buffer.from('x')
      },
      extract: async () => ({ status: 'ok', content: '새면 안 된다', truncated: false }),
    },
  })
  assert.equal(r.processed, 1)
  assert.equal(r.failed, 1)
  assert.deepEqual(asked, [], '저장소를 부르지 않는다')
  const rec = await Q.docTexts.getBoardDocumentTextRecord(unsafe)
  assert.equal(rec.status, 'failed')
  assert.equal(rec.contentLength, 0)
})

test('업로드 직후(extractBoardDocumentsByIds): 끝난 것·큰 것·대상 형식이 아닌 것은 건너뛴다', async () => {
  const me = await seedPerson()
  const fresh = await seedDocument(me, { fileName: '방금.docx' })
  const done = await seedDocument(me, { fileName: '끝난.pdf' })
  await putDocText(done, '이미 있다')
  const image = await seedDocument(me, { fileName: '도장.jpg' })
  const r = await Q.store.extractBoardDocumentsByIds([fresh, done, image], {
    deps: okDeps('바로 추출된 서류 본문'),
  })
  assert.equal(r.processed, 1)
  assert.equal(r.extracted, 1)
  assert.equal((await Q.docTexts.getBoardDocumentTextRecord(fresh)).status, 'ok')
  assert.equal(await Q.docTexts.getBoardDocumentTextRecord(image), null)
  const big = await seedDocument(me, { fileName: '큰.pdf' })
  const skipped = await Q.store.extractBoardDocumentsByIds([big], {
    deps: okDeps('x'),
    maxBytes: 10,
  })
  assert.equal(skipped.processed, 0, '큰 파일은 크론이 맡는다')
})

test('결과 쓰기: 허용되지 않은 상태·ok 아닌 본문·없는 서류는 거절하고, 서류를 지우면 결과도 지워진다', async () => {
  const me = await seedPerson()
  const id = await seedDocument(me, { fileName: '지울.pdf' })
  await assert.rejects(() => putDocText(id, 'x', 'weird'), /알 수 없는 추출 상태/)
  await assert.rejects(
    () =>
      Q.docTexts.upsertBoardDocumentText({
        documentId: id,
        ext: 'pdf',
        content: '본문',
        truncated: false,
        status: 'failed',
        extractorVersion: 't',
        attempts: 1,
      }),
    /본문을 두지 않습니다/
  )
  await assert.rejects(() => putDocText(crypto.randomUUID(), 'x'), /서류가 없습니다/)
  await putDocText(id, '지워질 본문')
  assert.equal((await Q.docTexts.getBoardDocumentTextRecord(id)).status, 'ok')
  await Q.board.deleteDocument(id)
  assert.equal(await Q.docTexts.getBoardDocumentTextRecord(id), null, 'ON DELETE CASCADE')
})

// ── 검색 ─────────────────────────────────────────────────────────────────────

test('검색: 파일 속 글자도 AND 일치에 들고 첫 일치 주변 창을 준다 — 등급 밖·ok 아닌 결과는 찾지 않는다', async () => {
  const me = await seedPerson()
  const tag = `파일속표식${Date.now()}`
  const filler = '가'.repeat(800)
  const boardDoc = await seedDocument(me, {
    fileName: 'minutes.pdf',
    title: '2026 정기 이사회 결과',
    visibility: 'board',
  })
  await putDocText(boardDoc, `${filler} 임대료 인상안 ${tag} 의결 ${filler}`)
  const membersDoc = await seedDocument(me, {
    fileName: 'notice.pdf',
    title: `${tag} 공지`,
    visibility: 'members',
  })
  const failedDoc = await seedDocument(me, { fileName: 'scan.pdf', title: '스캔본' })
  await putDocText(failedDoc, '', 'failed')

  const all = ['board', 'members']
  const find = (terms, visibility = all) =>
    Q.board.searchDocuments({ terms, visibility, limit: 50 })

  const hits = await find([tag])
  assert.deepEqual(hits.map(h => h.id).sort(), [boardDoc, membersDoc].sort())
  const hit = hits.find(h => h.id === boardDoc)
  assert.equal(hit.content_matched, true)
  assert.equal(hit.body_matched, true)
  assert.equal(hit.match_window.source, 'file')
  assert.equal(hit.match_window.window_at_start, false)
  assert.equal(hit.match_window.window_has_more, true)
  assert.ok(hit.match_window.window.includes(tag))
  assert.ok(hit.match_window.window.length <= 600)
  const snippet = Q.snippet.documentSnippet(hit.match_window, [tag])
  assert.ok(snippet.includes(tag) && snippet.startsWith('…') && snippet.endsWith('…'), snippet)
  // 제목만 맞은 서류에는 창이 없다
  const titleOnly = hits.find(h => h.id === membersDoc)
  assert.equal(titleOnly.content_matched, false)
  assert.equal(titleOnly.match_window, null)

  // AND — 제목의 낱말과 파일 속 낱말이 나뉘어 있어도 맞는다, 없는 낱말이 끼면 빠진다
  assert.deepEqual(
    (await find(['정기 이사회', '임대료'])).map(h => h.id),
    [boardDoc]
  )
  assert.deepEqual(await find([tag, '없는낱말xyz']), [])
  // 대소문자·와일드카드
  assert.deepEqual(await find([`${tag}%`]), [])
  // 등급 밖이면 파일 속 글자가 맞아도 없다
  assert.deepEqual(
    (await find([tag], ['members'])).map(h => h.id),
    [membersDoc]
  )
  // ok 가 아닌 결과는 찾지 않는다(빈 본문이지만 상태로도 막는다)
  await setupClient.execute({
    sql: "update work_board_document_texts set content = ? where document_id = ? and status = 'failed'",
    args: [`몰래 ${tag}`, failedDoc],
  })
  assert.ok(!(await find([tag])).some(h => h.id === failedDoc))
})

test('검색: 웹 본문(body_markdown)만 맞으면 그쪽 창을 준다', async () => {
  const me = await seedPerson()
  const tag = `웹본문표식${Date.now()}`
  const { id } = await Q.board.createDocument({
    title: '정관',
    category: '정관',
    filePath: `${me}/charter.pdf`,
    fileName: 'charter.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
    uploadedBy: me,
    visibility: 'members',
    bodyMarkdown: `제1조 ${tag} 조합의 이름`,
  })
  const [hit] = await Q.board.searchDocuments({ terms: [tag], visibility: ['members'], limit: 5 })
  assert.equal(hit.id, id)
  assert.equal(hit.content_matched, false)
  assert.equal(hit.match_window.source, 'body')
  assert.equal(hit.match_window.window_at_start, true)
  assert.equal(hit.match_window.window_has_more, false)
  assert.equal(Q.snippet.documentSnippet(hit.match_window, [tag]), `제1조 ${tag} 조합의 이름`)
})

// ── 실제 추출기 ───────────────────────────────────────────────────────────────

test('픽스처 DOCX 서류: 실제 추출기로 본문을 저장하고 검색이 스니펫과 함께 찾는다', async () => {
  const me = await seedPerson()
  await drainPending()
  const phrase = `이사회 서류 본문 추출 시험 ${Date.now()}`
  const zip = await JSZip.loadAsync(
    readFileSync(new URL('./fixtures/board-work/blank.docx', import.meta.url))
  )
  const xml = await zip.file('word/document.xml').async('string')
  zip.file(
    'word/document.xml',
    xml.replace('<w:body>', `<w:body><w:p><w:r><w:t>${phrase}</w:t></w:r></w:p>`)
  )
  const docx = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const id = await seedDocument(me, { fileName: '정관 개정안.docx' })
  const downloaded = []
  const r = await Q.store.runExtractionBatch({
    budgetMs: 60_000,
    deps: {
      download: async path => {
        downloaded.push(path)
        return docx
      },
    },
  })
  assert.equal(r.extracted, 1, JSON.stringify(r))
  assert.equal(downloaded.length, 1)
  const rec = await Q.docTexts.getBoardDocumentTextRecord(id)
  assert.equal(rec.status, 'ok')
  assert.equal(rec.ext, 'docx')
  const [hit] = await Q.board.searchDocuments({
    terms: ['본문 추출 시험'],
    visibility: ['board'],
    limit: 5,
  })
  assert.equal(hit.id, id)
  assert.match(Q.snippet.documentSnippet(hit.match_window, ['본문 추출 시험']), new RegExp(phrase))
})

test('마이그레이션 0034 가 만든 표·색인·FK 가 스키마 선언과 같다', async () => {
  const idx = await setupClient.execute(
    "select name from sqlite_master where type = 'index' and tbl_name = 'work_board_document_texts' and name not like 'sqlite_%' order by name"
  )
  assert.deepEqual(
    idx.rows.map(r => r.name),
    ['work_board_document_texts_failed_idx']
  )
  const cols = await setupClient.execute(
    "select name from pragma_table_info('work_board_document_texts')"
  )
  assert.deepEqual(
    cols.rows.map(r => r.name),
    [
      'document_id',
      'ext',
      'content',
      'truncated',
      'status',
      'extractor_version',
      'attempts',
      'extracted_at',
    ]
  )
  const fk = await setupClient.execute(
    'select "table", "from", "to", on_delete from pragma_foreign_key_list(\'work_board_document_texts\')'
  )
  assert.deepEqual(
    fk.rows.map(r => [r.table, r.from, r.to, r.on_delete]),
    [['board_documents', 'document_id', 'id', 'CASCADE']]
  )
})
