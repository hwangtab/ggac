import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { snoozePresets, checkSnoozeUntil } from '../../src/lib/mail/snooze.ts'
import { buildSnoozePush } from '../../src/lib/mail/assigneePush.ts'

const DB_PATH = 'scripts/testing/.mailbox-snooze-test.db'
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
const mailbox = await import('../../src/db/queries/mailbox.ts')

const seoul = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16)

test('고르기 칸은 서울 기준 — 저녁 6시는 한 시간 넘게 남았을 때만, 다음 주 월요일은 월요일에도 7일 뒤', () => {
  // 목요일 낮 12시(서울)
  const thursdayNoon = new Date('2026-11-05T03:00:00Z')
  assert.deepEqual(
    snoozePresets(thursdayNoon).map(p => [p.key, seoul(p.at)]),
    [
      ['evening', '2026-11-05T18:00'],
      ['tomorrow', '2026-11-06T09:00'],
      ['next_monday', '2026-11-09T09:00'],
    ]
  )
  // 목요일 저녁 5시 30분(서울) — 저녁 6시까지 한 시간이 안 남았다
  assert.deepEqual(
    snoozePresets(new Date('2026-11-05T08:30:00Z')).map(p => p.key),
    ['tomorrow', 'next_monday']
  )
  // 월요일 오전 10시(서울)
  const monday = snoozePresets(new Date('2026-11-09T01:00:00Z'))
  assert.equal(seoul(monday.find(p => p.key === 'next_monday').at), '2026-11-16T09:00')
  // 서울 토요일 밤 11시(UTC 토요일 14시) — "내일"은 서울 달력으로 일요일이다
  const lateSaturdayUtc = snoozePresets(new Date('2026-11-07T14:00:00Z'))
  assert.equal(seoul(lateSaturdayUtc.find(p => p.key === 'tomorrow').at), '2026-11-08T09:00')
})

test('다시 알림 시각은 30분 뒤 ~ 1년 안', () => {
  const now = new Date('2026-11-05T00:00:00Z')
  assert.equal(checkSnoozeUntil(new Date(now.getTime() + 10 * 60e3), now).ok, false)
  assert.equal(checkSnoozeUntil(new Date(now.getTime() + 31 * 60e3), now).ok, true)
  assert.equal(checkSnoozeUntil(new Date(now.getTime() + 366 * 86400e3), now).ok, false)
  assert.equal(checkSnoozeUntil(new Date(NaN), now).ok, false)
})

test('깨운 푸시는 이사회 메일함의 그 메일로 연결된다', () => {
  assert.deepEqual(buildSnoozePush({ emailId: 'm1', subject: '총회 안내' }), {
    title: '다시 볼 메일입니다',
    body: '총회 안내',
    url: '/board-room/mailbox?mail=m1',
    tag: 'mailbox-snooze-m1',
  })
})

async function person() {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email) values (?, '알림받는사람', ?)`,
    args: [id, `${id}@snooze.example`],
  })
  return id
}

function mail(subject = '다시 알림 시험') {
  return mailbox.insertInboundEmail({
    resend_email_id: `re_${crypto.randomUUID()}`,
    from_address: `snooze-${Math.random().toString(36).slice(2)}@a.org`,
    to_addresses: ['contact@ggac.kr'],
    received_for: ['contact@ggac.kr'],
    subject,
    received_at: new Date(),
  })
}

test('다시 알림 중인 메일은 기본 목록에서 빠지고, "다시 알림" 보기와 검색에는 나온다', async () => {
  const by = await person()
  const now = new Date('2026-11-05T00:00:00Z')
  const snoozed = await mail('숨길 메일')
  const plain = await mail('보일 메일')
  await mailbox.setInboundSnooze({ id: snoozed.id, until: new Date('2026-11-06T00:00:00Z'), by })

  const ids = async snoozedOption =>
    (
      await mailbox.listInboundEmails({ limit: 100, offset: 0, snoozed: snoozedOption, now })
    ).emails.map(e => e.id)
  assert.ok(!(await ids('hide')).includes(snoozed.id))
  assert.ok((await ids('hide')).includes(plain.id))
  assert.deepEqual(
    (await ids('only')).filter(id => id === snoozed.id || id === plain.id),
    [snoozed.id]
  )
  assert.ok((await ids('include')).includes(snoozed.id))
  // 목록 행이 시각을 싣는다 — 화면의 배지·"풀기"가 이 값을 본다(빠지면 "다시 알림: 없음"으로 보인다)
  const onlyRows = (
    await mailbox.listInboundEmails({ limit: 100, offset: 0, snoozed: 'only', now })
  ).emails
  assert.ok(onlyRows.find(e => e.id === snoozed.id).snoozed_until)

  // 시각이 지났으면(크론이 비우기 전이라도) 숨기지 않는다
  const later = new Date('2026-11-07T00:00:00Z')
  const after = (
    await mailbox.listInboundEmails({ limit: 100, offset: 0, snoozed: 'hide', now: later })
  ).emails
  assert.ok(after.some(e => e.id === snoozed.id))
})

test('깨우기: 시각이 지난 메일만 안 읽음으로 되돌리고 시각을 비운다 — 스팸은 그대로, 두 번째는 빈 결과', async () => {
  const by = await person()
  const assignee = await person()
  const now = new Date('2026-11-10T00:00:00Z')
  const due = await mail('깨울 메일')
  await mailbox.updateInboundStatus(due.id, 'unread', 'archived')
  await mailbox.setInboundAssignee({ id: due.id, expected: null, next: assignee, by })
  await mailbox.setInboundSnooze({ id: due.id, until: new Date('2026-11-09T00:00:00Z'), by })
  const spam = await mail('스팸 메일')
  await mailbox.updateInboundStatus(spam.id, 'unread', 'spam')
  await mailbox.setInboundSnooze({ id: spam.id, until: new Date('2026-11-09T00:00:00Z'), by })
  const notYet = await mail('아직')
  await mailbox.setInboundSnooze({ id: notYet.id, until: new Date('2026-11-11T00:00:00Z'), by })

  const woken = await mailbox.wakeSnoozedEmails(now)
  const byId = Object.fromEntries(woken.map(w => [w.id, w]))
  assert.ok(byId[due.id])
  assert.equal(byId[due.id].assigned_to, assignee)
  assert.equal(byId[due.id].snoozed_by, by)
  assert.ok(byId[spam.id])
  assert.equal(byId[notYet.id], undefined)

  const dueRow = await mailbox.getInboundEmail(due.id)
  assert.equal(dueRow.status, 'unread')
  assert.equal(dueRow.snoozed_until, null)
  assert.equal((await mailbox.getInboundEmail(spam.id)).status, 'spam')
  assert.ok((await mailbox.getInboundEmail(notYet.id)).snoozed_until)

  assert.deepEqual(
    (await mailbox.wakeSnoozedEmails(now)).filter(w => [due.id, spam.id].includes(w.id)),
    []
  )
})

test('풀기는 시각과 건 사람을 비우고, 없는 메일은 missing', async () => {
  const by = await person()
  const row = await mail()
  await mailbox.setInboundSnooze({ id: row.id, until: new Date('2027-01-01T00:00:00Z'), by })
  assert.equal(await mailbox.setInboundSnooze({ id: row.id, until: null, by }), 'updated')
  const cleared = await mailbox.getInboundEmail(row.id)
  assert.equal(cleared.snoozed_until, null)
  assert.equal(cleared.snoozed_by, null)
  assert.equal(
    await mailbox.setInboundSnooze({ id: crypto.randomUUID(), until: null, by }),
    'missing'
  )
})
