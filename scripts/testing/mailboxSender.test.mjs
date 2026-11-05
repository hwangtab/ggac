import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { migrationFiles } from './apply-migrations.mjs'
import { parseMailbox, normalizeSenderDomain, domainOf } from '../../src/lib/mail/senderAddress.ts'

/**
 * 발신자 정규화 — `parseMailbox`(새 행)와 0037의 백필 SQL(기존 행)이 같은 답을 내는지 본다.
 * 둘이 갈리면 같은 사람의 옛 메일과 새 메일이 발신자 필터에서 서로 다른 사람이 된다.
 */

const DB_PATH = 'scripts/testing/.mailbox-sender-test.db'
const BACKFILL_TAG = '0037_mailbox_sender'

// 백필 대조에 쓰는 원문들 — 웹훅 `from`이 실제로 가질 수 있는 꼴.
const SAMPLES = [
  'sender@example.com',
  'Sender@Example.COM',
  '  spaced@example.com  ',
  '홍길동 <Hong@A.org>',
  '"홍길동" <hong@a.org>',
  '"Kim, Minsu" <kim@b.org>',
  '<only@bracket.org>',
  '  "" <empty-name@c.org>',
  'Tab\tName\t<tab@d.org>',
  'broken > order < x@e.org',
  'no-close <oops@f.org',
  '',
]

test('표시 이름과 주소를 나누고 주소는 소문자로 만든다', () => {
  assert.deepEqual(parseMailbox('홍길동 <Hong@A.org>'), { email: 'hong@a.org', name: '홍길동' })
  assert.deepEqual(parseMailbox('"Kim, Minsu" <kim@b.org>'), {
    email: 'kim@b.org',
    name: 'Kim, Minsu',
  })
})

test('꺾쇠가 없으면 통째로 주소이고 이름은 없다', () => {
  assert.deepEqual(parseMailbox(' Sender@Example.com '), {
    email: 'sender@example.com',
    name: null,
  })
})

test('이름 자리가 비었거나 따옴표뿐이면 이름은 null이다', () => {
  assert.equal(parseMailbox('<only@bracket.org>').name, null)
  assert.equal(parseMailbox('"" <x@y.org>').name, null)
})

test('문자열이 아니면 빈 주소다 — 웹훅 JSON이 엉뚱한 값을 줘도 던지지 않는다', () => {
  assert.deepEqual(parseMailbox(undefined), { email: '', name: null })
  assert.deepEqual(parseMailbox(42), { email: '', name: null })
})

test('도메인 입력은 @를 떼고 소문자로, 도메인 글자가 아니면 거부한다', () => {
  assert.equal(normalizeSenderDomain('@A.Org'), 'a.org')
  assert.equal(normalizeSenderDomain('mail.ggac.kr'), 'mail.ggac.kr')
  assert.equal(normalizeSenderDomain('a%.org'), null)
  assert.equal(normalizeSenderDomain('a_b.org'), null)
  assert.equal(normalizeSenderDomain(''), null)
  assert.equal(normalizeSenderDomain('-a.org'), null)
})

test('주소에서 도메인을 뽑는다', () => {
  assert.equal(domainOf('hong@a.org'), 'a.org')
  assert.equal(domainOf('no-at'), null)
  assert.equal(domainOf('trailing@'), null)
})

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  const files = migrationFiles()
  const backfillIndex = files.findIndex(file => file.endsWith(`/${BACKFILL_TAG}.sql`))
  assert.ok(backfillIndex > 0, '원장에 0037이 있어야 한다')
  // 0037 직전까지 적용하고 옛 행을 심은 뒤 0037을 적용한다 — 운영 DB가 겪는 순서 그대로.
  for (const file of files.slice(0, backfillIndex)) {
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
  for (const [i, from] of SAMPLES.entries()) {
    await client.execute({
      sql: `insert into inbound_emails (id, resend_email_id, from_address, to_addresses, received_at)
            values (?, ?, ?, '[]', ?)`,
      args: [`legacy-${i}`, `re_legacy_${i}`, from, Date.now()],
    })
  }
  for (const file of files.slice(backfillIndex)) {
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('0037 백필 SQL은 parseMailbox와 같은 주소·이름을 낸다', async () => {
  const { rows } = await client.execute(
    `select from_address, from_email, from_name from inbound_emails where id like 'legacy-%'`
  )
  assert.equal(rows.length, SAMPLES.length)
  for (const row of rows) {
    const expected = parseMailbox(row.from_address)
    assert.deepEqual(
      { email: row.from_email ?? '', name: row.from_name ?? null },
      expected,
      `원문: ${JSON.stringify(row.from_address)}`
    )
  }
})
