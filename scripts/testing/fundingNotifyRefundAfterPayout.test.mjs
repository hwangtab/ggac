import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 지급 뒤 환불 알림 — 정산금을 보낸 다음 사무국이 후원을 환불한 경우.
 *
 * 사무국 환불 라우트는 이 경우 확인을 한 번 더 받지만, 그 확인은 사무국 화면
 * 안에서만 일어난다. 개설자에게는 아무 말도 가지 않아, 이미 받은 정산금 중
 * 일부를 되돌려 줘야 한다는 사실을 나중에 전화로 처음 듣게 된다.
 *
 * 여기서 지키는 성질:
 *   - 개설자 한 사람에게 인앱 + 메일이고, 수신거부를 보지 않는다(거래성)
 *   - 문안이 금액을 청구하지 않는다 — 사무국이 따로 연락한다고만 말한다
 *   - 캠페인이 없으면 조용히 끝난다
 *   - 의존성이 던져도 밖으로 던지지 않는다
 */

const n = await import('../../src/lib/funding/notify.ts')
const c = await import('../../src/lib/funding/notifyContent.ts')

const CAMPAIGN = { id: 'c1', title: '첫 앨범', owner_user_id: 'owner-1' }
const PLEDGE = { id: 'p1', pledge_code: 'GGAC-0001', total_amount: 30000 }

function spy(overrides = {}) {
  const calls = { inApp: [], mail: [], logs: [] }
  const deps = {
    createNotification: async input => {
      calls.inApp.push(input)
    },
    getProfileEmail: async id => `${id}@example.com`,
    getUserSettings: async () => [],
    getUserSettingsByUserIds: async () => new Map(),
    sendEmail: async mail => {
      calls.mail.push(mail)
    },
    isMailConfigured: () => true,
    siteUrl: () => 'https://ggac.kr',
    log: {
      info: (m, meta) => calls.logs.push(['info', m, meta]),
      warn: (m, meta) => calls.logs.push(['warn', m, meta]),
      error: (m, meta) => calls.logs.push(['error', m, meta]),
    },
    ...overrides,
  }
  return { deps, calls }
}

test('개설자에게 인앱과 메일로 간다', async () => {
  const { deps, calls } = spy()
  await n.notifyRefundAfterPayout(CAMPAIGN, PLEDGE, deps)
  assert.equal(calls.inApp.length, 1)
  assert.equal(calls.inApp[0].user_id, 'owner-1')
  assert.equal(calls.inApp[0].type, 'funding_settled')
  assert.equal(calls.mail.length, 1)
  assert.equal(calls.mail[0].to, 'owner-1@example.com')
})

test('수신거부를 보지 않는다 — 자기가 이미 받은 돈 이야기다', async () => {
  const { deps, calls } = spy({
    getUserSettings: async () => [{ setting_key: 'email_notifications', setting_value: 'false' }],
  })
  await n.notifyRefundAfterPayout(CAMPAIGN, PLEDGE, deps)
  assert.equal(calls.mail.length, 1)
})

test('캠페인이 없으면 조용히 끝난다', async () => {
  const { deps, calls } = spy()
  await n.notifyRefundAfterPayout(null, PLEDGE, deps)
  assert.equal(calls.inApp.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('의존성이 던져도 밖으로 던지지 않는다 — 환불은 이미 끝난 일이다', async () => {
  const { deps, calls } = spy({
    createNotification: async () => {
      throw new Error('DB 끊김')
    },
  })
  await n.notifyRefundAfterPayout(CAMPAIGN, PLEDGE, deps)
  assert.ok(calls.logs.some(l => l[0] === 'error'))
})

test('문안은 환불 사실과 연락 예고까지다 — 되돌려 받을 금액을 청구하지 않는다', () => {
  const notice = c.buildRefundAfterPayoutNotice(CAMPAIGN, PLEDGE, 'https://ggac.kr')
  assert.match(notice.message, /첫 앨범/)
  assert.match(notice.message, /30,000원/)
  assert.match(notice.message, /따로 연락/)
  assert.equal(notice.data.kind, 'funding_refund_after_payout')
  assert.equal(notice.data.pledge_code, 'GGAC-0001')
  // 되돌려 받을 차액을 숫자로 못박지 않는다.
  assert.equal(/차액 [\d,]+원/.test(notice.message), false)
})
