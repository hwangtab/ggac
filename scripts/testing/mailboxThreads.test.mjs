import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { migrationFiles } from './apply-migrations.mjs'
import { referencedMessageIds, MAX_REFERENCED_IDS } from '../../src/lib/mail/threading.ts'

/**
 * 대화 묶기 — 헤더 파싱(`referencedMessageIds`)과 0038 백필 SQL이 `assignThread`와 같은 대화를 내는지 본다.
 * 둘이 갈리면 옛 메일과 새 메일이 같은 대화인데도 따로 보인다.
 */

const DB_PATH = 'scripts/testing/.mailbox-threads-test.db'
const BACKFILL_TAG = '0038_mailbox_threads'

test('In-Reply-To가 앞, References는 가까운 조상부터 모으고 중복은 뺀다', () => {
  const ids = referencedMessageIds({
    'in-reply-to': '<c@x>',
    references: '<a@x> <b@x>\r\n <c@x>',
  })
  assert.deepEqual(ids, ['<c@x>', '<b@x>', '<a@x>'])
})

test('헤더 키는 대소문자를 가리지 않고 JSON 문자열도 받는다', () => {
  assert.deepEqual(referencedMessageIds(JSON.stringify({ 'In-Reply-To': '<a@x>' })), ['<a@x>'])
  assert.deepEqual(referencedMessageIds({ References: ['<a@x>', '<b@x>'] }), ['<b@x>', '<a@x>'])
})

test('깨졌거나 없는 헤더는 빈 배열이다 — 던지지 않는다', () => {
  for (const value of [null, undefined, '', '{not json', '[]', 42, { subject: 'x' }]) {
    assert.deepEqual(referencedMessageIds(value), [], JSON.stringify(value))
  }
})

test('꺾쇠로 감싼 ID만 본다 — 맨 문자열이나 공백 섞인 조각은 무시한다', () => {
  assert.deepEqual(referencedMessageIds({ references: 'a@x <b@x> <c d@x>' }), ['<b@x>'])
})

test(`ID는 ${MAX_REFERENCED_IDS}개까지만 따라간다`, () => {
  const many = Array.from({ length: 80 }, (_, i) => `<m${i}@x>`).join(' ')
  const ids = referencedMessageIds({ references: many })
  assert.equal(ids.length, MAX_REFERENCED_IDS)
  assert.equal(ids[0], '<m79@x>', '가까운 조상부터')
})

// 0038 백필 대조 — 0038 직전 스키마에 옛 행을 심고 적용한 뒤 기대한 대화와 견준다.
// 각 행: [id, message_id, received_at(분), headers, 기대 대화]
const T = minute => Date.UTC(2026, 0, 1, 0, minute)
const LEGACY = [
  // References가 조상을 다 싣는 보통의 사슬 A ← B ← C
  ['a', '<a@x>', 0, { 'message-id': '<a@x>' }, 'a'],
  ['b', '<b@x>', 1, { 'in-reply-to': '<ours-1@resend>', references: '<a@x> <ours-1@resend>' }, 'a'],
  ['c', '<c@x>', 2, { 'in-reply-to': '<b@x>', references: '<a@x> <ours-1@resend> <b@x>' }, 'a'],
  // In-Reply-To만으로 이어진 사슬 D ← E ← F — 뒤 UPDATE들이 거슬러 올라야 한다
  ['d', '<d@x>', 3, {}, 'd'],
  ['e', '<e@x>', 4, { 'in-reply-to': '<d@x>' }, 'd'],
  ['f', '<f@x>', 5, { 'in-reply-to': '<e@x>' }, 'd'],
  // 우리에게 없는 메일만 가리키면 자기 대화
  ['g', '<g@x>', 6, { references: '<unknown@elsewhere>' }, 'g'],
  // 헤더가 깨진 JSON — json_extract가 실패하지 않고 자기 대화가 된다
  ['h', '<h@x>', 7, '{broken', 'h'],
  // 나중에 받은 메일을 가리키는 것은 앞 메일이 아니다 — I(8분)가 J(9분)를 가리켜도 묶지 않는다
  ['i', '<i@x>', 8, { references: '<j@x>' }, 'i'],
  ['j', '<j@x>', 9, { references: '<i@x>' }, 'i'],
  // 앞뒤가 붙은 다른 ID에 걸리지 않는다 — '<a@x>'를 품은 '<xa@x>'는 a가 아니다
  ['k', '<k@x>', 10, { references: '<xa@x>' }, 'k'],
]

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  const files = migrationFiles()
  const index = files.findIndex(file => file.endsWith(`/${BACKFILL_TAG}.sql`))
  assert.ok(index > 0, '원장에 0038이 있어야 한다')
  for (const file of files.slice(0, index)) {
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
  for (const [id, messageId, minute, headers] of LEGACY) {
    await client.execute({
      sql: `insert into inbound_emails (id, resend_email_id, message_id, from_address, to_addresses, headers, received_at)
            values (?, ?, ?, 'x@y.org', '[]', ?, ?)`,
      args: [
        id,
        `re_${id}`,
        messageId,
        typeof headers === 'string' ? headers : JSON.stringify(headers),
        T(minute),
      ],
    })
  }
  for (const file of files.slice(index)) {
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('0038 백필은 기대한 대화로 묶는다', async () => {
  const { rows } = await client.execute('select id, thread_id from inbound_emails')
  const actual = Object.fromEntries(rows.map(row => [row.id, row.thread_id]))
  const expected = Object.fromEntries(LEGACY.map(([id, , , , thread]) => [id, thread]))
  assert.deepEqual(actual, expected)
})

test('백필 결과는 assignThread 규칙(가리킨 앞 메일 중 가장 먼저 받은 것의 대화)과 같다', async () => {
  const { rows } = await client.execute(
    'select id, message_id, headers, received_at, thread_id from inbound_emails order by received_at'
  )
  const byMessageId = new Map(rows.map(row => [row.message_id, row]))
  const resolved = new Map()
  for (const row of rows) {
    const parents = referencedMessageIds(row.headers)
      .map(id => byMessageId.get(id))
      .filter(p => p && p.id !== row.id && Number(p.received_at) <= Number(row.received_at))
      .sort(
        (x, y) =>
          Number(x.received_at) - Number(y.received_at) || String(x.id).localeCompare(String(y.id))
      )
    resolved.set(row.id, parents.length > 0 ? resolved.get(parents[0].id) : row.id)
    assert.equal(row.thread_id, resolved.get(row.id), `행 ${row.id}`)
  }
})
