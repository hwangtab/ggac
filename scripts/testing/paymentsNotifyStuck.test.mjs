import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * "결제 확인 필요" 사무국 공지 — 대사가 스스로 풀지 못한 예매·조합비 결제를
 * 사람에게 넘긴다. 그 안에는 **승인된 돈이 붙어 있는데 표도 납부도 없는** 건이
 * 섞일 수 있어서, 로그로만 남기면 아무도 보지 않는다.
 *
 * 크론은 10분마다 같은 것을 다시 발견한다. 그래서 지키는 성질:
 *   - 0건이면 아무것도 하지 않는다
 *   - 하루 안에 이미 냈으면 다시 내지 않는다(종류별로 따로 센다)
 *   - 낼 때는 관리자 전원 인앱 + 메일이고 `data.kind`로 종류를 새긴다
 *   - 의존성이 던져도 밖으로 던지지 않는다
 */

const n = await import('../../src/lib/payments/notifyStuck.ts')

function spy(overrides = {}) {
  const calls = { bulk: [], mail: [], asked: [], logs: [] }
  const deps = {
    listAdminRecipients: async () => [
      { id: 'admin-1', email: 'admin1@example.com' },
      { id: 'admin-2', email: 'admin2@example.com' },
    ],
    getUserSettingsByUserIds: async () => new Map(),
    createBulkNotifications: async input => {
      calls.bulk.push(input)
    },
    hasRecentSystemNotice: async kind => {
      calls.asked.push(kind)
      return false
    },
    sendEmail: async mail => {
      calls.mail.push(mail)
    },
    isMailConfigured: () => true,
    log: {
      info: (m, meta) => calls.logs.push(['info', m, meta]),
      warn: (m, meta) => calls.logs.push(['warn', m, meta]),
      error: (m, meta) => calls.logs.push(['error', m, meta]),
    },
    ...overrides,
  }
  return { deps, calls }
}

const TICKET_STUCK = {
  kind: 'ticket_stuck_holds',
  label: '예매',
  action: '토스 거래 내역에서 주문번호를 확인해 주세요.',
  count: 3,
  orderIds: ['ticket_a', 'ticket_b', 'ticket_c'],
}

test('0건이면 아무것도 하지 않는다', async () => {
  const { deps, calls } = spy()
  await n.notifyStuckPayments({ ...TICKET_STUCK, count: 0, orderIds: [] }, deps)
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('하루 안에 이미 냈으면 다시 내지 않는다 — 크론은 10분마다 같은 것을 본다', async () => {
  const { deps, calls } = spy({ hasRecentSystemNotice: async () => true })
  await n.notifyStuckPayments(TICKET_STUCK, deps)
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('억제는 종류별로 센다 — 예매 공지가 조합비 공지를 막지 않는다', async () => {
  const { deps, calls } = spy()
  await n.notifyStuckPayments(TICKET_STUCK, deps)
  await n.notifyStuckPayments(
    { ...TICKET_STUCK, kind: 'dues_stuck_payments', label: '조합비' },
    deps
  )
  assert.deepEqual(calls.asked, ['ticket_stuck_holds', 'dues_stuck_payments'])
})

test('관리자 전원에게 인앱과 메일이 간다', async () => {
  const { deps, calls } = spy()
  await n.notifyStuckPayments(TICKET_STUCK, deps)

  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['admin-1', 'admin-2'])
  assert.equal(calls.bulk[0].type, 'system_notice')
  assert.equal(calls.bulk[0].data.kind, 'ticket_stuck_holds')
  assert.equal(calls.bulk[0].data.count, 3)
  assert.equal(calls.mail.length, 2)
  assert.match(calls.mail[0].html, /ticket_a/, '사무국이 토스에서 찾을 열쇠가 본문에 있어야 한다')
})

test('메일 설정이 없으면 인앱만 남기고 조용히 끝낸다', async () => {
  const { deps, calls } = spy({ isMailConfigured: () => false })
  await n.notifyStuckPayments(TICKET_STUCK, deps)
  assert.equal(calls.bulk.length, 1)
  assert.equal(calls.mail.length, 0)
})

test('받을 관리자가 없으면 메일을 만들지 않는다', async () => {
  const { deps, calls } = spy({ listAdminRecipients: async () => [] })
  await n.notifyStuckPayments(TICKET_STUCK, deps)
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('무엇이 던져도 밖으로 던지지 않는다 — 크론이 알림 때문에 죽으면 안 된다', async () => {
  const { deps } = spy({
    listAdminRecipients: async () => {
      throw new Error('DB 없음')
    },
  })
  await n.notifyStuckPayments(TICKET_STUCK, deps)

  const bulkFails = spy({
    createBulkNotifications: async () => {
      throw new Error('알림 실패')
    },
  })
  await n.notifyStuckPayments(TICKET_STUCK, bulkFails.deps)
  assert.equal(bulkFails.calls.mail.length, 2, '인앱이 실패해도 메일은 나간다')
})

test('주문번호는 다섯 개까지만 싣고 나머지는 건수로 말한다', () => {
  const notice = n.buildStuckPaymentsNotice({
    kind: 'ticket_stuck_holds',
    label: '예매',
    action: '확인해 주세요.',
    count: 8,
    orderIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  })
  assert.match(notice.message, /a, b, c, d, e 외 3건/)
  assert.doesNotMatch(notice.message, /, f/)
})
