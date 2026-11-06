import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 보낸 메일에 온 답장 잇기(0047) — 실제 SQLite 파일 DB로 본다.
 *
 * - `linkSentReply`: 헤더가 가리키는 id와 `outbound_emails.message_id`가 **정확히** 같은 sent 행만 잇는다.
 *   제목·수신자로 추측하지 않는다. 못 찾으면 아무것도 바꾸지 않고, 두 번 불러도 같다(멱등).
 * - `setOutboundMessageId`: 비어 있을 때만 쓴다(늦게 온 조회가 최신 값을 덮지 않게).
 * - `listSentWithoutMessageId`: 백필 대상은 sent + message_id 없음 + resend id 있음뿐이다.
 */

const DB_PATH = 'scripts/testing/.queries-mailbox-sent-reply-test.db'
const src = rel => new URL(`../../src/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let Q

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = await import(src('db/queries/mailbox.ts'))
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedSent({ messageId = null, status = 'sent' } = {}) {
  const n = ++counter
  const { created, row } = await Q.insertOutboundSending({
    idempotency_key: crypto.randomUUID(),
    to_addresses: [`상대${n}@example.com`],
    cc_addresses: [],
    bcc_addresses: [],
    recipient_count: 1,
    subject: `보낸 메일 ${n}`,
    body_html: '<p>본문</p>',
    sent_by: null,
    sent_by_email: 'admin@ggac.kr',
  })
  assert.equal(created, true)
  const id = String(row.id)
  if (status === 'sent') {
    await Q.markOutboundSent(id, `resend-${n}`)
    if (messageId) await Q.setOutboundMessageId(id, messageId)
  }
  return id
}

async function seedInbound(headers) {
  const n = ++counter
  const row = await Q.insertInboundEmail({
    resend_email_id: `inbound-${crypto.randomUUID()}`,
    from_address: `상대${n} <상대${n}@example.com>`,
    to_addresses: ['mailbox@ggac.kr'],
    subject: `Re: 보낸 메일 ${n}`,
    received_at: new Date(),
  })
  const id = String(row.id)
  if (headers) {
    // 본문을 당길 때 저장되는 모양 그대로 — 헤더는 JSON 문자열이다.
    await Q.markBodyFetched(id, {
      body_html: '<p>답장</p>',
      body_text: '답장',
      headers: JSON.stringify(headers),
      subject: `Re: 보낸 메일 ${n}`,
    })
  }
  return id
}

async function linkedOf(id) {
  const email = await Q.getInboundEmail(id)
  return email?.reply_to_outbound_id ?? null
}

test('헤더의 In-Reply-To가 보낸 메일의 Message-ID와 같으면 그 메일에 잇는다', async () => {
  const messageId = '<abc-123@ggac.kr>'
  const sentId = await seedSent({ messageId })
  const inboundId = await seedInbound({ 'In-Reply-To': messageId })

  const linked = await Q.linkSentReply(inboundId, [messageId])
  assert.equal(linked, sentId)
  assert.equal(await linkedOf(inboundId), sentId)
})

test('References에 섞여 있어도 찾는다 — 상대가 여러 번 오간 대화', async () => {
  const messageId = '<ref-2@ggac.kr>'
  const sentId = await seedSent({ messageId })
  const inboundId = await seedInbound({
    References: '<first@other> <ref-2@ggac.kr> <last@other>',
  })
  assert.equal(await Q.linkSentReply(inboundId, ['<first@other>', messageId]), sentId)
})

test('제목·수신자가 같아도 Message-ID가 다르면 잇지 않는다 — 추측하지 않는다', async () => {
  await seedSent({ messageId: '<real@ggac.kr>' })
  const inboundId = await seedInbound({ 'In-Reply-To': '<other@ggac.kr>' })
  assert.equal(await Q.linkSentReply(inboundId, ['<other@ggac.kr>']), null)
  assert.equal(await linkedOf(inboundId), null)
})

test('보내지 못한 행(failed·unknown)은 잇지 않는다 — 나가지 않은 메일에 답장이 올 수 없다', async () => {
  const messageId = '<failed@ggac.kr>'
  const sentId = await seedSent({ status: 'sending' })
  await Q.markOutboundStatus(sentId, 'failed', '거절')
  await Q.setOutboundMessageId(sentId, messageId)
  const inboundId = await seedInbound({ 'In-Reply-To': messageId })
  assert.equal(await Q.linkSentReply(inboundId, [messageId]), null)
})

test('두 번 불러도 같다 — 멱등', async () => {
  const messageId = '<idem@ggac.kr>'
  const sentId = await seedSent({ messageId })
  const inboundId = await seedInbound({ 'In-Reply-To': messageId })
  await Q.linkSentReply(inboundId, [messageId])
  assert.equal(await Q.linkSentReply(inboundId, [messageId]), sentId)
  assert.equal(await linkedOf(inboundId), sentId)
})

test('빈 목록이면 조회하지 않고 null이다', async () => {
  const inboundId = await seedInbound(null)
  assert.equal(await Q.linkSentReply(inboundId, []), null)
})

test('setOutboundMessageId는 비어 있을 때만 쓴다', async () => {
  const sentId = await seedSent({ messageId: '<first@ggac.kr>' })
  await Q.setOutboundMessageId(sentId, '<second@ggac.kr>')
  const [row] = (
    await setupClient.execute({
      sql: 'select message_id from outbound_emails where id = ?',
      args: [sentId],
    })
  ).rows
  assert.equal(row.message_id, '<first@ggac.kr>')
})

test('백필 대상은 sent + message_id 없음 + resend id 있음뿐이다', async () => {
  const before = await Q.listSentWithoutMessageId(100)
  const missing = await seedSent({ messageId: null })
  const after = await Q.listSentWithoutMessageId(100)
  const ids = after.map(row => row.id)
  assert.ok(ids.includes(missing), 'message_id가 빈 sent 행이 백필 대상이다')
  assert.ok(after.length === before.length + 1)
  for (const row of after) assert.ok(row.resend_message_id, 'resend id가 없으면 조회할 수 없다')
})

test('getSentMailSummary는 화면에 필요한 머리글만 준다', async () => {
  const sentId = await seedSent({ messageId: '<sum@ggac.kr>' })
  const summary = await Q.getSentMailSummary(sentId)
  assert.equal(summary.id, sentId)
  assert.ok(summary.subject.startsWith('보낸 메일'))
  assert.ok(summary.sent_at, '보낸 시각이 있어야 화면이 날짜를 보여 준다')
  assert.equal(summary.sent_by_email, 'admin@ggac.kr')
})

test('보낸 메일 행이 없으면 null이다 — 화면은 아무것도 그리지 않는다', async () => {
  assert.equal(await Q.getSentMailSummary(crypto.randomUUID()), null)
})
