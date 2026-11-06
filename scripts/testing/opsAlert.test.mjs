import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

const { alertOpsAdmins, buildOpsAlertEmail } = await import('../../src/lib/server/opsAlert.ts')

/**
 * 운영 경보가 **관리자에게 실제로 닿는지**. 이 사이트는 Slack·Discord·Google Chat 을 쓰지 않아 웹훅 경보가
 * 한 번도 나가지 않았다(2026-11-05 사각지대 점검). 통로는 인앱 알림 + 메일 둘이고, 둘 다 실패해도 던지지 않아야 한다.
 */

const ADMINS = [
  { id: 'admin-1', email: 'a@example.com' },
  { id: 'admin-2', email: null },
]

function deps(overrides = {}) {
  const sent = []
  const notes = []
  return {
    sent,
    notes,
    listAdminRecipients: async () => ADMINS,
    createBulkNotifications: async input => {
      notes.push(input)
    },
    hasRecentSystemNotice: async () => false,
    sendEmail: async mail => {
      sent.push(mail)
    },
    isMailConfigured: () => true,
    now: () => new Date('2026-11-06T00:00:00Z'),
    log: { info() {}, warn() {} },
    ...overrides,
  }
}

test('관리자에게 인앱 알림 + 메일을 보낸다(이메일 없는 관리자는 인앱만)', async () => {
  const d = deps()
  const result = await alertOpsAdmins(
    { kind: 'ops_cron_problems', title: '크론이 멈췄습니다', message: 'mention-digest — 3시간째' },
    d
  )
  assert.equal(result, 'sent')
  assert.equal(d.notes.length, 1)
  assert.deepEqual(d.notes[0].user_ids, ['admin-1', 'admin-2'])
  assert.equal(d.notes[0].type, 'system_notice')
  assert.equal(d.notes[0].data.kind, 'ops_cron_problems')
  assert.equal(d.sent.length, 1, '이메일이 있는 관리자에게만 보낸다')
  assert.equal(d.sent[0].to, 'a@example.com')
  assert.match(d.sent[0].subject, /경기아트콜렉티브 운영/)
})

test('dedupe: 최근 6시간 안에 같은 종류를 알렸으면 아무것도 보내지 않는다', async () => {
  const d = deps({ hasRecentSystemNotice: async () => true })
  const result = await alertOpsAdmins(
    { kind: 'ops_cron_problems', title: 't', message: 'm', dedupe: true },
    d
  )
  assert.equal(result, 'skipped')
  assert.equal(d.notes.length, 0)
  assert.equal(d.sent.length, 0)
})

test('dedupe를 켜지 않으면 최근 공지와 무관하게 보낸다(되돌릴 수 없는 일)', async () => {
  const d = deps({ hasRecentSystemNotice: async () => true })
  const result = await alertOpsAdmins(
    { kind: 'member_documents_mass_delete', title: 't', message: 'm' },
    d
  )
  assert.equal(result, 'sent')
  assert.equal(d.notes.length, 1)
})

test('관리자가 없으면 failed — 조용히 성공한 척하지 않는다', async () => {
  const d = deps({ listAdminRecipients: async () => [] })
  assert.equal(await alertOpsAdmins({ kind: 'k', title: 't', message: 'm' }, d), 'failed')
})

test('메일 설정이 없으면(Resend 키 없음) 인앱 알림만 남기고 sent', async () => {
  const d = deps({ isMailConfigured: () => false })
  const result = await alertOpsAdmins({ kind: 'k', title: 't', message: 'm' }, d)
  assert.equal(result, 'sent')
  assert.equal(d.notes.length, 1)
  assert.equal(d.sent.length, 0)
})

test('메일이 던져도 경보는 실패하지 않는다(본 작업을 깨지 않는다)', async () => {
  const d = deps({
    sendEmail: async () => {
      throw new Error('resend down')
    },
  })
  assert.equal(await alertOpsAdmins({ kind: 'k', title: 't', message: 'm' }, d), 'sent')
  assert.equal(d.notes.length, 1, '인앱 알림은 남는다')
})

test('인앱 알림이 던지고 메일도 설정 안 됐으면 failed(던지지는 않는다)', async () => {
  const d = deps({
    createBulkNotifications: async () => {
      throw new Error('db down')
    },
    isMailConfigured: () => false,
  })
  assert.equal(await alertOpsAdmins({ kind: 'k', title: 't', message: 'm' }, d), 'failed')
})

test('메일 본문은 이스케이프되고 링크는 사이트 주소에 붙는다', () => {
  const html = buildOpsAlertEmail(
    {
      kind: 'k',
      title: '<b>제목</b>',
      message: '<script>alert(1)</script>\n둘째 줄',
      url: '/ko/admin',
    },
    'https://ggac.kr'
  )
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<br \/>둘째 줄/)
  assert.match(html, /href="https:\/\/ggac\.kr\/ko\/admin"/)
})
