import { test, before } from 'node:test'
import assert from 'node:assert/strict'

process.env.TURSO_DATABASE_URL = 'file:local.db'

const {
  insertInboundEmail,
  getInboundEmail,
  listInboundEmails,
  updateInboundStatus,
  markBodyFetched,
  listPendingInboundEmails,
  countInboundSince,
  appendThreadReference,
  insertAttachment,
  getAttachment,
} = await import('../../src/db/queries/mailbox.ts')

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
  const input = sample()
  const first = await insertInboundEmail(input)
  assert.ok(first)
  const second = await insertInboundEmail(input)
  assert.equal(second, null)
})

test('삽입 직후 상태는 unread, 본문은 pending이다', async () => {
  const row = await insertInboundEmail(sample())
  assert.equal(row.status, 'unread')
  assert.equal(row.body_fetch_status, 'pending')
})

test('응답 키는 snake_case이고 시각은 ISO 문자열이다', async () => {
  const row = await insertInboundEmail(sample())
  assert.ok('from_address' in row)
  assert.equal('fromAddress' in row, false)
  assert.equal(typeof row.received_at, 'string')
  assert.match(row.received_at, /^\d{4}-\d{2}-\d{2}T/)
})

test('본문을 채우면 body_fetch_status가 done이 된다', async () => {
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
  const pending = await insertInboundEmail(sample())
  const done = await insertInboundEmail(sample())
  await markBodyFetched(done.id, { body_html: null, body_text: null, headers: null, subject: null })
  const rows = await listPendingInboundEmails(50)
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(pending.id))
  assert.equal(ids.includes(done.id), false)
})

test('pending 목록은 오래된 순이다 — 백필이 밀린 것부터 소진해야 30일 컷오프가 그 행에 닿는다', async () => {
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

test('상태 변경은 expected가 맞을 때만 먹는다', async () => {
  const row = await insertInboundEmail(sample())
  assert.equal(await updateInboundStatus(row.id, 'unread', 'read'), 'updated')
  assert.equal(await updateInboundStatus(row.id, 'unread', 'archived'), 'conflict')
  assert.equal(await updateInboundStatus('없는-id', 'unread', 'read'), 'missing')
})

test('검색어의 %는 와일드카드로 해석되지 않는다', async () => {
  await insertInboundEmail(sample({ subject: '정상 제목' }))
  const all = await listInboundEmails({ limit: 100, offset: 0 })
  const wild = await listInboundEmails({ limit: 100, offset: 0, search: '%' })
  assert.ok(all.total_count > 0)
  assert.ok(wild.total_count < all.total_count || wild.total_count === 0)
})

test('상태로 거를 수 있다', async () => {
  const row = await insertInboundEmail(sample())
  await updateInboundStatus(row.id, 'unread', 'archived')
  const result = await listInboundEmails({ limit: 100, offset: 0, status: 'archived' })
  assert.ok(result.emails.every(e => e.status === 'archived'))
})

test('References는 공백으로 이어 쌓인다', async () => {
  const row = await insertInboundEmail(sample())
  await appendThreadReference(row.id, '<one@x>')
  await appendThreadReference(row.id, '<two@x>')
  const after = await getInboundEmail(row.id)
  assert.equal(after.thread_references, '<one@x> <two@x>')
})

test('같은 References를 두 번 넣어도 한 번만 쌓인다', async () => {
  const row = await insertInboundEmail(sample())
  await appendThreadReference(row.id, '<one@x>')
  await appendThreadReference(row.id, '<one@x>')
  const after = await getInboundEmail(row.id)
  assert.equal(after.thread_references, '<one@x>')
})

test('첨부는 호출부가 정한 id를 그대로 쓴다 — Blob 경로와 행이 같은 id를 가리켜야 한다', async () => {
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
  const before = await countInboundSince(Date.now() - 60_000)
  await insertInboundEmail(sample())
  const after = await countInboundSince(Date.now() - 60_000)
  assert.equal(after, before + 1)
})
