import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/mailbox.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesMisc.test.mjs` / `queriesActivities.test.mjs`와
 * 동일 — 전용 임시 DB 파일 + `applyMigrations` + 종료 시 `rmSync`.
 *
 * 이전에는 공유 `file:local.db`를 마이그레이션·정리 없이 그대로 썼다.
 * 반복 실행마다 `inbound_emails`에 pending 행이 쌓였고(관측 시점 123건),
 * "pending 목록은 오래된 순이다" 테스트는 `listPendingInboundEmails(50)`을
 * 부르는데 정렬이 오래된 순(asc)이라 방금 심은 최신 행(`received_at`이
 * `now`인 행)이 배치 50개 밖으로 밀려 `indexOf`가 -1을 줬다 — 프로덕션
 * 결함이 아니라 테스트 격리 결함이었다. 전용 DB로 각 실행이 빈 상태에서
 * 시작하게 해서 고친다.
 */

const DB_PATH = 'scripts/testing/.queries-mailbox-test.db'
const MAILBOX_MODULE_URL = new URL('../../src/db/queries/mailbox.ts', import.meta.url)

async function loadFreshMailboxModule() {
  return import(`${MAILBOX_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

function sample(overrides = {}) {
  return {
    resend_email_id: `re_${Math.random().toString(36).slice(2)}`,
    message_id: '<abc@mail.example.com>',
    from_address: 'sender@example.com',
    to_addresses: ['contact@ggac.kr'],
    cc_addresses: [],
    received_for: ['contact@ggac.kr'],
    subject: '문의드립니다',
    received_at: new Date(),
    ...overrides,
  }
}

test('같은 resend_email_id로 두 번 넣으면 두 번째는 null이다 — 웹훅 재전송 방어', async () => {
  const { insertInboundEmail } = await loadFreshMailboxModule()
  const input = sample()
  const first = await insertInboundEmail(input)
  assert.ok(first)
  const second = await insertInboundEmail(input)
  assert.equal(second, null)
})

test('삽입 직후 상태는 unread, 본문은 pending이다', async () => {
  const { insertInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  assert.equal(row.status, 'unread')
  assert.equal(row.body_fetch_status, 'pending')
})

test('응답 키는 snake_case이고 시각은 ISO 문자열이다', async () => {
  const { insertInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  assert.ok('from_address' in row)
  assert.equal('fromAddress' in row, false)
  assert.equal(typeof row.received_at, 'string')
  assert.match(row.received_at, /^\d{4}-\d{2}-\d{2}T/)
})

test('본문을 채우면 body_fetch_status가 done이 된다', async () => {
  const { insertInboundEmail, markBodyFetched, getInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await markBodyFetched(row.id, {
    body_html: '<p>안녕하세요</p>',
    body_text: '안녕하세요',
    headers: '{"x-test":"1"}',
    subject: '문의드립니다',
  })
  const after = await getInboundEmail(row.id)
  assert.equal(after.body_fetch_status, 'done')
  assert.equal(after.body_html, '<p>안녕하세요</p>')
})

test('본문 조회 결과가 제목을 안 주면 기존 제목을 지우지 않는다', async () => {
  const { insertInboundEmail, markBodyFetched, getInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample({ subject: '원래 제목' }))
  await markBodyFetched(row.id, {
    body_html: '<p>본문</p>',
    body_text: '본문',
    headers: null,
    subject: null,
  })
  const after = await getInboundEmail(row.id)
  assert.equal(after.subject, '원래 제목')
})

test('pending 목록은 done을 빼고 준다', async () => {
  const { insertInboundEmail, markBodyFetched, listPendingInboundEmails } =
    await loadFreshMailboxModule()
  const pending = await insertInboundEmail(sample())
  const done = await insertInboundEmail(sample())
  await markBodyFetched(done.id, { body_html: null, body_text: null, headers: null, subject: null })
  const rows = await listPendingInboundEmails(50)
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(pending.id))
  assert.equal(ids.includes(done.id), false)
})

test('pending 목록은 attachments_failed도 포함한다 — 첨부만 실패한 행도 백필이 다시 봐야 한다', async () => {
  const {
    insertInboundEmail,
    markBodyFetched,
    markAttachmentsIncomplete,
    listPendingInboundEmails,
  } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await markBodyFetched(row.id, {
    body_html: '<p>본문</p>',
    body_text: '본문',
    headers: null,
    subject: null,
  })
  await markAttachmentsIncomplete(row.id)
  const rows = await listPendingInboundEmails(50)
  const found = rows.find(r => r.id === row.id)
  assert.ok(found, 'attachments_failed 행이 백필 목록에 있어야 한다')
  assert.equal(found.body_fetch_status, 'attachments_failed')
})

test('attachments_expired는 body_html을 지우지 않는다 — 본문이 있었다는 사실이 사라지면 안 된다', async () => {
  const { insertInboundEmail, markBodyFetched, markAttachmentsExpired, getInboundEmail } =
    await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await markBodyFetched(row.id, {
    body_html: '<p>본문</p>',
    body_text: '본문',
    headers: null,
    subject: null,
  })
  await markAttachmentsExpired(row.id)
  const after = await getInboundEmail(row.id)
  assert.equal(after.body_fetch_status, 'attachments_expired')
  assert.equal(after.body_html, '<p>본문</p>')
})

test('pending 목록은 오래된 순이다 — 백필이 밀린 것부터 소진해야 30일 컷오프가 그 행에 닿는다', async () => {
  const { insertInboundEmail, listPendingInboundEmails } = await loadFreshMailboxModule()
  const older = await insertInboundEmail(
    sample({ received_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
  )
  const newer = await insertInboundEmail(sample({ received_at: new Date() }))
  const rows = await listPendingInboundEmails(50)
  const ids = rows.map(r => r.id)
  const olderIndex = ids.indexOf(older.id)
  const newerIndex = ids.indexOf(newer.id)
  assert.ok(olderIndex !== -1 && newerIndex !== -1)
  assert.ok(
    olderIndex < newerIndex,
    '오래된 행이 먼저 나와야 배치 크기를 넘는 백로그에서도 백필에 집힌다'
  )
})

test('한 번 집힌 행은 아직 안 집힌 행 뒤로 간다 — 영구 실패가 배치를 독차지하지 못한다', async () => {
  const { insertInboundEmail, listPendingInboundEmails, markBodyFetchAttempted } =
    await loadFreshMailboxModule()
  // 오래된 행이 매번 실패한다고 가정한다. 시도 표시를 하면 큐 뒤로 가야
  // 새로 들어온 pending이 배치에 낄 수 있다.
  const stuck = await insertInboundEmail(
    sample({ received_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
  )
  const fresh = await insertInboundEmail(sample({ received_at: new Date() }))

  const before = (await listPendingInboundEmails(50)).map(r => r.id)
  assert.ok(before.indexOf(stuck.id) < before.indexOf(fresh.id), '처음에는 오래된 행이 앞이다')

  await markBodyFetchAttempted(stuck.id)

  const after = (await listPendingInboundEmails(50)).map(r => r.id)
  assert.ok(
    after.indexOf(fresh.id) < after.indexOf(stuck.id),
    '시도한 행은 뒤로 가고 아직 안 집힌 행이 앞에 와야 한다'
  )
})

test('상태 변경은 expected가 맞을 때만 먹는다', async () => {
  const { insertInboundEmail, updateInboundStatus } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  assert.equal(await updateInboundStatus(row.id, 'unread', 'read'), 'updated')
  assert.equal(await updateInboundStatus(row.id, 'unread', 'archived'), 'conflict')
  assert.equal(await updateInboundStatus('없는-id', 'unread', 'read'), 'missing')
})

test('검색어의 %는 와일드카드로 해석되지 않는다', async () => {
  const { insertInboundEmail, listInboundEmails } = await loadFreshMailboxModule()
  await insertInboundEmail(sample({ subject: '정상 제목' }))
  const all = await listInboundEmails({ limit: 100, offset: 0 })
  const wild = await listInboundEmails({ limit: 100, offset: 0, search: '%' })
  assert.ok(all.total_count > 0)
  assert.ok(wild.total_count < all.total_count || wild.total_count === 0)
})

test('상태로 거를 수 있다', async () => {
  const { insertInboundEmail, updateInboundStatus, listInboundEmails } =
    await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await updateInboundStatus(row.id, 'unread', 'archived')
  const result = await listInboundEmails({ limit: 100, offset: 0, status: 'archived' })
  assert.ok(result.emails.every(e => e.status === 'archived'))
})

test('References는 공백으로 이어 쌓인다', async () => {
  const { insertInboundEmail, appendThreadReference, getInboundEmail } =
    await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await appendThreadReference(row.id, '<one@x>')
  await appendThreadReference(row.id, '<two@x>')
  const after = await getInboundEmail(row.id)
  assert.equal(after.thread_references, '<one@x> <two@x>')
})

test('같은 References를 두 번 넣어도 한 번만 쌓인다', async () => {
  const { insertInboundEmail, appendThreadReference, getInboundEmail } =
    await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  await appendThreadReference(row.id, '<one@x>')
  await appendThreadReference(row.id, '<one@x>')
  const after = await getInboundEmail(row.id)
  assert.equal(after.thread_references, '<one@x>')
})

test('첨부는 호출부가 정한 id를 그대로 쓴다 — Blob 경로와 행이 같은 id를 가리켜야 한다', async () => {
  const { insertInboundEmail, insertAttachment, getAttachment } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  const chosenId = `att_${Math.random().toString(36).slice(2)}`
  await insertAttachment({
    id: chosenId,
    email_id: row.id,
    filename: 'photo.png',
    content_type: 'image/png',
    content_id: null,
    size_bytes: 1024,
    blob_path: `mailbox/${chosenId}/photo.png`,
  })
  const attachment = await getAttachment(chosenId)
  assert.ok(attachment)
  assert.equal(attachment.id, chosenId)
  assert.equal(attachment.blob_path, `mailbox/${chosenId}/photo.png`)
})

test('기준 시각 이후 수신 건수를 센다 — 쿼터 감시용', async () => {
  const { insertInboundEmail, countInboundSince } = await loadFreshMailboxModule()
  const before = await countInboundSince(Date.now() - 60_000)
  await insertInboundEmail(sample())
  const after = await countInboundSince(Date.now() - 60_000)
  assert.equal(after, before + 1)
})

// ── 새 메일 작성(보낸 메일) ───────────────────────────────────────────────────

function outboundInput(overrides = {}) {
  return {
    idempotency_key: crypto.randomUUID(),
    to_addresses: ['a@example.com'],
    cc_addresses: [],
    bcc_addresses: ['hidden@example.com'],
    recipient_count: 2,
    subject: '새 메일',
    body_html: '<p>안녕하세요</p>',
    sent_by: null,
    sent_by_email: null,
    ...overrides,
  }
}

test('보낸 메일은 sending으로 시작하고 snake_case·ISO로 돌아온다', async () => {
  const { insertOutboundSending } = await loadFreshMailboxModule()
  const { created, row } = await insertOutboundSending(outboundInput())
  assert.equal(created, true)
  assert.equal(row.status, 'sending')
  assert.equal(row.recipient_count, 2)
  assert.deepEqual(JSON.parse(row.to_addresses), ['a@example.com'])
  assert.equal(row.cc_addresses, null)
  assert.equal(typeof row.created_at, 'string')
  assert.equal(row.sent_at, null)
})

test('같은 idempotency_key로 다시 넣으면 새 행 없이 기존 행을 돌려준다 — 중복 발송 방어', async () => {
  const { insertOutboundSending, countOutboundRecipientsSince } = await loadFreshMailboxModule()
  const input = outboundInput({ recipient_count: 3 })
  const before = await countOutboundRecipientsSince(0)
  const first = await insertOutboundSending(input)
  const second = await insertOutboundSending({ ...input, subject: '다른 제목' })
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.row.id, first.row.id)
  assert.equal(second.row.subject, '새 메일')
  assert.equal(await countOutboundRecipientsSince(0), before + 3)
})

test('sent 전이는 sending일 때만 일어나고 한 번 정해진 상태를 되돌리지 않는다', async () => {
  const { insertOutboundSending, markOutboundSent, markOutboundStatus, getOutboundEmail } =
    await loadFreshMailboxModule()
  const { row } = await insertOutboundSending(outboundInput())
  await markOutboundSent(row.id, 're_msg_1')
  let got = await getOutboundEmail(row.id)
  assert.equal(got.status, 'sent')
  assert.equal(got.resend_message_id, 're_msg_1')
  assert.equal(typeof got.sent_at, 'string')

  await markOutboundStatus(row.id, 'failed', 'late failure')
  got = await getOutboundEmail(row.id)
  assert.equal(got.status, 'sent')
})

test('failed·unknown·blocked 전이는 사유를 200자로 자른다', async () => {
  const { insertOutboundSending, markOutboundStatus, getOutboundEmail } =
    await loadFreshMailboxModule()
  const { row } = await insertOutboundSending(outboundInput())
  await markOutboundStatus(row.id, 'unknown', 'x'.repeat(500))
  const got = await getOutboundEmail(row.id)
  assert.equal(got.status, 'unknown')
  assert.equal(got.error.length, 200)
})

test('24시간 수신자 수는 sending·sent·unknown만 세고 failed·blocked는 세지 않는다', async () => {
  const {
    insertOutboundSending,
    markOutboundSent,
    markOutboundStatus,
    countOutboundRecipientsSince,
  } = await loadFreshMailboxModule()
  const base = await countOutboundRecipientsSince(Date.now() - 1000)

  const sending = await insertOutboundSending(outboundInput({ recipient_count: 1 }))
  const sent = await insertOutboundSending(outboundInput({ recipient_count: 2 }))
  await markOutboundSent(sent.row.id, null)
  const unknown = await insertOutboundSending(outboundInput({ recipient_count: 4 }))
  await markOutboundStatus(unknown.row.id, 'unknown', null)
  const failed = await insertOutboundSending(outboundInput({ recipient_count: 8 }))
  await markOutboundStatus(failed.row.id, 'failed', null)
  const blocked = await insertOutboundSending(outboundInput({ recipient_count: 16 }))
  await markOutboundStatus(blocked.row.id, 'blocked', null)

  assert.equal(sending.created && sent.created && unknown.created, true)
  assert.equal(await countOutboundRecipientsSince(Date.now() - 1000), base + 1 + 2 + 4)
})

test('24시간 수신자 수에는 같은 기간의 답장도 한 통씩 더해진다', async () => {
  const { insertInboundEmail, insertReply, countOutboundRecipientsSince } =
    await loadFreshMailboxModule()
  const mail = await insertInboundEmail(sample())
  const before = await countOutboundRecipientsSince(Date.now() - 1000)
  await insertReply({ email_id: mail.id, subject: 'Re: x', body_html: '<p>x</p>' })
  assert.equal(await countOutboundRecipientsSince(Date.now() - 1000), before + 1)
})

test('기준 시각보다 오래된 행은 24시간 합계에서 빠진다', async () => {
  const { insertOutboundSending, countOutboundRecipientsSince } = await loadFreshMailboxModule()
  await insertOutboundSending(outboundInput({ recipient_count: 5 }))
  const future = Date.now() + 60_000
  assert.equal(await countOutboundRecipientsSince(future), 0)
})

test('보낸 첨부는 메일에 붙어 저장되고 메일을 지우면 함께 지워진다', async () => {
  const {
    insertOutboundSending,
    insertOutboundAttachment,
    listOutboundAttachments,
    getOutboundAttachment,
  } = await loadFreshMailboxModule()
  const { row } = await insertOutboundSending(outboundInput())
  const attId = crypto.randomUUID()
  await insertOutboundAttachment({
    id: attId,
    email_id: row.id,
    filename: '견적서.pdf',
    content_type: 'application/pdf',
    size_bytes: 1234,
    blob_path: `mailbox-sent/${row.id}/${attId}.pdf`,
  })
  const list = await listOutboundAttachments(row.id)
  assert.equal(list.length, 1)
  assert.equal(list[0].filename, '견적서.pdf')
  assert.equal((await getOutboundAttachment(attId)).email_id, row.id)

  const client = createClient({ url: `file:${DB_PATH}` })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute({ sql: 'DELETE FROM outbound_emails WHERE id = ?', args: [row.id] })
  client.close()
  assert.equal(await getOutboundAttachment(attId), null)
})

test('첨부 행 삭제는 그 메일의 행만 지우고 다른 메일의 행은 건드리지 않는다', async () => {
  const {
    insertOutboundSending,
    insertOutboundAttachment,
    deleteOutboundAttachmentsForEmail,
    listOutboundAttachments,
  } = await loadFreshMailboxModule()
  const a = await insertOutboundSending(outboundInput())
  const b = await insertOutboundSending(outboundInput())
  for (const row of [a.row, b.row]) {
    const attId = crypto.randomUUID()
    await insertOutboundAttachment({
      id: attId,
      email_id: row.id,
      filename: 'x.pdf',
      content_type: null,
      size_bytes: 1,
      blob_path: `mailbox-sent/${row.id}/${attId}.pdf`,
    })
  }
  await deleteOutboundAttachmentsForEmail(a.row.id)
  assert.equal((await listOutboundAttachments(a.row.id)).length, 0)
  assert.equal((await listOutboundAttachments(b.row.id)).length, 1)
})

test('보낸 편지함은 새 메일과 답장을 최신순으로 합치고 kind로 거른다', async () => {
  const { insertInboundEmail, insertReply, insertOutboundSending, listSentMail } =
    await loadFreshMailboxModule()
  const mail = await insertInboundEmail(sample({ from_address: 'asker@example.com' }))
  await insertReply({ email_id: mail.id, subject: 'Re: 합침', body_html: '<p>r</p>' })
  await new Promise(r => setTimeout(r, 5))
  const composed = await insertOutboundSending(outboundInput({ subject: '합침-새 메일' }))

  const all = await listSentMail({ limit: 500, offset: 0, kind: 'all' })
  const compose = await listSentMail({ limit: 500, offset: 0, kind: 'compose' })
  const reply = await listSentMail({ limit: 500, offset: 0, kind: 'reply' })

  assert.equal(all.total_count, compose.total_count + reply.total_count)
  assert.ok(compose.items.every(i => i.kind === 'compose'))
  assert.ok(reply.items.every(i => i.kind === 'reply'))

  const idxCompose = all.items.findIndex(i => i.id === composed.row.id)
  const replyItem = all.items.find(i => i.subject === 'Re: 합침')
  assert.ok(idxCompose >= 0 && replyItem)
  assert.ok(idxCompose < all.items.indexOf(replyItem), '더 늦게 보낸 새 메일이 앞에 와야 한다')

  assert.deepEqual(JSON.parse(replyItem.to_addresses), ['asker@example.com'])
  assert.equal(replyItem.related_email_id, mail.id)
  assert.equal(replyItem.status, 'sent')
  assert.equal(typeof replyItem.created_at, 'string')
  assert.ok(!('bcc_addresses' in all.items[0]), '목록에는 BCC를 싣지 않는다')
  assert.ok(!('body_html' in all.items[0]), '목록에는 본문을 싣지 않는다')
})

test('보낸 편지함 페이지네이션은 전체 개수를 유지한다', async () => {
  const { insertOutboundSending, listSentMail } = await loadFreshMailboxModule()
  for (let i = 0; i < 3; i++) await insertOutboundSending(outboundInput())
  const page = await listSentMail({ limit: 2, offset: 0, kind: 'compose' })
  const rest = await listSentMail({ limit: 2, offset: 2, kind: 'compose' })
  assert.equal(page.items.length, 2)
  assert.ok(page.total_count >= 3)
  assert.equal(rest.total_count, page.total_count)
  assert.ok(!page.items.some(a => rest.items.some(b => a.id === b.id)))
})
