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

test('일괄 상태 변경: 기대 상태가 맞는 메일만 바꾸고 나머지는 conflict·missing으로 나눈다', async () => {
  const mod = await loadFreshMailboxModule()
  const a = await mod.insertInboundEmail(sample())
  const b = await mod.insertInboundEmail(sample())
  const c = await mod.insertInboundEmail(sample())
  // 다른 관리자가 c를 먼저 스팸으로 옮겼다
  await mod.updateInboundStatus(c.id, 'unread', 'spam')
  await mod.updateInboundStatus(b.id, 'unread', 'read')
  const ghost = crypto.randomUUID()

  const outcome = await mod.updateInboundStatusBulk(
    [
      { id: a.id, expected: 'unread' },
      { id: b.id, expected: 'read' },
      { id: c.id, expected: 'unread' },
      { id: ghost, expected: 'unread' },
    ],
    'archived'
  )
  assert.deepEqual(outcome.updated, [a.id, b.id])
  assert.deepEqual(outcome.conflict, [c.id])
  assert.deepEqual(outcome.missing, [ghost])
  assert.equal((await mod.getInboundEmail(a.id)).status, 'archived')
  assert.equal((await mod.getInboundEmail(b.id)).status, 'archived')
  assert.equal((await mod.getInboundEmail(c.id)).status, 'spam', 'conflict는 건드리지 않는다')
})

test('일괄 상태 변경: 이미 목표 상태인 메일은 바뀐 것으로 친다', async () => {
  const mod = await loadFreshMailboxModule()
  const a = await mod.insertInboundEmail(sample())
  await mod.updateInboundStatus(a.id, 'unread', 'archived')
  const outcome = await mod.updateInboundStatusBulk([{ id: a.id, expected: 'unread' }], 'archived')
  assert.deepEqual(outcome, { updated: [a.id], conflict: [], missing: [] })
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

test('삽입하면 발신 주소를 정규화해 from_email·from_name에 담는다', async () => {
  const { insertInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample({ from_address: '"홍길동" <Hong@A.org>' }))
  assert.equal(row.from_address, '"홍길동" <Hong@A.org>')
  assert.equal(row.from_email, 'hong@a.org')
  assert.equal(row.from_name, '홍길동')
})

test('발신자 필터는 완전 일치다 — kim@로 찾을 때 akim@이 섞이지 않는다', async () => {
  const { insertInboundEmail, listInboundEmails } = await loadFreshMailboxModule()
  const tag = Math.random().toString(36).slice(2)
  const kim = await insertInboundEmail(sample({ from_address: `김 <kim-${tag}@a.org>` }))
  await insertInboundEmail(sample({ from_address: `akim-${tag}@a.org` }))
  await insertInboundEmail(sample({ from_address: `kim-${tag}@a.org.evil.com` }))
  const result = await listInboundEmails({ limit: 100, offset: 0, fromEmail: `kim-${tag}@a.org` })
  assert.deepEqual(
    result.emails.map(e => e.id),
    [kim.id]
  )
  assert.equal(result.total_count, 1)
})

test('도메인 필터는 @ 뒤가 정확히 그 도메인인 행만 준다', async () => {
  const { insertInboundEmail, listInboundEmails } = await loadFreshMailboxModule()
  const domain = `d${Math.random().toString(36).slice(2)}.org`
  const a = await insertInboundEmail(sample({ from_address: `a@${domain}` }))
  const b = await insertInboundEmail(sample({ from_address: `B <b@${domain.toUpperCase()}>` }))
  await insertInboundEmail(sample({ from_address: `c@x${domain}` }))
  await insertInboundEmail(sample({ from_address: `d@sub.${domain}.evil.com` }))
  const result = await listInboundEmails({ limit: 100, offset: 0, fromDomain: domain })
  assert.deepEqual(new Set(result.emails.map(e => e.id)), new Set([a.id, b.id]))
  assert.equal(result.total_count, 2)
})

test('발신자 필터는 상태·검색과 함께 걸린다', async () => {
  const { insertInboundEmail, updateInboundStatus, listInboundEmails } =
    await loadFreshMailboxModule()
  const from = `combo-${Math.random().toString(36).slice(2)}@a.org`
  const archived = await insertInboundEmail(sample({ from_address: from, subject: '총회 자료' }))
  await updateInboundStatus(archived.id, 'unread', 'archived')
  await insertInboundEmail(sample({ from_address: from, subject: '총회 자료' }))
  await insertInboundEmail(sample({ from_address: from, subject: '다른 제목' }))
  const result = await listInboundEmails({
    limit: 100,
    offset: 0,
    fromEmail: from,
    status: 'archived',
    search: '총회',
  })
  assert.deepEqual(
    result.emails.map(e => e.id),
    [archived.id]
  )
})

function uniqueAddress(prefix = 'p') {
  return `${prefix}-${Math.random().toString(36).slice(2)}@search.example`
}

async function attach(mod, emailId, overrides = {}) {
  const id = crypto.randomUUID()
  await mod.insertAttachment({
    id,
    email_id: emailId,
    filename: 'file.pdf',
    content_type: 'application/pdf',
    content_id: null,
    size_bytes: 10,
    blob_path: `mailbox/${emailId}/${id}.pdf`,
    ...overrides,
  })
}

test('첨부 필터는 진짜 첨부만 본다 — cid로 박힌 인라인 이미지(서명 로고)는 세지 않는다', async () => {
  const mod = await loadFreshMailboxModule()
  const from = uniqueAddress('att')
  const withPdf = await mod.insertInboundEmail(sample({ from_address: from }))
  await attach(mod, withPdf.id)
  const inlineOnly = await mod.insertInboundEmail(sample({ from_address: from }))
  await attach(mod, inlineOnly.id, { content_type: 'image/png', content_id: '<logo@x>' })
  const plainImage = await mod.insertInboundEmail(sample({ from_address: from }))
  await attach(mod, plainImage.id, { content_type: 'image/jpeg', content_id: null })
  await mod.insertInboundEmail(sample({ from_address: from }))

  const result = await mod.listInboundEmails({
    limit: 100,
    offset: 0,
    fromEmail: from,
    hasAttachment: true,
  })
  assert.deepEqual(new Set(result.emails.map(e => e.id)), new Set([withPdf.id, plainImage.id]))
  assert.equal(result.total_count, 2)

  const all = await mod.listInboundEmails({ limit: 100, offset: 0, fromEmail: from })
  const counts = Object.fromEntries(all.emails.map(e => [e.id, e.attachment_count]))
  assert.equal(counts[withPdf.id], 1)
  assert.equal(counts[inlineOnly.id], 0)
})

test('기간 필터는 시작은 포함하고 끝은 배타다', async () => {
  const mod = await loadFreshMailboxModule()
  const from = uniqueAddress('date')
  const t0 = Date.parse('2026-03-01T00:00:00+09:00')
  const atStart = await mod.insertInboundEmail(
    sample({ from_address: from, received_at: new Date(t0) })
  )
  const before = await mod.insertInboundEmail(
    sample({ from_address: from, received_at: new Date(t0 - 1) })
  )
  const atEnd = await mod.insertInboundEmail(
    sample({ from_address: from, received_at: new Date(t0 + 86_400_000) })
  )
  const result = await mod.listInboundEmails({
    limit: 100,
    offset: 0,
    fromEmail: from,
    receivedFrom: new Date(t0),
    receivedUntil: new Date(t0 + 86_400_000),
  })
  assert.deepEqual(
    result.emails.map(e => e.id),
    [atStart.id]
  )
  assert.ok(![before.id, atEnd.id].some(id => result.emails.some(e => e.id === id)))
})

test('검색은 본문(body_text)도 보되 HTML 태그 속성에는 걸리지 않는다', async () => {
  const mod = await loadFreshMailboxModule()
  const from = uniqueAddress('body')
  const marker = `본문표지${Math.random().toString(36).slice(2)}`
  const inText = await mod.insertInboundEmail(sample({ from_address: from, subject: '제목' }))
  await mod.markBodyFetched(inText.id, {
    body_html: '<p>x</p>',
    body_text: `안녕하세요 ${marker} 입니다`,
    headers: null,
    subject: null,
  })
  const inHtmlOnly = await mod.insertInboundEmail(sample({ from_address: from, subject: '제목' }))
  await mod.markBodyFetched(inHtmlOnly.id, {
    body_html: `<p class="${marker}">x</p>`,
    body_text: 'x',
    headers: null,
    subject: null,
  })
  const result = await mod.listInboundEmails({ limit: 100, offset: 0, search: marker })
  assert.deepEqual(
    result.emails.map(e => e.id),
    [inText.id]
  )
})

test('발신자 카드: 받은 수·기간·답장 수를 세고, 보낸 메일은 나간 것 중 받는 사람·참조만 센다', async () => {
  const mod = await loadFreshMailboxModule()
  const who = uniqueAddress('card')
  const first = await mod.insertInboundEmail(
    sample({ from_address: `옛이름 <${who}>`, received_at: new Date('2026-01-01T00:00:00Z') })
  )
  await mod.insertInboundEmail(
    sample({
      from_address: `새이름 <${who.toUpperCase()}>`,
      received_at: new Date('2026-02-01T00:00:00Z'),
    })
  )
  await mod.insertReply({ email_id: first.id, subject: 'Re: 문의', body_html: '<p>답</p>' })

  const sentTo = await mod.insertOutboundSending(outboundInput({ to_addresses: [who] }))
  await mod.markOutboundSent(sentTo.row.id, 're_card_1')
  const sentCc = await mod.insertOutboundSending(
    outboundInput({ to_addresses: ['other@example.com'], cc_addresses: [who] })
  )
  await mod.markOutboundSent(sentCc.row.id, 're_card_2')
  // 숨은참조로만 받은 메일 — 세면 BCC 수신자가 드러난다.
  const bccOnly = await mod.insertOutboundSending(
    outboundInput({ to_addresses: ['other@example.com'], bcc_addresses: [who] })
  )
  await mod.markOutboundSent(bccOnly.row.id, 're_card_3')
  // 실패한 메일은 "보낸 메일"이 아니다.
  const failed = await mod.insertOutboundSending(outboundInput({ to_addresses: [who] }))
  await mod.markOutboundStatus(failed.row.id, 'failed', 'x')

  const card = await mod.getSenderSummary(who)
  assert.equal(card.email, who)
  assert.equal(card.name, '새이름')
  assert.equal(card.inbound_count, 2)
  assert.equal(card.first_received_at, '2026-01-01T00:00:00.000Z')
  assert.equal(card.last_received_at, '2026-02-01T00:00:00.000Z')
  assert.equal(card.reply_count, 1)
  assert.equal(card.sent_count, 2)
})

test('발신자 카드: 메일이 없는 주소는 0과 null이다', async () => {
  const mod = await loadFreshMailboxModule()
  const card = await mod.getSenderSummary(uniqueAddress('none'))
  assert.equal(card.inbound_count, 0)
  assert.equal(card.first_received_at, null)
  assert.equal(card.name, null)
  assert.equal(card.sent_count, 0)
})

test('회원 매칭은 대소문자를 무시하고 배지에 필요한 칸만 돌려준다', async () => {
  const mod = await loadFreshMailboxModule()
  const id = crypto.randomUUID()
  const address = uniqueAddress('member')
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email, phone_number, registration_status, is_active)
          values (?, ?, ?, ?, 'approved', 1)`,
    args: [id, '회원표지', address.toUpperCase(), '010-0000-0000'],
  })
  const member = await mod.findMemberByEmail(address)
  assert.deepEqual(member, {
    id,
    display_name: '회원표지',
    registration_status: 'approved',
    is_active: true,
  })
  assert.equal(await mod.findMemberByEmail(uniqueAddress('stranger')), null)
})

test('삽입하면 대화 id는 자기 id다', async () => {
  const { insertInboundEmail } = await loadFreshMailboxModule()
  const row = await insertInboundEmail(sample())
  assert.equal(row.thread_id, row.id)
})

function threadSample(minute, overrides = {}) {
  return sample({
    message_id: `<t${Math.random().toString(36).slice(2)}@x>`,
    received_at: new Date(Date.UTC(2026, 4, 1, 0, minute)),
    ...overrides,
  })
}

test('assignThread: 가리킨 앞 메일의 대화로 옮기고, 사슬이면 시작 메일의 대화를 따른다', async () => {
  const mod = await loadFreshMailboxModule()
  const root = await mod.insertInboundEmail(threadSample(0))
  const second = await mod.insertInboundEmail(threadSample(1))
  // In-Reply-To만으로 root를 가리킨다
  assert.equal(await mod.assignThread(second.id, [root.message_id]), root.id)
  const third = await mod.insertInboundEmail(threadSample(2))
  // second만 가리켜도 second의 대화(root)로 간다
  assert.equal(await mod.assignThread(third.id, [second.message_id]), root.id)
  const after = await mod.getInboundEmail(third.id)
  assert.equal(after.thread_id, root.id)
  // 다시 불러도 같다(멱등)
  assert.equal(await mod.assignThread(third.id, [second.message_id]), root.id)
})

test('assignThread: 모르는 ID·자기 자신·나중에 받은 메일은 대화를 바꾸지 않는다', async () => {
  const mod = await loadFreshMailboxModule()
  const early = await mod.insertInboundEmail(threadSample(10))
  const late = await mod.insertInboundEmail(threadSample(11))
  assert.equal(await mod.assignThread(early.id, []), null)
  assert.equal(await mod.assignThread(early.id, ['<nobody@nowhere>']), null)
  assert.equal(await mod.assignThread(early.id, [early.message_id]), null)
  assert.equal(await mod.assignThread(early.id, [late.message_id]), null)
  assert.equal((await mod.getInboundEmail(early.id)).thread_id, early.id)
})

test('assignThread: 앞 메일이 여럿이면 가장 먼저 받은 것의 대화다', async () => {
  const mod = await loadFreshMailboxModule()
  const older = await mod.insertInboundEmail(threadSample(20))
  const newer = await mod.insertInboundEmail(threadSample(21))
  const reply = await mod.insertInboundEmail(threadSample(22))
  assert.equal(await mod.assignThread(reply.id, [newer.message_id, older.message_id]), older.id)
})

test('대화 목록은 받은 메일과 답장을 시간순으로 주고 다른 대화는 섞지 않는다', async () => {
  const mod = await loadFreshMailboxModule()
  const root = await mod.insertInboundEmail(threadSample(30, { subject: '원본' }))
  await mod.insertReply({ email_id: root.id, subject: 'Re: 원본', body_html: '<p>답</p>' })
  const follow = await mod.insertInboundEmail(
    threadSample(31, { subject: 'Re: Re: 원본', received_at: new Date(Date.now() + 60_000) })
  )
  await mod.assignThread(follow.id, [root.message_id])
  const stranger = await mod.insertInboundEmail(threadSample(32))

  const thread = await mod.listThread(root.id)
  assert.deepEqual(
    thread.map(item => `${item.kind}:${item.kind === 'inbound' ? item.id : item.email_id}`),
    [`inbound:${root.id}`, `reply:${root.id}`, `inbound:${follow.id}`]
  )
  assert.ok(!thread.some(item => item.id === stranger.id))
  assert.equal('body_html' in thread[0], false, '대화 목록에는 본문이 없다')

  const list = await mod.listInboundEmails({
    limit: 100,
    offset: 0,
    fromEmail: 'sender@example.com',
  })
  const counts = Object.fromEntries(list.emails.map(e => [e.id, e.thread_count]))
  assert.equal(counts[root.id], 2)
  assert.equal(counts[follow.id], 2)
  assert.equal(counts[stranger.id], 1)
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
  // 두 집계가 같은 창을 쓴다 — 부하로 삽입이 느려져도 행이 창 밖으로 빠져 기댓값이 어긋나지 않게.
  const since = Date.now() - 60_000
  const base = await countOutboundRecipientsSince(since)

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
  assert.equal(await countOutboundRecipientsSince(since), base + 1 + 2 + 4)
})

test('24시간 수신자 수에는 같은 기간의 답장도 한 통씩 더해진다', async () => {
  const { insertInboundEmail, insertReply, countOutboundRecipientsSince } =
    await loadFreshMailboxModule()
  const mail = await insertInboundEmail(sample())
  const since = Date.now() - 60_000
  const before = await countOutboundRecipientsSince(since)
  await insertReply({ email_id: mail.id, subject: 'Re: x', body_html: '<p>x</p>' })
  assert.equal(await countOutboundRecipientsSince(since), before + 1)
})

test('전체 답장은 받은 사람 수(recipient_count)만큼 24시간 합계에 더해진다', async () => {
  const { insertInboundEmail, insertReply, countOutboundRecipientsSince } =
    await loadFreshMailboxModule()
  const mail = await insertInboundEmail(sample())
  const since = Date.now() - 60_000
  const before = await countOutboundRecipientsSince(since)
  await insertReply({
    email_id: mail.id,
    subject: 'Re: x',
    body_html: '<p>x</p>',
    to_address: 'a@a.org',
    cc_addresses: ['b@a.org', 'c@a.org'],
    recipient_count: 3,
  })
  await insertReply({
    email_id: mail.id,
    subject: 'Re: x',
    body_html: '<p>x</p>',
    to_address: 'z@test.local',
    recipient_count: 0,
  })
  assert.equal(await countOutboundRecipientsSince(since), before + 3)
})

test('답장 기록: 받는 사람·참조를 남기고, 보낸 편지함은 그 주소를 보여 주며 참조로도 찾힌다', async () => {
  const mod = await loadFreshMailboxModule()
  const tag = Math.random().toString(36).slice(2)
  const mail = await mod.insertInboundEmail(sample({ from_address: `orig-${tag}@a.org` }))
  await mod.insertReply({
    email_id: mail.id,
    subject: `Re: 기록-${tag}`,
    body_html: '<p>x</p>',
    to_address: `desk-${tag}@c.org`,
    cc_addresses: [`peer-${tag}@a.org`],
    recipient_count: 2,
  })
  const [reply] = await mod.listRepliesForEmail(mail.id)
  assert.equal(reply.to_address, `desk-${tag}@c.org`)
  assert.deepEqual(JSON.parse(reply.cc_addresses), [`peer-${tag}@a.org`])
  assert.equal(reply.recipient_count, 2)

  const byCc = await mod.listSentMail({
    limit: 10,
    offset: 0,
    kind: 'reply',
    search: `peer-${tag}`,
  })
  assert.equal(byCc.items.length, 1)
  assert.deepEqual(JSON.parse(byCc.items[0].to_addresses), [`desk-${tag}@c.org`])
  // 원본 발신자로는 이제 찾히지 않는다 — 답장은 그 주소로 가지 않았다.
  const byOrig = await mod.listSentMail({
    limit: 10,
    offset: 0,
    kind: 'reply',
    search: `orig-${tag}`,
  })
  assert.equal(byOrig.items.length, 0)
})

test('받는 사람을 기록하지 않은 옛 답장은 원본 발신자를 받는 사람으로 보이고 한 명으로 센다', async () => {
  const mod = await loadFreshMailboxModule()
  const tag = Math.random().toString(36).slice(2)
  const mail = await mod.insertInboundEmail(sample({ from_address: `old-${tag}@a.org` }))
  await mod.insertReply({ email_id: mail.id, subject: `Re: 옛-${tag}`, body_html: '<p>x</p>' })
  const [reply] = await mod.listRepliesForEmail(mail.id)
  assert.equal(reply.to_address, null)
  assert.equal(reply.cc_addresses, null)
  assert.equal(reply.recipient_count, 1)
  const found = await mod.listSentMail({
    limit: 10,
    offset: 0,
    kind: 'reply',
    search: `old-${tag}`,
  })
  assert.deepEqual(JSON.parse(found.items[0].to_addresses), [`old-${tag}@a.org`])
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

test('멈춘 행 확정: unknown은 바로, sending은 오래됐을 때만 바꾼다', async () => {
  const { insertOutboundSending, markOutboundStatus, resolveOutboundStatus, getOutboundEmail } =
    await loadFreshMailboxModule()
  const staleBefore = Date.now() + 60_000 // 지금 만든 행도 "오래된" 것으로 보이게
  const freshBefore = Date.now() - 60_000 // 방금 만든 행은 "새것"

  const unknown = await insertOutboundSending(outboundInput({ recipient_count: 3 }))
  await markOutboundStatus(unknown.row.id, 'unknown', '타임아웃')
  assert.equal(await resolveOutboundStatus(unknown.row.id, 'sent', freshBefore), 'updated')
  const sent = await getOutboundEmail(unknown.row.id)
  assert.equal(sent.status, 'sent')
  assert.equal(typeof sent.sent_at, 'string')
  assert.equal(sent.error, null)

  const sendingNew = await insertOutboundSending(outboundInput())
  assert.equal(
    await resolveOutboundStatus(sendingNew.row.id, 'failed', freshBefore),
    'conflict',
    '지금 나가는 중일 수 있는 sending은 못 바꾼다'
  )
  assert.equal((await getOutboundEmail(sendingNew.row.id)).status, 'sending')

  const sendingOld = await insertOutboundSending(outboundInput())
  assert.equal(await resolveOutboundStatus(sendingOld.row.id, 'failed', staleBefore), 'updated')
  assert.equal((await getOutboundEmail(sendingOld.row.id)).status, 'failed')
})

test('멈춘 행 확정: 이미 정해졌거나 없는 행은 conflict·missing이고 되돌리지 못한다', async () => {
  const { insertOutboundSending, markOutboundSent, resolveOutboundStatus, getOutboundEmail } =
    await loadFreshMailboxModule()
  const done = await insertOutboundSending(outboundInput())
  await markOutboundSent(done.row.id, 're_x')
  assert.equal(await resolveOutboundStatus(done.row.id, 'failed', Date.now() + 60_000), 'conflict')
  assert.equal((await getOutboundEmail(done.row.id)).status, 'sent')
  assert.equal(await resolveOutboundStatus(crypto.randomUUID(), 'sent', Date.now()), 'missing')
})

test('확정한 failed는 24시간 한도에서 빠지고 unknown은 계속 센다', async () => {
  const {
    insertOutboundSending,
    markOutboundStatus,
    resolveOutboundStatus,
    countOutboundRecipientsSince,
  } = await loadFreshMailboxModule()
  const since = Date.now() - 60_000
  const base = await countOutboundRecipientsSince(since)
  const a = await insertOutboundSending(outboundInput({ recipient_count: 6 }))
  await markOutboundStatus(a.row.id, 'unknown', null)
  assert.equal(await countOutboundRecipientsSince(since), base + 6)
  await resolveOutboundStatus(a.row.id, 'failed', Date.now())
  assert.equal(await countOutboundRecipientsSince(since), base)
})

test('오래된 sending만 unknown으로 옮기고 sent·failed는 건드리지 않는다', async () => {
  const { insertOutboundSending, markOutboundSent, markStaleSendingAsUnknown, getOutboundEmail } =
    await loadFreshMailboxModule()
  const stuck = await insertOutboundSending(outboundInput())
  const done = await insertOutboundSending(outboundInput())
  await markOutboundSent(done.row.id, null)

  // 방금 만든 행은 기준보다 새것이라 옮기지 않는다.
  assert.equal(await markStaleSendingAsUnknown(Date.now() - 60_000), 0)
  assert.equal((await getOutboundEmail(stuck.row.id)).status, 'sending')

  const moved = await markStaleSendingAsUnknown(Date.now() + 60_000)
  assert.ok(moved >= 1)
  const after = await getOutboundEmail(stuck.row.id)
  assert.equal(after.status, 'unknown')
  assert.match(after.error, /확인이 필요/)
  assert.equal((await getOutboundEmail(done.row.id)).status, 'sent')
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

// ── 보낸 편지함 검색 ──────────────────────────────────────────────────────────

test('보낸 편지함 검색: 제목·받는 사람·참조를 찾고 숨은참조는 찾지 않는다', async () => {
  const { insertOutboundSending, listSentMail } = await loadFreshMailboxModule()
  const tag = `srch${Math.random().toString(36).slice(2, 8)}`
  const bySubject = await insertOutboundSending(outboundInput({ subject: `제목-${tag}-끝` }))
  const byTo = await insertOutboundSending(
    outboundInput({ to_addresses: [`to-${tag}@example.com`], bcc_addresses: [] })
  )
  const byCc = await insertOutboundSending(
    outboundInput({ cc_addresses: [`cc-${tag}@example.com`], bcc_addresses: [] })
  )
  const byBcc = await insertOutboundSending(
    outboundInput({ subject: '숨은참조 검색 금지', bcc_addresses: [`bcc-${tag}@example.com`] })
  )

  const ids = async search =>
    (await listSentMail({ limit: 100, offset: 0, kind: 'all', search })).items.map(i => i.id)

  assert.ok((await ids(`제목-${tag}`)).includes(bySubject.row.id))
  assert.ok((await ids(`to-${tag}`)).includes(byTo.row.id))
  assert.ok((await ids(`cc-${tag}`)).includes(byCc.row.id))
  // 핵심 보안 단언: BCC 주소로는 어떤 경로로도 찾을 수 없다(찾히면 이사·감사가 BCC를 추측할 수 있다).
  assert.deepEqual(await ids(`bcc-${tag}`), [])
  assert.deepEqual(await ids(`bcc-${tag}@example.com`), [])
  assert.ok(!(await ids(tag)).includes(byBcc.row.id), '제목에 tag가 없는 BCC 행이 나오면 안 된다')
})

test('보낸 편지함 검색: 답장은 제목과 원본 발신자로 찾는다', async () => {
  const { insertInboundEmail, insertReply, listSentMail } = await loadFreshMailboxModule()
  const tag = `rply${Math.random().toString(36).slice(2, 8)}`
  const mail = await insertInboundEmail(sample({ from_address: `asker-${tag}@example.com` }))
  await insertReply({ email_id: mail.id, subject: `Re: ${tag} 문의`, body_html: '<p>r</p>' })

  const bySubject = await listSentMail({ limit: 50, offset: 0, kind: 'all', search: `${tag} 문의` })
  const byAddress = await listSentMail({
    limit: 50,
    offset: 0,
    kind: 'reply',
    search: `asker-${tag}`,
  })
  assert.equal(bySubject.items.length, 1)
  assert.equal(byAddress.items.length, 1)
  assert.equal(byAddress.items[0].kind, 'reply')
})

test('보낸 편지함 검색: % _ 는 와일드카드가 아니라 글자이고 전체 개수도 검색을 따른다', async () => {
  const { insertOutboundSending, listSentMail } = await loadFreshMailboxModule()
  const tag = `wild${Math.random().toString(36).slice(2, 6)}`
  await insertOutboundSending(outboundInput({ subject: `100% 확정 ${tag}` }))
  await insertOutboundSending(outboundInput({ subject: `1000 확정 ${tag}` }))

  const percent = await listSentMail({
    limit: 50,
    offset: 0,
    kind: 'compose',
    search: `100% 확정 ${tag}`,
  })
  assert.equal(percent.items.length, 1, '%가 와일드카드로 해석되면 두 건이 나온다')
  assert.equal(percent.total_count, 1)

  const underscore = await listSentMail({
    limit: 50,
    offset: 0,
    kind: 'compose',
    search: `_000 확정 ${tag}`,
  })
  assert.equal(underscore.items.length, 0, '_가 한 글자 와일드카드면 1000 확정이 걸린다')

  const none = await listSentMail({
    limit: 50,
    offset: 0,
    kind: 'all',
    search: `없는검색어-${tag}-zzz`,
  })
  assert.equal(none.total_count, 0)
  assert.deepEqual(none.items, [])
})

test('검색어가 비었거나 공백이면 검색하지 않는다', async () => {
  const { listSentMail } = await loadFreshMailboxModule()
  const all = await listSentMail({ limit: 5, offset: 0, kind: 'all' })
  const blank = await listSentMail({ limit: 5, offset: 0, kind: 'all', search: '   ' })
  assert.equal(blank.total_count, all.total_count)
})
