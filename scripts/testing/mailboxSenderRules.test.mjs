import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import {
  normalizeRuleValue,
  isPublicMailDomain,
  combineRules,
} from '../../src/lib/mail/senderRules.ts'

const DB_PATH = 'scripts/testing/.mailbox-sender-rules-test.db'
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
const rules = await import('../../src/db/queries/mailboxRules.ts')
const labels = await import('../../src/db/queries/mailboxLabels.ts')
const mailbox = await import('../../src/db/queries/mailbox.ts')
const { applySenderRules } = await import('../../src/lib/mail/applySenderRules.ts')

async function admin() {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email) values (?, '규칙관리자', ?)`,
    args: [id, `${id}@rules.example`],
  })
  return id
}

function tag() {
  return Math.random().toString(36).slice(2, 8)
}

function mail(from) {
  return mailbox.insertInboundEmail({
    resend_email_id: `re_${crypto.randomUUID()}`,
    from_address: from,
    to_addresses: ['contact@ggac.kr'],
    received_for: ['contact@ggac.kr'],
    subject: '규칙 시험',
    received_at: new Date(),
  })
}

test('조건 값 정규화 — 주소는 꺾쇠 안만, 도메인은 @를 떼고, 형식이 아니면 null', () => {
  assert.equal(normalizeRuleValue('address', '광고 <Ads@Promo.CO.kr>'), 'ads@promo.co.kr')
  assert.equal(normalizeRuleValue('address', 'not-an-address'), null)
  assert.equal(normalizeRuleValue('domain', '@Promo.co.kr'), 'promo.co.kr')
  assert.equal(normalizeRuleValue('domain', 'localhost'), null)
  assert.equal(normalizeRuleValue('domain', 'a..b.com'), null)
  assert.equal(normalizeRuleValue('domain', 42), null)
})

test('공용 메일 도메인을 알아본다', () => {
  assert.equal(isPublicMailDomain('Gmail.com'), true)
  assert.equal(isPublicMailDomain('naver.com'), true)
  assert.equal(isPublicMailDomain('ggac.kr'), false)
})

test('스팸이 보관보다 앞서고 라벨은 겹치지 않게 모두 붙인다', () => {
  assert.deepEqual(
    combineRules([
      { action: 'archive', label_id: null },
      { action: 'label', label_id: 'a' },
      { action: 'spam', label_id: null },
      { action: 'label', label_id: 'a' },
      { action: 'label', label_id: 'b' },
    ]),
    { status: 'spam', labelIds: ['a', 'b'] }
  )
  assert.deepEqual(combineRules([]), { status: null, labelIds: [] })
})

test('같은 규칙은 하나만 — 라벨 없는 규칙도, 라벨 규칙도', async () => {
  const by = await admin()
  const value = `dup-${tag()}@a.org`
  const label = await labels.createLabel({ name: `규칙라벨-${tag()}`, color: 'blue' })
  const base = { match_type: 'address', match_value: value, created_by: by }
  assert.notEqual(await rules.createRule({ ...base, action: 'spam', label_id: null }), 'duplicate')
  assert.equal(await rules.createRule({ ...base, action: 'spam', label_id: null }), 'duplicate')
  assert.notEqual(
    await rules.createRule({ ...base, action: 'archive', label_id: null }),
    'duplicate'
  )
  assert.notEqual(
    await rules.createRule({ ...base, action: 'label', label_id: label.id }),
    'duplicate'
  )
  assert.equal(
    await rules.createRule({ ...base, action: 'label', label_id: label.id }),
    'duplicate'
  )
})

test('맞추기는 주소 완전 일치·도메인 완전 일치다 — 하위 도메인·앞뒤가 붙은 도메인은 안 맞는다', async () => {
  const by = await admin()
  const domain = `d${tag()}.org`
  await rules.createRule({
    match_type: 'domain',
    match_value: domain,
    action: 'archive',
    label_id: null,
    created_by: by,
  })
  assert.equal((await rules.rulesForSender(`a@${domain}`)).length, 1)
  assert.equal((await rules.rulesForSender(`a@sub.${domain}`)).length, 0)
  assert.equal((await rules.rulesForSender(`a@x${domain}`)).length, 0)
  assert.equal((await rules.rulesForSender(null)).length, 0)
  assert.equal((await rules.rulesForSender('no-at-sign')).length, 0)
})

test('기존 메일에 적용: 상태 규칙은 안 읽음·읽음만 옮기고, 라벨 규칙은 모두에 붙인다', async () => {
  const by = await admin()
  const from = `old-${tag()}@a.org`
  const unread = await mail(from)
  const read = await mail(from)
  await mailbox.updateInboundStatus(read.id, 'unread', 'read')
  const replied = await mail(from)
  await mailbox.updateInboundStatus(replied.id, 'unread', 'replied')
  const other = await mail(`someone-${tag()}@a.org`)

  assert.equal(await rules.countMatchingEmails('address', from), 3)
  const moved = await rules.applyRuleToExisting({
    match_type: 'address',
    match_value: from,
    action: 'spam',
    label_id: null,
  })
  assert.equal(moved, 2)
  assert.equal((await mailbox.getInboundEmail(unread.id)).status, 'spam')
  assert.equal((await mailbox.getInboundEmail(read.id)).status, 'spam')
  assert.equal(
    (await mailbox.getInboundEmail(replied.id)).status,
    'replied',
    '사람이 정한 상태는 그대로'
  )
  assert.equal((await mailbox.getInboundEmail(other.id)).status, 'unread')

  const label = await labels.createLabel({ name: `소급-${tag()}`, color: 'green' })
  const labeled = await rules.applyRuleToExisting({
    match_type: 'address',
    match_value: from,
    action: 'label',
    label_id: label.id,
  })
  assert.equal(labeled, 3)
  assert.equal(
    await rules.applyRuleToExisting({
      match_type: 'address',
      match_value: from,
      action: 'label',
      label_id: label.id,
    }),
    0,
    '다시 적용해도 겹치지 않는다'
  )
  void by
})

test('받는 즉시 적용: 막 들어온 메일을 스팸으로 옮기고 라벨을 붙인다', async () => {
  const by = await admin()
  const from = `ads-${tag()}@promo.org`
  const label = await labels.createLabel({ name: `광고-${tag()}`, color: 'red' })
  await rules.createRule({
    match_type: 'address',
    match_value: from,
    action: 'spam',
    label_id: null,
    created_by: by,
  })
  await rules.createRule({
    match_type: 'address',
    match_value: from,
    action: 'label',
    label_id: label.id,
    created_by: by,
  })
  const row = await mail(`광고 <${from.toUpperCase()}>`)
  const outcome = await applySenderRules({ id: row.id, from_email: row.from_email })
  assert.deepEqual(outcome, { status: 'spam', labelIds: [label.id] })
  assert.equal((await mailbox.getInboundEmail(row.id)).status, 'spam')
  assert.deepEqual(
    (await labels.listLabelsForEmail(row.id)).map(l => l.id),
    [label.id]
  )
})

test('받는 즉시 적용: 그 사이 사람이 상태를 바꿨으면 상태는 건드리지 않는다', async () => {
  const by = await admin()
  const from = `late-${tag()}@a.org`
  await rules.createRule({
    match_type: 'address',
    match_value: from,
    action: 'archive',
    label_id: null,
    created_by: by,
  })
  const row = await mail(from)
  await mailbox.updateInboundStatus(row.id, 'unread', 'replied')
  await applySenderRules({ id: row.id, from_email: row.from_email })
  assert.equal((await mailbox.getInboundEmail(row.id)).status, 'replied')
})

test('규칙이 없으면 아무것도 바꾸지 않고, 라벨을 지우면 그 라벨 규칙도 지워진다', async () => {
  const by = await admin()
  const row = await mail(`nobody-${tag()}@a.org`)
  assert.deepEqual(await applySenderRules({ id: row.id, from_email: row.from_email }), {
    status: null,
    labelIds: [],
  })
  const label = await labels.createLabel({ name: `지울규칙-${tag()}`, color: 'gray' })
  const from = `cascade-${tag()}@a.org`
  await rules.createRule({
    match_type: 'address',
    match_value: from,
    action: 'label',
    label_id: label.id,
    created_by: by,
  })
  await labels.deleteLabel(label.id)
  assert.equal((await rules.rulesForSender(from)).length, 0)
})
