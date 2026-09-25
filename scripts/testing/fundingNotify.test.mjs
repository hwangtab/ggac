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
    // 억제 판정이 보는 활동 기록. 기본은 "최근에 아무 일도 없었다".
    listRecentTargetActivities: async () => [],
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
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  await notify.notifyPledgePaid(MEMBER_PLEDGE, deps)
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  await notify.notifyPledgeRefunded(MEMBER_PLEDGE, 'reward_sold_out', deps)
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD', from: '2026-03', to: '2026-06' }],
    {},
    {
      ...deps,
      listPaidPledgesByReward: async () => {
        throw new Error('boom')
      },
    }
  )
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
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['admin-1', 'admin-2'])
  assert.equal(calls.bulk[0].type, 'funding_submitted')
  assert.deepEqual(calls.mail.map(m => m.to).sort(), ['admin1@example.com', 'admin2@example.com'])
})

test('관리자가 없으면 경고만 남기고 아무것도 보내지 않는다', async () => {
  const { deps, calls } = spy({ listAdminRecipients: async () => [] })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
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
    {},
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
    {},
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

test('여덟 알림이 저마다 제 종류로 기록된다', async () => {
  const seen = []
  const collect = {
    createNotification: async i => seen.push(i.type),
    createBulkNotifications: async i => seen.push(i.type),
  }

  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, spy(collect).deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'approve', spy(collect).deps)
  await notify.notifyCampaignReviewed(CAMPAIGN, 'reject', spy(collect).deps)
  await notify.notifyPledgePaid(MEMBER_PLEDGE, spy(collect).deps)
  await notify.notifyCampaignClosed(CAMPAIGN, spy(collect).deps)
  await notify.notifyPledgeRefunded(MEMBER_PLEDGE, 'reward_sold_out', spy(collect).deps)
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD', from: null, to: '2026-06' }],
    {},
    spy({
      ...collect,
      listPaidPledgesByReward: async () => [
        { id: 'a', pledge_code: 'FND-A', user_id: 'user-1', backer_email: 'a@example.com' },
      ],
    }).deps
  )

  await notify.notifyPledgesShipped(CAMPAIGN, [MEMBER_PLEDGE], spy(collect).deps)

  assert.deepEqual([...new Set(seen)].sort(), [
    'funding_approved',
    'funding_closed',
    'funding_delivery_changed',
    'funding_pledged',
    'funding_refunded',
    'funding_rejected',
    'funding_shipped',
    'funding_submitted',
  ])
})

test('인앱 알림의 data.url은 저장되어 화면이 읽을 수 있다', async () => {
  const { deps, calls } = spy()
  await notify.notifyCampaignClosed(CAMPAIGN, deps)
  assert.equal(calls.inApp[0].data.url, 'https://ggac.kr/ko/mypage/funding/camp-1')
})

// ---------------------------------------------------------------- ⑧ 발송

test('발송 알림은 회원에게 인앱+메일, 비회원에게 메일만 간다', async () => {
  const { deps, calls } = spy()
  await notify.notifyPledgesShipped(CAMPAIGN, [MEMBER_PLEDGE, GUEST_PLEDGE], deps)
  // 인앱은 회원 한 사람만. 비회원은 계정이 없어 만들 자리가 없다.
  assert.equal(calls.bulk.length, 1)
  assert.deepEqual(calls.bulk[0].user_ids, ['user-9'])
  assert.equal(calls.bulk[0].type, 'funding_shipped')
  // 메일은 둘 다. 주소가 같아 한 통으로 합쳐지지 않도록 테스트 자료의
  // 비회원 주소를 따로 둔다면 두 통이 되지만, 여기서는 같은 주소이므로
  // 대량 발송기가 한 통으로 합친다 — 그게 의도다.
  assert.equal(calls.mail.length, 1)
  assert.match(calls.mail[0].subject, /리워드를 보냈습니다/)
})

test('발송 알림은 선택 알림이다 — 수신거부한 회원에게는 메일이 가지 않는다', async () => {
  const { deps, calls } = spy({
    getUserSettingsByUserIds: async () => new Map([['user-9', OPTED_OUT]]),
  })
  await notify.notifyPledgesShipped(CAMPAIGN, [MEMBER_PLEDGE], deps)
  assert.equal(calls.mail.length, 0)
  // 인앱 알림은 그대로 남는다 — 수신거부는 메일에 대한 약속이다.
  assert.equal(calls.bulk.length, 1)
})

test('발송 알림 문장에 남의 정보가 실리지 않는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyPledgesShipped(
    CAMPAIGN,
    [MEMBER_PLEDGE, { ...GUEST_PLEDGE, backer_email: 'other@example.com', backer_name: '이웃' }],
    deps
  )
  for (const mail of calls.mail) {
    assert.ok(!mail.html.includes('이웃'), '다른 후원자의 이름이 실렸다')
    assert.ok(!mail.html.includes('서울시 어딘가'), '배송지가 실렸다')
    assert.ok(!mail.html.includes('010-'), '연락처가 실렸다')
  }
})

test('발송 알림은 한 사람의 여러 건을 한 통으로 합치고 나머지 건수를 센다', async () => {
  const { deps, calls } = spy()
  await notify.notifyPledgesShipped(
    CAMPAIGN,
    [MEMBER_PLEDGE, { ...MEMBER_PLEDGE, id: 'p-9', reward_title: 'LP 한 장' }],
    deps
  )
  assert.equal(calls.mail.length, 1)
  assert.match(calls.mail[0].html, /외 1건/)
})

test('발송 알림은 수신자가 상한을 넘으면 통째로 포기하고 관리자에게 알린다', async () => {
  const many = Array.from({ length: 401 }, (_, i) => ({
    ...GUEST_PLEDGE,
    id: `p-${i}`,
    backer_email: `b${i}@example.com`,
  }))
  const { deps, calls } = spy()
  await notify.notifyPledgesShipped(CAMPAIGN, many, deps)
  assert.equal(calls.mail.length, 2, '관리자 두 사람에게만 나간다')
  assert.equal(calls.bulk[0].type, 'system_notice')
})

test('발송 알림은 절대 던지지 않는다 — 라우트 응답을 바꾸면 안 된다', async () => {
  const { deps } = spy({
    createBulkNotifications: async () => {
      throw new Error('DB 폭발')
    },
    sendEmail: async () => {
      throw new Error('메일 폭발')
    },
  })
  await notify.notifyPledgesShipped(CAMPAIGN, [MEMBER_PLEDGE], deps)
})

test('보낼 건이 없으면 아무것도 하지 않는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyPledgesShipped(CAMPAIGN, [], deps)
  assert.equal(calls.mail.length + calls.bulk.length + calls.inApp.length, 0)
})

// ------------------------------------------------ ⑨⑩ 정산

const SETTLEMENT = {
  gross_amount: 34_333,
  refund_amount: 11_111,
  pg_fee_amount: 777,
  platform_fee_amount: 1_161,
  payout_amount: 21_284,
}

test('정산 정리는 선택 알림 — 수신거부한 개설자에게는 인앱만 남는다', async () => {
  const { deps, calls } = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifySettlementPrepared(CAMPAIGN, SETTLEMENT, {}, deps)
  assert.equal(calls.mail.length, 0, '수신거부한 개설자에게 정산 준비 메일이 나갔다')
  assert.equal(calls.inApp.length, 1)
  assert.equal(calls.inApp[0].type, 'funding_settled')
  assert.equal(calls.inApp[0].user_id, 'owner-1')
})

test('정산 지급은 거래성 — 수신거부해도 "돈을 보냈다"는 통지는 나간다', async () => {
  const { deps, calls } = spy({ getUserSettings: async () => OPTED_OUT })
  await notify.notifySettlementPaid(CAMPAIGN, SETTLEMENT, deps)
  assert.equal(calls.mail.length, 1, '자기 돈이 움직인 통지를 수신거부로 막았다')
  assert.equal(calls.mail[0].to, 'owner-1@example.com')
  assert.ok(calls.mail[0].html.includes('21,284원'))
  assert.equal(calls.inApp.length, 1)
  assert.equal(calls.inApp[0].type, 'funding_settled')
})

test('정산 알림도 던지지 않는다 — 조회·발송이 실패해도 호출부는 모른다', async () => {
  const { deps, calls } = spy({
    getProfileEmail: async () => {
      throw new Error('boom')
    },
    createNotification: async () => {
      throw new Error('boom')
    },
  })
  await notify.notifySettlementPrepared(CAMPAIGN, SETTLEMENT, {}, deps)
  await notify.notifySettlementPaid(CAMPAIGN, SETTLEMENT, deps)
  assert.ok(calls.logs.some(([level]) => level === 'error'))
})

test('메일 키가 없으면 정산 알림도 인앱만 남는다', async () => {
  const { deps, calls } = spy({
    isMailConfigured: () => false,
    sendEmail: async () => assert.fail('키가 없는데 발송을 시도했다'),
  })
  await notify.notifySettlementPaid(CAMPAIGN, SETTLEMENT, deps)
  assert.equal(calls.mail.length, 0)
  assert.equal(calls.inApp.length, 1)
})

// ------------------------------------------------ 반복 동작 억제
//
// 제출·철회도, 예상 전달월 저장도 당사자가 얼마든지 반복할 수 있는 동작이다.
// 되풀이하면 관리자 전원·후원자 전원에게 메일이 끝없이 나가고, Resend 한도는
// 가입 인증·비밀번호 재설정과 같은 통이라 **사이트 전체가 멈춘다.**
// 판정 규칙과 고른 이유는 `src/lib/funding/notifyThrottle.ts` 머리 주석에 있다.

const minutesAgo = m => new Date(Date.now() - m * 60_000).toISOString()
const hoursAgo = h => new Date(Date.now() - h * 3_600_000).toISOString()

test('30분 안에 다시 제출하면 관리자에게 아무것도 가지 않는다', async () => {
  const { deps, calls } = spy({
    listRecentTargetActivities: async () => [
      { created_at: minutesAgo(5), target_id: 'camp-1', metadata: { action: 'submit' } },
    ],
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.mail.length, 0, '제출·철회를 되풀이해 관리자 메일을 또 보냈다')
  assert.equal(calls.bulk.length, 0, '같은 말을 인앱으로 또 만들었다')
})

test('철회하고 고쳐 다시 낸 정직한 재제출(30분 뒤)은 그대로 알린다', async () => {
  const { deps, calls } = spy({
    listRecentTargetActivities: async () => [
      { created_at: minutesAgo(45), target_id: 'camp-1', metadata: { action: 'submit' } },
    ],
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.bulk.length, 1, '정직한 재제출을 침묵시켰다')
  assert.equal(calls.mail.length, 2)
})

test('다른 캠페인의 방금 제출은 이 캠페인의 알림을 막지 않는다', async () => {
  const { deps, calls } = spy({
    listRecentTargetActivities: async () => [
      { created_at: minutesAgo(1), target_id: 'camp-2', metadata: {} },
    ],
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.mail.length, 2)
})

test('하루 상한을 넘긴 제출 알림은 인앱만 남고 메일이 끊긴다', async () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    created_at: hoursAgo(2),
    target_id: `other-${i}`,
    metadata: {},
  }))
  const { deps, calls } = spy({ listRecentTargetActivities: async () => entries })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.bulk.length, 1, '관리자가 심사 목록에서 볼 인앱 알림까지 없앴다')
  assert.equal(calls.mail.length, 0, '하루 상한을 넘겼는데 메일이 나갔다')
})

test('활동 기록을 못 읽으면 억제하지 않고 그대로 알린다', async () => {
  const { deps, calls } = spy({
    listRecentTargetActivities: async () => {
      throw new Error('boom')
    },
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, {}, deps)
  assert.equal(calls.mail.length, 2, '조회가 흔들렸다고 알림을 삼켰다')
  assert.ok(calls.logs.some(([level]) => level === 'warn'))
})

const TWO_BACKERS = [
  { id: 'a', pledge_code: 'FND-A', user_id: 'user-1', backer_email: 'a@example.com' },
  { id: 'b', pledge_code: 'FND-B', user_id: null, backer_email: 'b@example.com' },
]

test('같은 리워드를 하루 안에 또 바꾸면 인앱만 가고 메일은 나가지 않는다', async () => {
  const { deps, calls } = spy({
    listPaidPledgesByReward: async () => TWO_BACKERS,
    listRecentTargetActivities: async () => [
      {
        created_at: hoursAgo(2),
        target_id: 'camp-1',
        metadata: { changes: [{ reward_id: 'r-1' }] },
      },
    ],
  })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-06', to: '2026-07' }],
    {},
    deps
  )
  assert.equal(calls.mail.length, 0, '전달월을 되돌리며 후원자 전원에게 메일을 또 보냈다')
  assert.equal(calls.bulk.length, 1, '값이 새로운데 인앱마저 막았다')
})

test('하루 세 번을 넘긴 전달 시기 변경은 아무에게도 가지 않는다', async () => {
  const { deps, calls } = spy({
    listPaidPledgesByReward: async () => TWO_BACKERS,
    listRecentTargetActivities: async () =>
      [1, 2, 3].map(h => ({
        created_at: hoursAgo(h),
        target_id: 'camp-1',
        metadata: { changes: [{ reward_id: 'r-1' }] },
      })),
  })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [{ reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-07', to: '2026-06' }],
    {},
    deps
  )
  assert.equal(calls.mail.length, 0)
  assert.equal(calls.bulk.length, 0, '상한을 넘겼는데 인앱 행을 계속 만들었다')
})

test('한 리워드가 상한에 닿아도 다른 리워드의 변경은 그대로 알린다', async () => {
  const { deps, calls } = spy({
    listPaidPledgesByReward: async () => TWO_BACKERS,
    listRecentTargetActivities: async () =>
      [1, 2, 3].map(h => ({
        created_at: hoursAgo(h),
        target_id: 'camp-1',
        metadata: { changes: [{ reward_id: 'r-1' }] },
      })),
  })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [
      { reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-07', to: '2026-06' },
      { reward_id: 'r-2', reward_title: 'LP 한 장', from: '2026-06', to: '2026-09' },
    ],
    {},
    deps
  )
  assert.deepEqual(calls.mail.map(m => m.to).sort(), ['a@example.com', 'b@example.com'])
  assert.equal(calls.bulk.length, 1)
  assert.ok(calls.bulk[0].message.includes('LP 한 장'))
})

test('여러 리워드가 한꺼번에 밀린 한 번의 저장은 전부 알린다', async () => {
  const { deps, calls } = spy({ listPaidPledgesByReward: async () => TWO_BACKERS })
  await notify.notifyRewardDeliveryChanged(
    CAMPAIGN,
    [
      { reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-06', to: '2026-09' },
      { reward_id: 'r-2', reward_title: 'LP 한 장', from: '2026-06', to: '2026-09' },
      { reward_id: 'r-3', reward_title: '엽서', from: '2026-06', to: '2026-09' },
    ],
    {},
    deps
  )
  assert.equal(calls.bulk.length, 3, '같은 저장 안의 리워드끼리 서로를 막았다')
  assert.equal(calls.mail.length, 6)
})

test('지금 이 동작의 활동 기록은 억제 판정에서 빠진다', async () => {
  const seen = []
  const { deps, calls } = spy({
    listRecentTargetActivities: async filter => {
      seen.push(filter)
      return []
    },
  })
  await notify.notifyCampaignSubmitted(CAMPAIGN, { activityId: 'act-now' }, deps)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].excludeId, 'act-now', '방금 남긴 기록을 빼 달라고 하지 않았다')
  assert.equal(calls.mail.length, 2)
})
