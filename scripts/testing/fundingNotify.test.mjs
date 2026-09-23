import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * `src/lib/funding/notify.ts` 배선 검증 — 네트워크도 DB도 쓰지 않는다.
 *
 * 코드리뷰가 실측한 구멍이 출발점이다: 이 파일을 부르는 테스트가 하나도 없어
 * `notifyPledgePaid` 첫 줄에 `if (1) return`을 넣어도 전 스위트가 초록불이었다.
 * 일곱 알림 전부가 조용히 무동작이 될 수 있었다.
 *
 * 그래서 모든 함수가 의존성을 주입받는다. 여기서 확인하는 것은 문안이 아니라
 * (그건 `fundingNotifyContent.test.mjs`) **누구에게 무엇을 보내는가**다.
 */

// 이 모듈은 쿼리 계층을 임포트하지만 DB 클라이언트는 실제 쿼리 시점까지 생성이
// 미뤄진다(`src/db/client.ts`의 lazy proxy). 아래 테스트는 전부 대역을 넘기므로
// 진짜 쿼리가 실행되지 않는다 — 파일도 만들어지지 않는다.
const notify = await import('../../src/lib/funding/notify.ts')

const CAMPAIGN = {
  id: 'camp-1',
  slug: 'my-album',
  title: '첫 정규앨범',
  owner_user_id: 'owner-1',
  review_note: '예산 내역이 비어 있습니다.',
}

const MEMBER_PLEDGE = {
  id: 'p-1',
  pledge_code: 'FND-20260923-ABCDEFGH',
  campaign_id: 'camp-1',
  user_id: 'user-9',
  backer_name: '김후원',
  backer_email: 'backer@example.com',
  backer_phone: '010-1234-5678',
  reward_title: 'CD 한 장',
  quantity: 1,
  total_amount: 30000,
  is_anonymous: false,
  shipping_address1: '서울시 어딘가 1-2',
}

const GUEST_PLEDGE = { ...MEMBER_PLEDGE, id: 'p-2', user_id: null }

/** 모든 의존성의 대역. 부른 것을 전부 기록한다. */
function spy(overrides = {}) {
  const calls = { inApp: [], bulk: [], mail: [], logs: [] }
  const deps = {
    getCampaignById: async () => CAMPAIGN,
    listPaidPledgesByReward: async () => [],
    listAdminRecipients: async () => [
      { id: 'admin-1', email: 'admin1@example.com' },
      { id: 'admin-2', email: 'admin2@example.com' },
    ],
    getProfileEmail: async id => `${id}@example.com`,
    getUserSettings: async () => [],
    getUserSettingsByUserIds: async () => new Map(),
    createNotification: async input => {
      calls.inApp.push(input)
    },
    createBulkNotifications: async input => {
      calls.bulk.push(input)
    },
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

const OPTED_OUT = [
  { category: 'notification', setting_key: 'email_notifications', setting_value: false },
]

// ------------------------------------------------ 메일 미설정 게이트

test('RESEND_API_KEY가 없으면 메일을 아예 시도하지 않고 인앱만 남는다', async () => {
  const { deps, calls } = spy({
    isMailConfigured: () => false,
    sendEmail: async () => assert.fail('키가 없는데 발송을 시도했다'),
  })
  await notify.notifyPledgePaid(MEMBER_PLEDGE, deps)
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'reject', deps)
  assert.equal(calls.mail.length, 0)
  assert.ok(calls.inApp.length >= 3, '인앱 알림까지 사라졌다')
})

test('sendEmail이 던져도 예외가 호출부로 나가지 않는다', async () => {
  const { deps, calls } = spy({
    sendEmail: async () => {
      throw new Error('RESEND_API_KEY가 설정되지 않았습니다.')
    },
  })
  await notify.notifyPledgePaid(MEMBER_PLEDGE, deps)
  assert.ok(calls.logs.some(([level]) => level === 'error'))
})

test('조회가 던져도 예외가 호출부로 나가지 않는다', async () => {
  const { deps } = spy({
    listAdminRecipients: async () => {
      throw new Error('boom')
    },
    getCampaignById: async () => {
      throw new Error('boom')
    },
    createNotification: async () => {
      throw new Error('boom')
    },
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, deps)
  await notify.notifyPledgePaid(MEMBER_PLEDGE, deps)
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  await notify.notifyPledgeRefunded(MEMBER_PLEDGE, 'reward_sold_out', deps)
  await notify.notifyRewardDeliveryChanged(CAMPAIGN, [
    { reward_id: 'r-1', reward_title: 'CD', from: '2026-03', to: '2026-06' },
  ])
})

// ------------------------------------------------ 거래성 대 선택

test('거래성(후원 완료·환불)은 수신거부를 무시한다', async () => {
  const { deps, calls } = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifyPledgePaid(MEMBER_PLEDGE, deps)
  assert.ok(
    calls.mail.some(m => m.to === 'backer@example.com'),
    '수신거부를 이유로 영수 메일을 막았다'
  )

  const second = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifyPledgeRefunded(MEMBER_PLEDGE, 'reward_sold_out', second.deps)
  assert.deepEqual(
    second.calls.mail.map(m => m.to),
    ['backer@example.com']
  )
})

test('선택(마감·심사 결과·개설자 몫)은 수신거부를 존중한다', async () => {
  const { deps, calls } = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'approve', deps)
  assert.equal(calls.mail.length, 0, '수신거부한 개설자에게 메일이 나갔다')
  assert.equal(calls.inApp.length, 2, '인앱 알림까지 막혔다')

  // 후원 완료에서도 개설자 몫만 막히고 후원자 몫은 나간다.
  const both = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifyPledgePaid(MEMBER_PLEDGE, both.deps)
  assert.deepEqual(
    both.calls.mail.map(m => m.to),
    ['backer@example.com']
  )
})

test('수신거부하지 않은 개설자에게는 메일이 나간다', async () => {
  const { deps, calls } = spy()
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  assert.deepEqual(
    calls.mail.map(m => m.to),
    ['owner-1@example.com']
  )
})

// ------------------------------------------------ 비회원

test('비회원에게는 인앱 알림을 만들지 않고 메일만 보낸다', async () => {
  const { deps, calls } = spy({
    getCampaignById: async () => ({ ...CAMPAIGN, owner_user_id: null }),
  })
  await notify.notifyPledgePaid(GUEST_PLEDGE, deps)
  assert.equal(calls.inApp.length, 0, 'user_id가 없는데 인앱 알림을 만들었다')
  assert.deepEqual(
    calls.mail.map(m => m.to),
    ['backer@example.com']
  )

  const refund = spy()
  await notify.notifyPledgeRefunded(GUEST_PLEDGE, 'campaign_closed', refund.deps)
  assert.equal(refund.calls.inApp.length, 0)
  assert.equal(refund.calls.mail.length, 1)
  assert.ok(refund.calls.mail[0].html.includes('FND-20260923-ABCDEFGH'), '후원번호가 없다')
})

// ------------------------------------------------ 개설자 몫

test('자기 프로젝트에 자기가 후원하면 개설자 알림은 가지 않는다', async () => {
  const self = { ...MEMBER_PLEDGE, user_id: 'owner-1' }
  const { deps, calls } = spy()
  await notify.notifyPledgePaid(self, deps)
  assert.equal(calls.inApp.length, 1, '같은 사람에게 두 번 알렸다')
  assert.deepEqual(
    calls.mail.map(m => m.to),
    ['backer@example.com']
  )
})

test('익명 후원자의 이름은 개설자에게 가는 어느 통로로도 나가지 않는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyPledgePaid({ ...MEMBER_PLEDGE, is_anonymous: true }, deps)

  const toCreator = [
    ...calls.inApp.filter(n => n.user_id === 'owner-1'),
    ...calls.mail.filter(m => m.to === 'owner-1@example.com'),
  ]
  assert.ok(toCreator.length >= 2, '개설자에게 아무것도 가지 않았다')
  for (const payload of toCreator) {
    const blob = JSON.stringify(payload)
    assert.ok(!blob.includes('김후원'), '익명인데 실명이 샜다')
    assert.ok(!blob.includes('backer@example.com'), '후원자 이메일이 샜다')
    assert.ok(!blob.includes('010-1234-5678'), '후원자 연락처가 샜다')
    assert.ok(!blob.includes('서울시 어딘가 1-2'), '후원자 주소가 샜다')
    assert.ok(blob.includes('익명'))
  }
})

// ------------------------------------------------ 관리자·상한

test('심사 제출은 관리자 전원에게 인앱과 메일로 간다', async () => {
  const { deps, calls } = spy()
  await notify.notifyCampaignSubmitted(CAMPAIGN, deps)
  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['admin-1', 'admin-2'])
  assert.equal(calls.bulk[0].type, 'funding_submitted')
  assert.deepEqual(calls.mail.map(m => m.to).sort(), ['admin1@example.com', 'admin2@example.com'])
})

test('관리자가 없으면 경고만 남기고 아무것도 보내지 않는다', async () => {
  const { deps, calls } = spy({ listAdminRecipients: async () => [] })
  await notify.notifyCampaignSubmitted(CAMPAIGN, deps)
  assert.equal(calls.bulk.length, 0)
  assert.equal(calls.mail.length, 0)
  assert.ok(calls.logs.some(([level]) => level === 'warn'))
})

test('전달 시기 변경은 그 리워드 후원자에게 가고, 비회원은 인앱에서 빠진다', async () => {
  const { deps, calls } = spy({
    listPaidPledgesByReward: async () => [
      { id: 'a', pledge_code: 'FND-A', user_id: 'user-1', backer_email: 'a@example.com' },
      { id: 'b', pledge_code: 'FND-B', user_id: null, backer_email: 'b@example.com' },
    ],
  })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-03', to: '2026-06' }],
    deps
  )
  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['user-1'], '비회원에게 인앱 알림을 만들었다')
  assert.equal(calls.bulk[0].type, 'funding_delivery_changed')
  assert.deepEqual(calls.mail.map(m => m.to).sort(), ['a@example.com', 'b@example.com'])
  // 비회원 메일에만 후원번호가 실린다.
  const guest = calls.mail.find(m => m.to === 'b@example.com')
  assert.ok(guest.html.includes('FND-B'))
})

test('수신자가 상한을 넘으면 발송을 포기하고 관리자에게 알린다', async () => {
  const many = Array.from({ length: 401 }, (_, i) => ({
    id: `p${i}`,
    pledge_code: `FND-${i}`,
    user_id: `u${i}`,
    backer_email: `u${i}@example.com`,
  }))
  const { deps, calls } = spy({ listPaidPledgesByReward: async () => many })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-03', to: '2026-06' }],
    deps
  )
  // 후원자에게는 아무것도 가지 않는다.
  assert.ok(!calls.mail.some(m => m.to.startsWith('u')), '반쪽으로 보냈다')
  // 관리자에게는 간다.
  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['admin-1', 'admin-2'])
  assert.ok(calls.bulk[0].message.includes('401'))
  assert.deepEqual(calls.mail.map(m => m.to).sort(), ['admin1@example.com', 'admin2@example.com'])
})

// ------------------------------------------------ 알림 종류

test('일곱 알림이 저마다 제 종류로 기록된다', async () => {
  const seen = []
  const collect = {
    createNotification: async i => seen.push(i.type),
    createBulkNotifications: async i => seen.push(i.type),
  }

  await notify.notifyCampaignSubmitted(CAMPAIGN, spy(collect).deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'approve', spy(collect).deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'reject', spy(collect).deps)
  await notify.notifyPledgePaid(MEMBER_PLEDGE, spy(collect).deps)
  await notify.notifyCampaignClosed(CAMPAIGN, spy(collect).deps)
  await notify.notifyPledgeRefunded(MEMBER_PLEDGE, 'reward_sold_out', spy(collect).deps)
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD', from: null, to: '2026-06' }],
    spy({
      ...collect,
      listPaidPledgesByReward: async () => [
        { id: 'a', pledge_code: 'FND-A', user_id: 'user-1', backer_email: 'a@example.com' },
      ],
    }).deps
  )

  assert.deepEqual([...new Set(seen)].sort(), [
    'funding_approved',
    'funding_closed',
    'funding_delivery_changed',
    'funding_pledged',
    'funding_refunded',
    'funding_rejected',
    'funding_submitted',
  ])
})

test('인앱 알림의 data.url은 저장되어 화면이 읽을 수 있다', async () => {
  const { deps, calls } = spy()
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  assert.equal(calls.inApp[0].data.url, 'https://ggac.kr/ko/mypage/funding/camp-1')
})
