import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import {
  normalizeLabelName,
  isMailLabelColor,
  labelColorClass,
  MAIL_LABEL_COLORS,
} from '../../src/lib/mail/labels.ts'

const DB_PATH = 'scripts/testing/.queries-mailbox-labels-test.db'
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
const labels = await import('../../src/db/queries/mailboxLabels.ts')
const mailbox = await import('../../src/db/queries/mailbox.ts')

async function admin() {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email) values (?, '라벨관리자', ?)`,
    args: [id, `${id}@labels.example`],
  })
  return id
}

function mail() {
  return mailbox.insertInboundEmail({
    resend_email_id: `re_${crypto.randomUUID()}`,
    from_address: 'sender@example.com',
    to_addresses: ['contact@ggac.kr'],
    received_for: ['contact@ggac.kr'],
    subject: '라벨 시험',
    received_at: new Date(),
  })
}

function uniqueName(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

test('이름은 앞뒤·연속 공백을 정리하고 1~30자만 받는다', () => {
  assert.equal(normalizeLabelName('  총회   자료 '), '총회 자료')
  assert.equal(normalizeLabelName('   '), null)
  assert.equal(normalizeLabelName('x'.repeat(31)), null)
  assert.equal(normalizeLabelName(42), null)
})

test('색은 팔레트 키만 받고, 모르는 값은 회색으로 그린다', () => {
  assert.equal(isMailLabelColor('blue'), true)
  assert.equal(isMailLabelColor('#ff0000'), false)
  assert.equal(isMailLabelColor('constructor'), false)
  assert.equal(labelColorClass('nope'), MAIL_LABEL_COLORS.gray)
})

test('같은 이름은 대소문자만 달라도 만들 수 없다 — DB 유일 인덱스가 막는다', async () => {
  const name = uniqueName('Press')
  const first = await labels.createLabel({ name, color: 'blue' })
  assert.notEqual(first, 'duplicate')
  assert.equal(await labels.createLabel({ name: name.toUpperCase(), color: 'red' }), 'duplicate')
  const other = await labels.createLabel({ name: uniqueName('Other'), color: 'red' })
  assert.equal(await labels.updateLabel({ id: other.id, name: name.toLowerCase() }), 'duplicate')
  assert.equal(await labels.updateLabel({ id: crypto.randomUUID(), color: 'red' }), 'missing')
})

test('붙이기는 멱등이고 없는 메일은 missing, 떼기는 그 라벨만 뗀다', async () => {
  const by = await admin()
  const a = await mail()
  const b = await mail()
  const ghost = crypto.randomUUID()
  const label = await labels.createLabel({ name: uniqueName('후원'), color: 'green' })
  const keep = await labels.createLabel({ name: uniqueName('총회'), color: 'blue' })

  const first = await labels.setLabelOnEmails({
    labelId: label.id,
    emailIds: [a.id, b.id, ghost],
    action: 'add',
    by,
  })
  assert.deepEqual(new Set(first.changed), new Set([a.id, b.id]))
  assert.deepEqual(first.missing, [ghost])
  const again = await labels.setLabelOnEmails({
    labelId: label.id,
    emailIds: [a.id],
    action: 'add',
    by,
  })
  assert.deepEqual(again.changed, [], '이미 붙은 라벨은 다시 붙지 않는다')
  await labels.setLabelOnEmails({ labelId: keep.id, emailIds: [a.id], action: 'add', by })

  const removed = await labels.setLabelOnEmails({
    labelId: label.id,
    emailIds: [a.id],
    action: 'remove',
    by,
  })
  assert.deepEqual(removed.changed, [a.id])
  assert.deepEqual(
    (await labels.listLabelsForEmail(a.id)).map(l => l.id),
    [keep.id],
    '다른 라벨은 그대로'
  )
})

test('목록은 라벨로 거르고 행마다 라벨을 이름순으로 싣는다, 라벨 목록은 메일 수를 센다', async () => {
  const by = await admin()
  const a = await mail()
  const b = await mail()
  const zed = await labels.createLabel({ name: uniqueName('하'), color: 'gray' })
  const abc = await labels.createLabel({ name: uniqueName('가'), color: 'pink' })
  await labels.setLabelOnEmails({ labelId: zed.id, emailIds: [a.id], action: 'add', by })
  await labels.setLabelOnEmails({ labelId: abc.id, emailIds: [a.id, b.id], action: 'add', by })

  const filtered = await mailbox.listInboundEmails({ limit: 100, offset: 0, labelId: zed.id })
  assert.deepEqual(
    filtered.emails.map(e => e.id),
    [a.id]
  )
  assert.deepEqual(
    filtered.emails[0].labels.map(l => l.id),
    [abc.id, zed.id]
  )
  const all = await labels.listLabels()
  assert.equal(all.find(l => l.id === abc.id).email_count, 2)
})

test('라벨을 지우면 메일과의 연결만 지워지고 메일은 남는다', async () => {
  const by = await admin()
  const a = await mail()
  const label = await labels.createLabel({ name: uniqueName('지울'), color: 'red' })
  await labels.setLabelOnEmails({ labelId: label.id, emailIds: [a.id], action: 'add', by })
  assert.equal(await labels.deleteLabel(label.id), true)
  assert.equal(await labels.deleteLabel(label.id), false)
  assert.ok(await mailbox.getInboundEmail(a.id))
  const left = await setupClient.execute({
    sql: 'select count(*) as n from inbound_email_labels where label_id = ?',
    args: [label.id],
  })
  assert.equal(Number(left.rows[0].n), 0)
})
