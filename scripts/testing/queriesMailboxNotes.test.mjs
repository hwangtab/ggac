import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 메일함 내부 메모(`src/db/queries/mailboxNotes.ts`) — 전용 임시 DB에서 검증한다(queriesMailbox.test.mjs와 같은 패턴).
 */

const DB_PATH = 'scripts/testing/.queries-mailbox-notes-test.db'
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
const notes = await import('../../src/db/queries/mailboxNotes.ts')
const mailbox = await import('../../src/db/queries/mailbox.ts')

async function member(name) {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email) values (?, ?, ?)`,
    args: [id, name, `${id}@notes.example`],
  })
  return id
}

async function mail() {
  return mailbox.insertInboundEmail({
    resend_email_id: `re_${crypto.randomUUID()}`,
    from_address: 'sender@example.com',
    to_addresses: ['contact@ggac.kr'],
    received_for: ['contact@ggac.kr'],
    subject: '문의',
    received_at: new Date(),
  })
}

test('메모는 쓴 순서대로 쓴 사람 이름과 함께 나온다', async () => {
  const email = await mail()
  const director = await member('이사표지')
  const auditor = await member('감사표지')
  await notes.insertNote({ email_id: email.id, author_id: director, body: '첫 메모' })
  await notes.insertNote({ email_id: email.id, author_id: auditor, body: '둘째 메모' })
  const list = await notes.listNotesForEmail(email.id)
  assert.deepEqual(
    list.map(n => [n.author_name, n.body]),
    [
      ['이사표지', '첫 메모'],
      ['감사표지', '둘째 메모'],
    ]
  )
  assert.match(list[0].created_at, /^\d{4}-\d{2}-\d{2}T/)
})

test('고치기는 쓴 사람의, 이 메일의 메모만 바뀐다', async () => {
  const email = await mail()
  const other = await mail()
  const author = await member('작성자')
  const someone = await member('다른 사람')
  const note = await notes.insertNote({ email_id: email.id, author_id: author, body: '원래' })

  assert.equal(
    await notes.updateOwnNote({ id: note.id, email_id: email.id, author_id: someone, body: 'x' }),
    null
  )
  assert.equal(
    await notes.updateOwnNote({ id: note.id, email_id: other.id, author_id: author, body: 'x' }),
    null,
    '경로의 메일과 메모가 어긋나면 바꾸지 않는다'
  )
  const updated = await notes.updateOwnNote({
    id: note.id,
    email_id: email.id,
    author_id: author,
    body: '고친 내용',
  })
  assert.equal(updated.body, '고친 내용')
})

test('지우기: 작성자를 주면 그 사람 것만, null(관리자)이면 누구 것이든 — 이 메일의 메모만', async () => {
  const email = await mail()
  const other = await mail()
  const author = await member('작성자2')
  const someone = await member('다른 사람2')
  const a = await notes.insertNote({ email_id: email.id, author_id: author, body: 'a' })
  const b = await notes.insertNote({ email_id: email.id, author_id: author, body: 'b' })

  assert.equal(await notes.deleteNote({ id: a.id, email_id: email.id, author_id: someone }), false)
  assert.equal(await notes.deleteNote({ id: a.id, email_id: other.id, author_id: null }), false)
  assert.equal(await notes.deleteNote({ id: a.id, email_id: email.id, author_id: author }), true)
  assert.equal(await notes.deleteNote({ id: b.id, email_id: email.id, author_id: null }), true)
  assert.deepEqual(await notes.listNotesForEmail(email.id), [])
})

test('쓴 사람의 프로필이 지워지면 메모는 남고 이름은 null이다', async () => {
  const email = await mail()
  const author = await member('떠날 사람')
  await notes.insertNote({ email_id: email.id, author_id: author, body: '남는 메모' })
  await setupClient.execute({ sql: 'PRAGMA foreign_keys = ON' })
  await setupClient.execute({ sql: 'delete from member_profiles where id = ?', args: [author] })
  const [note] = await notes.listNotesForEmail(email.id)
  assert.equal(note.body, '남는 메모')
  assert.equal(note.author_name, null)
})

test('목록은 메모 수만 센다', async () => {
  const email = await mail()
  const author = await member('세는 사람')
  await notes.insertNote({ email_id: email.id, author_id: author, body: '1' })
  await notes.insertNote({ email_id: email.id, author_id: author, body: '2' })
  const list = await mailbox.listInboundEmails({ limit: 100, offset: 0 })
  const row = list.emails.find(e => e.id === email.id)
  assert.equal(row.note_count, 2)
  assert.equal('body' in row, false)
})

// 보조 그물 — 발송 경로가 메모 모듈을 들여오면 메모 본문이 나가는 메일에 섞일 길이 생긴다. 문자열 검사일 뿐이라
// 도달 가능성을 보지 않는다(CLAUDE.md: 가드는 보조, 정본은 E2E). E2E가 실제 답장 본문에 메모가 없는지 본다.
test('발송 경로(답장·새 메일·전달)는 메모 모듈을 들여오지 않는다', () => {
  for (const file of [
    'src/app/api/admin/mailbox/[id]/reply/route.ts',
    'src/app/api/admin/mailbox/outbound/route.ts',
    'src/lib/mail/send.ts',
    'src/lib/mail/replyCompose.ts',
    'src/db/queries/mailbox.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /mailboxNotes/, file)
    assert.doesNotMatch(source, /inboundEmailNotes/, file)
  }
})
