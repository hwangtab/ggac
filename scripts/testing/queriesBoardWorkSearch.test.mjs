import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 4단계 — 본문 추출 저장과 통합 검색(설계 §8-2·§8-3)을 실제 SQLite 파일 DB로 검증한다.
 *
 * 원본 kosmart-work는 security invoker RPC + RLS(can_read_channel·attachment_is_live)가 검색 결과를 걸렀다. 여기서는
 * 읽기 범위를 WHERE에 넣는 쿼리 계층(`src/db/queries/work/search.ts`)과 그 위의 `searchAll`(`src/work/lib/search/
 * search.ts`)이 그 일을 한다 — 이 파일이 "읽을 수 없는 채널의 본문이 결과·스니펫에 나오지 않는다"의 쿼리 쪽 안전망이다.
 * 추출 상태 전이(선점·재시도 상한·재시도 간격)는 `extract-store.ts`를 저장소·kordoc 없이(deps 주입) 돌려 본다.
 */

const DB_PATH = 'scripts/testing/.queries-board-work-search-test.db'
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
    shared: await import(src('db/queries/work/_shared.ts')),
    channels: await import(src('db/queries/work/channels.ts')),
    messages: await import(src('db/queries/work/messages.ts')),
    files: await import(src('db/queries/work/files.ts')),
    versions: await import(src('db/queries/work/versions.ts')),
    tabs: await import(src('db/queries/work/tabs.ts')),
    notes: await import(src('db/queries/work/notes.ts')),
    texts: await import(src('db/queries/work/texts.ts')),
    search: await import(src('db/queries/work/search.ts')),
    searchLib: await import(src('work/lib/search/search.ts')),
    store: await import(src('work/lib/files/extract-store.ts')),
    health: await import(src('work/lib/files/extract-health.ts')),
    paths: await import(src('work/lib/files/paths.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedPerson(flags = { is_director: true }, name) {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bws-${++counter}@test.local`,
    display_name: name ?? `검색이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    ...flags,
  })
  return id
}

async function seedChannel({ kind = 'public', creatorId }) {
  const id = crypto.randomUUID()
  const label = `검색-${id.slice(0, 8)}`
  const outcome = await Q.channels.createChannelRow({
    id,
    kind,
    name: label,
    slug: label.toLowerCase(),
    topic: null,
    categoryId: null,
    creatorId,
  })
  assert.equal(outcome.status, 'created')
  return id
}

async function seedDm(a, b) {
  const key = [a, b]
    .map(v => v.toLowerCase())
    .sort()
    .join(':')
  return (await Q.channels.openDmRow({ key, creatorId: a, memberIds: [a, b] })).id
}

async function seedMessage(channelId, authorId, body) {
  const id = crypto.randomUUID()
  const r = await Q.messages.insertMessage({
    id,
    channelId,
    authorId,
    body,
    canPostRestricted: true,
  })
  assert.equal(r.status, 'created')
  return id
}

/** 메시지 + 첨부(승격) 하나 */
async function seedFile(channelId, uploaderId, name, body = '첨부') {
  const messageId = await seedMessage(channelId, uploaderId, body)
  const uploadId = crypto.randomUUID()
  const ok = await Q.files.insertPendingUploads(
    [
      {
        id: uploadId,
        channelId,
        uploaderId,
        blobPath: Q.paths.buildUploadPath(uploadId, name),
        name,
        mime: 'application/octet-stream',
        size: 1234,
      },
    ],
    { maxPerUser: 100 }
  )
  assert.equal(ok, true)
  const a = await Q.files.promotePendingUpload({
    uploadId,
    messageId,
    actorId: uploaderId,
    size: 1234,
  })
  return { attachmentId: a.id, messageId }
}

/** 본문 추출 결과를 바로 넣는다(추출기 없이 검색만 볼 때) */
async function putText(attachmentId, content, status = 'ok') {
  await Q.texts.upsertAttachmentText({
    attachmentId,
    ext: 'hwp',
    content: status === 'ok' ? content : '',
    truncated: false,
    status,
    extractorVersion: 'test',
    attempts: 1,
  })
}

async function seedNote(channelId, authorId, title, body) {
  const tab = await Q.tabs.insertTabRow({
    channelId,
    kind: 'note',
    title: title ?? '메모',
    config: {},
    createdBy: authorId,
    canWriteArchived: false,
  })
  const noteId = String(tab.config.noteId)
  const saved = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    title,
    body,
    actorId: authorId,
    canWriteArchived: false,
  })
  assert.equal(saved?.status, 'saved')
  return { noteId, tabId: tab.id }
}

const viewer = (userId, role = 'member') => ({
  user: { id: userId },
  staff: { user_id: userId, display_name: 'x', title: null, role, status: 'active' },
})

const searchAs = (who, q, extra = {}) =>
  Q.searchLib.searchAll(who, { q, channel: null, author: null, from: null, to: null, ...extra })

/** 결과 전체(링크·스니펫 포함)를 한 문자열로 — "어디에도 새지 않는다"를 단정할 때 */
const dump = r => JSON.stringify(r)

async function row(sql, args) {
  const rs = await setupClient.execute({ sql, args })
  return rs.rows[0]
}

// ── 일치 규칙 ─────────────────────────────────────────────────────────────────

test('검색어는 전부 AND 로 맞아야 하고, 두 글자 한국어("정관")도 잡힌다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const tag = `t${counter}`
  const both = await seedMessage(ch, me, `${tag} 정관 개정안 초안을 올립니다`)
  const onlyOne = await seedMessage(ch, me, `${tag} 정관만 있는 글`)
  await seedMessage(ch, me, `${tag} 관계없는 글`)
  const readable = new Set([ch])

  const two = await Q.search.searchMessageRows({ readable, terms: [tag, '정관'] })
  assert.deepEqual(two.map(r => r.id).sort(), [both, onlyOne].sort())

  const three = await Q.search.searchMessageRows({ readable, terms: [tag, '정관', '개정'] })
  assert.deepEqual(
    three.map(r => r.id),
    [both]
  )

  // 대소문자 무시(ASCII) · LIKE 메타문자(%·_)는 글자 그대로
  const latin = await seedMessage(ch, me, `${tag} Budget_2026 100% 확정`)
  assert.deepEqual(
    (await Q.search.searchMessageRows({ readable, terms: ['BUDGET_2026', '100%'] })).map(r => r.id),
    [latin]
  )
  assert.deepEqual(await Q.search.searchMessageRows({ readable, terms: ['budget%2026'] }), [])

  // searchAll 도 같은 규칙 + 하이라이트용 검색어를 돌려준다
  const r = await searchAs(viewer(me), `${tag} 정관`)
  assert.deepEqual(r.terms, [tag, '정관'])
  assert.deepEqual(r.messages.map(m => m.id).sort(), [both, onlyOne].sort())
  assert.equal(r.mode, 'ilike')
})

test('지워진 메시지는 본문·첨부 파일명·첨부 본문 어디서도 나오지 않는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const word = `삭제확인${counter}`
  const { attachmentId, messageId } = await seedFile(ch, me, `${word}.hwp`, `${word} 메시지`)
  await putText(attachmentId, `본문에도 ${word} 가 있다`)

  const before = await searchAs(viewer(me), word)
  assert.equal(before.messages.length, 1)
  assert.equal(before.files.length, 1)

  const del = await Q.messages.softDeleteMessage({ messageId, actorId: me, actorIsAdmin: false })
  assert.ok(del)
  const afterDel = await searchAs(viewer(me), word)
  assert.equal(afterDel.messages.length, 0)
  assert.equal(afterDel.files.length, 0)
  assert.equal(afterDel.documents.length, 0)
  assert.doesNotMatch(dump({ ...afterDel, terms: [] }), new RegExp(word))
})

// ── 읽기 범위 ─────────────────────────────────────────────────────────────────

test('이사는 초대받지 않은 비공개 채널의 메시지·파일·문서 본문·메모를 찾지 못하고, 멤버인 감사는 찾는다', async () => {
  const director = await seedPerson({ is_director: true })
  const auditor = await seedPerson({ is_auditor: true })
  const priv = await seedChannel({ kind: 'private', creatorId: auditor })
  const pub = await seedChannel({ kind: 'public', creatorId: auditor })
  const secret = `비밀감사${counter}`

  const msg = await seedMessage(priv, auditor, `${secret} 메시지 본문`)
  const { attachmentId: nameFile } = await seedFile(priv, auditor, `${secret} 보고.pdf`)
  const { attachmentId: docFile } = await seedFile(priv, auditor, '첨부.hwp')
  await putText(docFile, `앞부분 ${secret} 문서 본문 뒷부분`)
  await seedNote(priv, auditor, null, `${secret} 메모 본문`)
  // 공개 채널 글은 둘 다 찾는다(허용 쪽 대조군)
  const pubMsg = await seedMessage(pub, auditor, `${secret} 공개 채널 글`)

  const d = await searchAs(viewer(director), secret)
  assert.deepEqual(
    d.messages.map(m => m.id),
    [pubMsg]
  )
  assert.equal(d.files.length, 0)
  assert.equal(d.documents.length, 0)
  assert.equal(d.notes.length, 0)
  assert.ok(!dump(d).includes(priv), '비공개 채널 id 가 결과 어디에도 없어야 한다')
  assert.ok(!dump(d).includes('메시지 본문') && !dump(d).includes('문서 본문'))

  const a = await searchAs(viewer(auditor), secret)
  assert.deepEqual(a.messages.map(m => m.id).sort(), [msg, pubMsg].sort())
  assert.deepEqual(
    a.files.map(f => f.id),
    [nameFile]
  )
  assert.deepEqual(
    a.documents.map(x => x.id),
    [docFile]
  )
  assert.match(a.documents[0].snippet, new RegExp(secret))
  assert.equal(a.notes.length, 1)

  // 관리자(멤버 아님)는 비공개 채널을 읽는다(원본 0037)
  const admin = await seedPerson({ is_admin: true })
  const ad = await searchAs(viewer(admin, 'admin'), secret)
  assert.equal(ad.documents.length, 1)
  assert.equal(ad.notes.length, 1)
})

test('관리자도 자기가 없는 DM 의 메시지·문서 본문·메모는 찾지 못한다(원본 0037) — DM 당사자는 찾는다', async () => {
  const a = await seedPerson()
  const b = await seedPerson()
  const admin = await seedPerson({ is_admin: true })
  const dm = await seedDm(a, b)
  const secret = `디엠비밀${counter}`
  const msg = await seedMessage(dm, a, `${secret} 둘만의 이야기`)
  const { attachmentId } = await seedFile(dm, b, '개인.docx')
  await putText(attachmentId, `${secret} 개인 문서`)
  await seedNote(dm, a, `${secret} 메모 제목`, '본문')

  const ad = await searchAs(viewer(admin, 'admin'), secret)
  assert.equal(ad.messages.length + ad.files.length + ad.documents.length + ad.notes.length, 0)
  assert.ok(!dump(ad).includes(dm))

  const mine = await searchAs(viewer(a), secret)
  assert.deepEqual(
    mine.messages.map(m => m.id),
    [msg]
  )
  assert.equal(mine.documents.length, 1)
  assert.equal(mine.notes.length, 1, '제목으로도 메모를 찾는다')
  assert.match(mine.notes[0].href, new RegExp(`/dm/${dm}/t/`))
})

test('쿼리 계층: 읽기 범위가 비면 아무것도 돌려주지 않는다(빈 IN 대신 거짓 조건)', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const word = `빈범위${counter}`
  const { attachmentId } = await seedFile(ch, me, `${word}.txt`, word)
  await putText(attachmentId, word)
  const empty = new Set()
  assert.deepEqual(await Q.search.searchMessageRows({ readable: empty, terms: [word] }), [])
  assert.deepEqual(await Q.search.searchFileNameRows({ readable: empty, terms: [word] }), [])
  assert.deepEqual(await Q.search.searchDocumentRows({ readable: empty, terms: [word] }), [])
  assert.deepEqual(await Q.search.searchNoteRows({ readable: empty, terms: [word] }), [])
  assert.deepEqual(
    await Q.search.searchMessageRows({ readable: empty, terms: [], authorId: me }),
    []
  )
})

test('작성자 둘러보기(검색어 없음)도 읽기 범위 안에서만', async () => {
  const director = await seedPerson()
  const auditor = await seedPerson({ is_auditor: true })
  const priv = await seedChannel({ kind: 'private', creatorId: auditor })
  const pub = await seedChannel({ kind: 'public', creatorId: auditor })
  await seedMessage(priv, auditor, '비공개에서 쓴 글')
  const pubMsg = await seedMessage(pub, auditor, '공개에서 쓴 글')
  const r = await searchAs(viewer(director), '', { author: auditor })
  assert.equal(r.mode, 'browse')
  assert.deepEqual(
    r.messages.map(m => m.id),
    [pubMsg]
  )
})

// ── 문서 본문: 스니펫·계보 ────────────────────────────────────────────────────

test('문서 스니펫: 첫 일치 주변만 잘라 평문으로 주고, 상태가 ok 가 아닌 결과는 찾지 않는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const word = `스니펫${counter}`
  const { attachmentId } = await seedFile(ch, me, '긴문서.hwp')
  const long = `${'가'.repeat(5000)} ${word} 이 문장이 보여야 한다 ${'나'.repeat(5000)}`
  await putText(attachmentId, long)
  const r = await searchAs(viewer(me), word)
  assert.equal(r.documents.length, 1)
  const snip = r.documents[0].snippet
  assert.match(snip, new RegExp(`${word} 이 문장이 보여야 한다`))
  assert.ok(snip.length <= 210, `스니펫이 너무 길다: ${snip.length}`)
  assert.ok(snip.startsWith('…') && snip.endsWith('…'), snip)
  assert.match(r.documents[0].href, /#msg-/)

  const { attachmentId: failed } = await seedFile(ch, me, '실패.hwp')
  await putText(failed, '', 'failed')
  const { attachmentId: unsupported } = await seedFile(ch, me, '스캔.pdf')
  await putText(unsupported, '', 'unsupported')
  const rows = await Q.search.searchDocumentRows({ readable: new Set([ch]), terms: [''] })
  assert.deepEqual(rows, [], '빈 검색어는 찾지 않는다')
})

test('파일명·본문이 둘 다 맞으면 파일 목록에 스니펫을 붙이고, 같은 문서의 버전은 한 건으로 묶는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const word = `계보${counter}`
  // v1 — 본문에 word
  const up1 = crypto.randomUUID()
  await Q.files.insertPendingUploads(
    [
      {
        id: up1,
        channelId: ch,
        uploaderId: me,
        blobPath: Q.paths.buildUploadPath(up1, 'a.hwp'),
        name: '정관안.hwp',
        mime: 'application/x-hwp',
        size: 10,
      },
    ],
    { maxPerUser: 100 }
  )
  const v1 = await Q.versions.commitFileMessage({
    actorId: me,
    message: {
      id: crypto.randomUUID(),
      channelId: ch,
      parentId: null,
      canPostRestricted: true,
      body: () => '파일',
    },
    source: { kind: 'pending', uploadId: up1, allowDraft: false, size: 10 },
  })
  assert.equal(v1.status, 'created')
  const up2 = crypto.randomUUID()
  await Q.files.insertPendingUploads(
    [
      {
        id: up2,
        channelId: ch,
        uploaderId: me,
        blobPath: Q.paths.buildUploadPath(up2, 'b.hwp'),
        name: '정관안.hwp',
        mime: 'application/x-hwp',
        size: 10,
      },
    ],
    { maxPerUser: 100 }
  )
  const v2 = await Q.versions.commitFileMessage({
    actorId: me,
    message: {
      id: crypto.randomUUID(),
      channelId: ch,
      parentId: null,
      canPostRestricted: true,
      body: no => `v${no}`,
    },
    source: { kind: 'pending', uploadId: up2, allowDraft: false, size: 10 },
    previousAttachmentId: v1.attachment.id,
  })
  assert.equal(v2.status, 'created')

  // 옛 버전만 본문이 맞는다 → 한 건, "이전 버전 v1"
  await putText(v1.attachment.id, `옛 버전 ${word}`)
  await putText(v2.attachment.id, '새 버전은 다른 내용')
  let r = await searchAs(viewer(me), word)
  assert.equal(r.documents.length, 1)
  assert.equal(r.documents[0].id, v1.attachment.id)
  assert.equal(r.documents[0].oldVersionNo, 1)

  // 둘 다 맞으면 최신(v2) 한 건만
  await putText(v2.attachment.id, `새 버전 ${word}`)
  r = await searchAs(viewer(me), word)
  assert.deepEqual(
    r.documents.map(d => d.id),
    [v2.attachment.id]
  )
  assert.equal(r.documents[0].oldVersionNo, undefined)

  // 파일명 + 본문이 함께 맞으면 파일 결과에 스니펫이 붙고 문서 구역에는 없다
  const named = `이름${word}`
  const { attachmentId: both } = await seedFile(ch, me, `${named}.hwp`)
  await putText(both, `본문에도 ${named} 이 있다`)
  r = await searchAs(viewer(me), named)
  assert.deepEqual(
    r.files.map(f => f.id),
    [both]
  )
  assert.match(r.files[0].snippet ?? '', new RegExp(named))
  assert.equal(r.documents.length, 0)
})

test('사람 검색은 이름에 검색어가 모두 든 활성 구성원만', async () => {
  const me = await seedPerson()
  const name = `홍길동${counter}`
  const target = await seedPerson({ is_director: true }, name)
  // 이사가 아닌 일반 조합원은 업무툴 사람이 아니다
  await seedPerson({ is_director: false }, `${name}조합원`)
  const r = await searchAs(viewer(me), name)
  assert.deepEqual(
    r.people.map(p => p.userId),
    [target]
  )
})

// ── 추출 결과 저장·상태 전이 ──────────────────────────────────────────────────

test('결과 쓰기: 허용되지 않은 상태·상한을 넘는 본문·ok 아닌 본문은 거절하고, 채널은 첨부의 채널로 적는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const { attachmentId } = await seedFile(ch, me, '문서.hwp')
  const base = {
    attachmentId,
    ext: 'hwp',
    content: '',
    truncated: false,
    extractorVersion: 'v',
    attempts: 1,
  }
  const isInvalid = e => Q.shared.isWorkWriteError(e, 'invalid')
  await assert.rejects(Q.texts.upsertAttachmentText({ ...base, status: 'weird' }), isInvalid)
  await assert.rejects(
    Q.texts.upsertAttachmentText({ ...base, status: 'ok', content: 'x'.repeat(2_000_001) }),
    isInvalid
  )
  await assert.rejects(
    Q.texts.upsertAttachmentText({ ...base, status: 'failed', content: '본문' }),
    isInvalid
  )
  await Q.texts.upsertAttachmentText({ ...base, status: 'ok', content: '본문' })
  const rec = await Q.texts.getAttachmentTextRecord(attachmentId)
  assert.equal(rec.channelId, ch)
  assert.equal(rec.status, 'ok')
  assert.equal(rec.contentLength, 2)

  // 첨부가 지워지면 결과도 지워진다(cascade)
  await setupClient.execute({
    sql: 'delete from work_attachments where id = ?',
    args: [attachmentId],
  })
  assert.equal(await Q.texts.getAttachmentTextRecord(attachmentId), null)
})

/** 이 테스트 묶음만의 첨부로 범위를 좁혀 배치를 돌린다(다른 테스트의 첨부가 대기열에 섞이지 않게 모두 처리해 둔다) */
async function drainPending() {
  for (const t of await Q.store.fetchPending(20_000, Date.now() + 365 * 24 * 3600 * 1000)) {
    await Q.texts.upsertAttachmentText({
      attachmentId: t.id,
      ext: 'x',
      content: '',
      truncated: false,
      status: 'unsupported',
      extractorVersion: 'drain',
      attempts: 9,
    })
  }
}

const okDeps = text => ({
  download: async () => Buffer.from('ignored'),
  extract: async () => ({ status: 'ok', content: text, truncated: false }),
})

test('추출 상태 전이: 대상 → ok, 실패는 선점 행이 남고 1시간 뒤에만 3회까지 다시 집는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  await drainPending()
  const { attachmentId: good } = await seedFile(ch, me, '좋은.docx')
  const { attachmentId: bad } = await seedFile(ch, me, '나쁜.hwp')
  const { attachmentId: image } = await seedFile(ch, me, '사진.png')

  const pending = await Q.store.fetchPending(50)
  const ids = pending.map(t => t.id)
  assert.ok(ids.includes(good) && ids.includes(bad))
  assert.ok(!ids.includes(image), '추출 대상 확장자가 아니면 대기열에 없다')

  const deps = {
    download: async () => Buffer.from('x'),
    extract: async (_buf, name) =>
      name.endsWith('.docx')
        ? { status: 'ok', content: '좋은 문서 본문', truncated: false }
        : { status: 'failed', reason: 'boom' },
  }
  const r1 = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
  assert.equal(r1.processed, 2)
  assert.equal(r1.extracted, 1)
  assert.equal(r1.failed, 1)
  assert.equal((await Q.texts.getAttachmentTextRecord(good)).status, 'ok')
  let badRec = await Q.texts.getAttachmentTextRecord(bad)
  assert.equal(badRec.status, 'failed')
  assert.equal(badRec.attempts, 1)
  assert.equal(badRec.ext, 'hwp')

  // 실제 시계는 지금이라 1시간이 지나지 않았다 — 바로 다시 돌리면 아무것도 하지 않는다
  const again = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
  assert.equal(again.processed, 0)

  // 재시도 간격이 지난 뒤(extracted_at 을 과거로) 3회까지만 다시 집는다
  for (const expected of [2, 3]) {
    await setupClient.execute({
      sql: 'update work_attachment_texts set extracted_at = ? where attachment_id = ?',
      args: [Date.now() - 2 * 3600 * 1000, bad],
    })
    const r = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
    assert.equal(r.processed, 1)
    badRec = await Q.texts.getAttachmentTextRecord(bad)
    assert.equal(badRec.attempts, expected)
  }
  await setupClient.execute({
    sql: 'update work_attachment_texts set extracted_at = ? where attachment_id = ?',
    args: [Date.now() - 2 * 3600 * 1000, bad],
  })
  const capped = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps })
  assert.equal(capped.processed, 0, '3회 실패한 첨부는 더 시도하지 않는다')
  assert.equal((await Q.texts.getAttachmentTextRecord(bad)).attempts, 3)

  // 본문 검색에 ok 결과가 걸린다
  const r = await searchAs(viewer(me), '좋은 문서')
  assert.deepEqual(
    r.documents.map(d => d.id),
    [good]
  )
})

test('선점: 재시도 선점은 failed 행만 바꾼다(그 사이 ok 가 된 행을 failed 로 되돌리지 않는다)', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const { attachmentId } = await seedFile(ch, me, '경합.hwp')
  await putText(attachmentId, '다른 실행이 먼저 끝냈다')
  await Q.texts.claimAttachmentText({
    attachmentId,
    ext: 'hwp',
    extractorVersion: 'v',
    attempts: 2,
  })
  assert.equal((await Q.texts.getAttachmentTextRecord(attachmentId)).status, 'ok')
  // 처음 선점(attempts 1)도 이미 있는 행은 건드리지 않는다
  await Q.texts.claimAttachmentText({
    attachmentId,
    ext: 'hwp',
    extractorVersion: 'v',
    attempts: 1,
  })
  assert.equal((await Q.texts.getAttachmentTextRecord(attachmentId)).status, 'ok')
})

test('저장이 실패해도 선점한 failed 행이 남아 독 항목이 무한 재시도되지 않는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  await drainPending()
  const { attachmentId } = await seedFile(ch, me, '거대.txt')
  // 상한을 넘는 본문 → 최종 저장 거절 → 본문 없는 failed 로 남는다
  const r = await Q.store.runExtractionBatch({
    budgetMs: 60_000,
    deps: {
      download: async () => Buffer.from('x'),
      extract: async () => ({ status: 'ok', content: 'x'.repeat(2_000_001), truncated: false }),
    },
  })
  assert.equal(r.processed, 1)
  assert.equal(r.failed, 1)
  const rec = await Q.texts.getAttachmentTextRecord(attachmentId)
  assert.equal(rec.status, 'failed')
  assert.equal(rec.contentLength, 0)
  assert.equal(rec.attempts, 1)
})

test('업로드 직후(extractByIds): 이미 결과가 있거나 크거나 대상 형식이 아니면 건너뛰고, 지워진 메시지의 첨부도 뺀다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const { attachmentId: a } = await seedFile(ch, me, '새문서.hwpx')
  const { attachmentId: done } = await seedFile(ch, me, '끝난.hwpx')
  await putText(done, '이미 있다')
  const { attachmentId: img } = await seedFile(ch, me, '그림.jpg')
  const { attachmentId: gone, messageId } = await seedFile(ch, me, '지운.docx')
  await Q.messages.softDeleteMessage({ messageId, actorId: me, actorIsAdmin: false })

  const r = await Q.store.extractByIds([a, done, img, gone], { deps: okDeps('바로 추출된 본문') })
  assert.equal(r.processed, 1)
  assert.equal(r.extracted, 1)
  assert.equal((await Q.texts.getAttachmentTextRecord(a)).status, 'ok')
  assert.equal(await Q.texts.getAttachmentTextRecord(img), null)
  assert.equal(await Q.texts.getAttachmentTextRecord(gone), null)

  const small = await Q.store.extractByIds([a], { deps: okDeps('x'), maxBytes: 10 })
  assert.equal(small.processed, 0, '이미 처리됐다')
})

test('큰 파일은 한 번에 두 개까지만 — 나머지는 다음 실행으로 미룬다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  await drainPending()
  const big = []
  for (let i = 0; i < 3; i++) big.push((await seedFile(ch, me, `큰${i}.pdf`)).attachmentId)
  const big20 = 20 * 1024 * 1024
  await setupClient.execute({
    sql: `update work_attachments set size = ? where id in (${big.map(() => '?').join(',')})`,
    args: [big20, ...big],
  })
  const r = await Q.store.runExtractionBatch({ budgetMs: 60_000, deps: okDeps('큰 파일 본문') })
  assert.equal(r.processed, 2)
  assert.equal(r.deferredLarge, 1)
})

test('실행 건강: 5건 이상 처리하고 80% 이상 실패하면 실행 전체를 실패로 본다', () => {
  assert.equal(Q.health.extractBatchFailed({ processed: 4, failed: 4 }), false)
  assert.equal(Q.health.extractBatchFailed({ processed: 5, failed: 4 }), true)
  assert.equal(Q.health.extractBatchFailed({ processed: 10, failed: 7 }), false)
  assert.equal(Q.health.extractBatchFailed({ processed: 10, failed: 8 }), true)
})

test('마이그레이션 0031 이 만든 표·색인이 스키마 선언과 같다', async () => {
  const idx = await setupClient.execute(
    "select name from sqlite_master where type = 'index' and tbl_name = 'work_attachment_texts' and name not like 'sqlite_%' order by name"
  )
  assert.deepEqual(
    idx.rows.map(r => r.name),
    ['work_attachment_texts_channel_idx', 'work_attachment_texts_failed_idx']
  )
  const cols = await setupClient.execute(
    "select name from pragma_table_info('work_attachment_texts')"
  )
  assert.deepEqual(
    cols.rows.map(r => r.name),
    [
      'attachment_id',
      'channel_id',
      'ext',
      'content',
      'truncated',
      'status',
      'extractor_version',
      'attempts',
      'extracted_at',
    ]
  )
  void row
})
