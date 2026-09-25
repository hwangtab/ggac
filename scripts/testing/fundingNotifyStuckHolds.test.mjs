import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 정체 선점 공지 — 하루 넘게 풀리지 않는 결제 대기 선점을 관리자에게 알린다.
 *
 * 만료 스윕은 토스가 승인했는데 우리 confirm이 유실된 결제를 구하는 유일한
 * 장치라, 못 푸는 행 속에는 "돈은 나갔는데 후원이 없는" 건이 섞여 있을 수
 * 있다. 로그로만 남기면 아무도 보지 않는다.
 *
 * 크론은 10분마다 같은 것을 다시 발견한다. 그래서 여기서 지키는 성질:
 *   - 0건이면 아무것도 하지 않는다
 *   - 하루 안에 이미 냈으면 다시 내지 않는다
 *   - 낼 때는 관리자 전원 인앱 + 메일이고 `data.kind`로 종류를 새긴다
 *   - 의존성이 던져도 밖으로 던지지 않는다 (크론이 알림 때문에 죽으면 안 된다)
 */

const n = await import('../../src/lib/funding/notify.ts')

function spy(overrides = {}) {
  const calls = { bulk: [], mail: [], logs: [] }
  const deps = {
    getCampaignById: async () => null,
    listPaidPledgesByReward: async () => [],
    listAdminRecipients: async () => [
      { id: 'admin-1', email: 'admin1@example.com' },
      { id: 'admin-2', email: 'admin2@example.com' },
    ],
    listRecentTargetActivities: async () => [],
    getProfileEmail: async id => `${id}@example.com`,
    getUserSettings: async () => [],
    getUserSettingsByUserIds: async () => new Map(),
    createNotification: async () => {},
    createBulkNotifications: async input => {
      calls.bulk.push(input)
    },
    hasRecentSystemNotice: async () => false,
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

const STUCK = { count: 3, orderIds: ['funding_a', 'funding_b', 'funding_c'] }

test('0건이면 아무것도 하지 않는다', async () => {
  const { deps, calls } = spy()
  await n.notifyStuckHolds({ count: 0, orderIds: [] }, deps)
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('하루 안에 이미 냈으면 다시 내지 않는다 — 크론은 10분마다 같은 것을 다시 본다', async () => {
  let askedKind = null
  const { deps, calls } = spy({
    hasRecentSystemNotice: async kind => {
      askedKind = kind
      return true
    },
  })
  await n.notifyStuckHolds(STUCK, deps)
  assert.equal(askedKind, 'funding_stuck_holds')
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
})

test('처음이면 관리자 전원에게 인앱과 메일로 내고 종류를 새긴다', async () => {
  const { deps, calls } = spy()
  await n.notifyStuckHolds(STUCK, deps)
  assert.equal(calls.bulk.length, 1)
  const bulk = calls.bulk[0]
  assert.deepEqual(bulk.user_ids, ['admin-1', 'admin-2'])
  assert.equal(bulk.type, 'system_notice')
  assert.equal(bulk.data.kind, 'funding_stuck_holds', '다음 회차가 이 종류로 최근 공지를 찾는다')
  assert.equal(bulk.data.count, 3)
  assert.match(bulk.message, /3건/)
  assert.match(bulk.message, /funding_a/)
  assert.equal(calls.mail.length, 2)
})

test('주문번호는 다섯 개까지만 싣고 나머지는 건수로 말한다', async () => {
  const { deps, calls } = spy()
  const ids = Array.from({ length: 8 }, (_, i) => `funding_${i}`)
  await n.notifyStuckHolds({ count: 8, orderIds: ids }, deps)
  const msg = calls.bulk[0].message
  assert.match(msg, /funding_4/)
  assert.doesNotMatch(msg, /funding_5/)
  assert.match(msg, /외 3건/)
})

test('메일 키가 없으면 인앱만 낸다', async () => {
  const { deps, calls } = spy({ isMailConfigured: () => false })
  await n.notifyStuckHolds(STUCK, deps)
  assert.equal(calls.bulk.length, 1)
  assert.equal(calls.mail.length, 0)
})

test('의존성이 던져도 밖으로 던지지 않는다 — 크론이 알림 때문에 죽으면 안 된다', async () => {
  const { deps } = spy({
    hasRecentSystemNotice: async () => {
      throw new Error('DB 불통')
    },
  })
  await assert.doesNotReject(n.notifyStuckHolds(STUCK, deps))
  const { deps: d2 } = spy({
    listAdminRecipients: async () => {
      throw new Error('조회 실패')
    },
  })
  await assert.doesNotReject(n.notifyStuckHolds(STUCK, d2))
})
