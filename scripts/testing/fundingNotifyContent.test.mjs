import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BULK_CONCURRENCY,
  MAX_BULK_RECIPIENTS,
  backerDisplayName,
  buildBulkAbandonedNotice,
  buildCampaignClosedNotice,
  buildCampaignReviewedNotice,
  buildCampaignSubmittedNotice,
  buildDeliveryChangedNotice,
  buildPledgePaidBackerNotice,
  buildPledgePaidCreatorNotice,
  buildPledgeRefundedNotice,
  formatDeliveryMonth,
  formatWon,
  isRateLimited,
  isSendableEmail,
  josa,
  maskEmail,
  ro,
  pledgePaidBackerExtraLines,
  renderNoticeEmail,
  sendManyEmails,
} from '../../src/lib/funding/notifyContent.ts'

const SITE = 'https://ggac.kr'

const CAMPAIGN = {
  id: 'camp-1',
  slug: 'my-album',
  title: '첫 정규앨범',
  owner_user_id: 'owner-1',
  review_note: null,
}

/** 회원 후원자. 배송지·연락처까지 들어 있는 원장 행 그대로를 흉내 낸다. */
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
  shipping_postcode: '04524',
}

const GUEST_PLEDGE = {
  ...MEMBER_PLEDGE,
  id: 'p-2',
  user_id: null,
  pledge_code: 'FND-20260923-ZZZZZZZZ',
}
const ANON_PLEDGE = { ...MEMBER_PLEDGE, id: 'p-3', is_anonymous: true }

// ---------------------------------------------------------------- 익명

test('익명 후원자의 이름은 개설자에게 가지 않는다', () => {
  assert.equal(backerDisplayName(ANON_PLEDGE), '익명')
  const notice = buildPledgePaidCreatorNotice(ANON_PLEDGE, CAMPAIGN, SITE)
  assert.ok(notice.message.includes('익명'))
  assert.ok(!notice.message.includes('김후원'), '익명인데 실명이 샜다')
  assert.ok(!JSON.stringify(notice).includes('김후원'))
})

test('익명이 아니면 이름이 개설자에게 간다', () => {
  const notice = buildPledgePaidCreatorNotice(MEMBER_PLEDGE, CAMPAIGN, SITE)
  assert.ok(notice.message.includes('김후원'))
})

test('개설자에게 가는 알림에 후원자의 이메일·연락처·주소가 없다', () => {
  const blob = JSON.stringify(buildPledgePaidCreatorNotice(MEMBER_PLEDGE, CAMPAIGN, SITE))
  for (const secret of ['backer@example.com', '010-1234-5678', '서울시 어딘가 1-2', '04524']) {
    assert.ok(!blob.includes(secret), `개설자 알림에 ${secret}이 들어 있다`)
  }
})

// ---------------------------------------------------------------- 비회원

test('비회원 후원자는 로그인 없는 조회 화면으로 안내한다', () => {
  const guest = buildPledgePaidBackerNotice(GUEST_PLEDGE, CAMPAIGN, SITE)
  assert.equal(guest.url, 'https://ggac.kr/ko/funding/manage')
  assert.ok(guest.message.includes('FND-20260923-ZZZZZZZZ'))
  assert.ok(pledgePaidBackerExtraLines(GUEST_PLEDGE).some(l => l.includes('후원번호')))

  const member = buildPledgePaidBackerNotice(MEMBER_PLEDGE, CAMPAIGN, SITE)
  assert.equal(member.url, 'https://ggac.kr/ko/mypage/funding')
})

test('비회원 후원자에게도 환불·전달시기 문장이 만들어진다', () => {
  const refund = buildPledgeRefundedNotice(GUEST_PLEDGE, 'reward_sold_out', SITE)
  assert.equal(refund.url, 'https://ggac.kr/ko/funding/manage')
  assert.ok(refund.message.includes('30,000원'))

  const delivery = buildDeliveryChangedNotice(
    { reward_id: 'r-1', reward_title: 'CD 한 장', from: '2026-03', to: '2026-06' },
    CAMPAIGN,
    GUEST_PLEDGE,
    SITE
  )
  assert.equal(delivery.url, 'https://ggac.kr/ko/funding/manage')
  assert.ok(delivery.message.includes('2026년 3월'))
  assert.ok(delivery.message.includes('2026년 6월'))
})

// ---------------------------------------------------------------- 문안

test('반려 알림은 사유를 문장 안으로 가져온다', () => {
  const notice = buildCampaignReviewedNotice(
    { ...CAMPAIGN, review_note: '예산 내역이 비어 있습니다.' },
    'reject',
    SITE
  )
  assert.ok(notice.message.includes('예산 내역이 비어 있습니다.'))
  assert.equal(notice.url, 'https://ggac.kr/ko/mypage/funding/camp-1')
})

test('사유가 없으면 사무국 연락처를 대신 준다', () => {
  const notice = buildCampaignReviewedNotice(CAMPAIGN, 'reject', SITE)
  assert.ok(notice.message.includes('contact@ggac.kr'))
})

test('승인 알림은 공개된 프로젝트 주소로 보낸다', () => {
  const notice = buildCampaignReviewedNotice(CAMPAIGN, 'approve', SITE)
  assert.equal(notice.url, 'https://ggac.kr/ko/funding/my-album')
})

test('심사 요청은 관리자 화면으로, 마감은 개설자 대시보드로 보낸다', () => {
  assert.equal(buildCampaignSubmittedNotice(CAMPAIGN, SITE).url, 'https://ggac.kr/ko/admin/funding')
  assert.equal(
    buildCampaignClosedNotice(CAMPAIGN, SITE).url,
    'https://ggac.kr/ko/mypage/funding/camp-1'
  )
})

test('금지 용어(구매·주문·상품·기부)를 쓰지 않는다', () => {
  const all = [
    buildCampaignSubmittedNotice(CAMPAIGN, SITE),
    buildCampaignReviewedNotice(CAMPAIGN, 'approve', SITE),
    buildCampaignReviewedNotice({ ...CAMPAIGN, review_note: '보완 필요' }, 'reject', SITE),
    buildCampaignClosedNotice(CAMPAIGN, SITE),
    buildPledgePaidBackerNotice(MEMBER_PLEDGE, CAMPAIGN, SITE),
    buildPledgePaidCreatorNotice(MEMBER_PLEDGE, CAMPAIGN, SITE),
    buildPledgeRefundedNotice(MEMBER_PLEDGE, 'campaign_closed', SITE),
    buildDeliveryChangedNotice(
      { reward_id: 'r-1', reward_title: 'CD', from: null, to: '2026-06' },
      CAMPAIGN,
      MEMBER_PLEDGE,
      SITE
    ),
  ]
  for (const n of all) {
    const text = `${n.title} ${n.message}`
    for (const banned of ['구매', '주문', '상품', '기부', '!']) {
      assert.ok(!text.includes(banned), `"${banned}"이(가) 들어 있다: ${text}`)
    }
    assert.ok(n.title.length > 0 && n.message.length > 0)
  }
})

test('도메인은 인자로 받은 것만 쓴다 — 문안에 박혀 있지 않다', () => {
  const notice = buildCampaignSubmittedNotice(CAMPAIGN, 'http://localhost:3000')
  assert.equal(notice.url, 'http://localhost:3000/ko/admin/funding')
})

test('형식 도구', () => {
  assert.equal(formatWon(30000), '30,000원')
  assert.equal(formatWon(null), '0원')
  assert.equal(formatDeliveryMonth('2026-03'), '2026년 3월')
  assert.equal(formatDeliveryMonth(null), '미정')
  assert.equal(maskEmail('backer@example.com'), 'ba***@example.com')
  assert.equal(isSendableEmail(' a@b.com'), false)
  assert.equal(isSendableEmail(null), false)
  assert.equal(isSendableEmail('a@b.com'), true)
})

test('메일 본문은 HTML을 이스케이프한다', () => {
  const { subject, html } = renderNoticeEmail(
    buildPledgePaidCreatorNotice(
      { ...MEMBER_PLEDGE, backer_name: '<script>x</script>' },
      CAMPAIGN,
      SITE
    )
  )
  assert.ok(subject.startsWith('[경기아트콜렉티브]'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

// ---------------------------------------------------------------- 대량 발송

function recipients(n, prefix = 'u') {
  return Array.from({ length: n }, (_, i) => ({
    email: `${prefix}${i}@example.com`,
    user_id: `${prefix}-${i}`,
    subject: 's',
    html: 'h',
  }))
}

test('한 통이 실패해도 나머지가 전부 나간다', async () => {
  const sent = []
  const result = await sendManyEmails({
    recipients: recipients(5),
    sendEmail: async m => {
      if (m.to === 'u2@example.com') throw new Error('bounced')
      sent.push(m.to)
    },
    minIntervalMs: 0,
    retryDelayMs: 0,
  })
  assert.equal(result.sent, 4)
  assert.equal(result.failed, 1)
  assert.equal(sent.length, 4)
  assert.deepEqual(result.errors, [{ to: 'u2***@example.com', error: 'bounced' }])
})

test('수신거부·깨진 주소·중복은 따로 센다', async () => {
  const sent = []
  const result = await sendManyEmails({
    recipients: [
      { email: 'a@example.com', user_id: 'a', subject: 's', html: 'h' },
      { email: 'A@example.com', user_id: 'a2', subject: 's', html: 'h' },
      { email: 'off@example.com', user_id: 'off', subject: 's', html: 'h' },
      { email: 'broken', user_id: 'b', subject: 's', html: 'h' },
      { email: null, user_id: null, subject: 's', html: 'h' },
    ],
    sendEmail: async m => sent.push(m.to),
    isOptedOut: id => id === 'off',
    minIntervalMs: 0,
  })
  assert.deepEqual(sent, ['a@example.com'])
  assert.equal(result.skipped_optout, 1)
  assert.equal(result.skipped_address, 2)
})

test('수신자가 상한을 넘으면 반쪽으로 보내는 대신 아무것도 보내지 않는다', async () => {
  let calls = 0
  const errors = []
  const result = await sendManyEmails({
    recipients: recipients(MAX_BULK_RECIPIENTS + 1),
    sendEmail: async () => {
      calls += 1
    },
    log: { error: (m, meta) => errors.push([m, meta]) },
  })
  assert.equal(calls, 0)
  assert.equal(result.capped, true)
  assert.equal(result.sent, 0)
  assert.equal(errors.length, 1)
})

test('RESEND_API_KEY가 없어 sendEmail이 던져도 예외가 호출부로 나가지 않는다', async () => {
  const result = await sendManyEmails({
    recipients: recipients(3),
    sendEmail: async () => {
      throw new Error('RESEND_API_KEY가 설정되지 않았습니다.')
    },
    minIntervalMs: 0,
    retryDelayMs: 0,
  })
  assert.equal(result.failed, 3)
  assert.equal(result.sent, 0)
})

// ---------------------------------------------------------------- 조사

test('조사는 받침을 보고 고른다 — 모든 달에 대해 맞아야 한다', () => {
  assert.equal(ro('2026년 6월'), '2026년 6월로')
  assert.equal(ro('2026년 3월'), '2026년 3월로')
  assert.equal(ro('미정'), '미정으로')
  assert.equal(josa('내년', '으로', '로'), '으로')
  assert.equal(josa('여기', '으로', '로'), '로')
  // 한글이 아닌 끝 글자는 판정하지 않는다.
  assert.equal(josa('2026-06', '으로', '로'), '으로')
})

test('전달 시기 문장의 조사가 달마다 맞다', () => {
  for (const month of ['2026-01', '2026-02', '2026-03', '2026-06', '2026-10', '2026-12']) {
    const notice = buildDeliveryChangedNotice(
      { reward_id: 'r-1', reward_title: 'CD', from: '2026-03', to: month },
      CAMPAIGN,
      MEMBER_PLEDGE,
      SITE
    )
    assert.ok(!notice.message.includes('월으로'), `"${month}"에서 조사가 틀렸다`)
    assert.ok(notice.message.includes('월로 바뀌었습니다'))
  }
  const unknown = buildDeliveryChangedNotice(
    { reward_id: 'r-1', reward_title: 'CD', from: '2026-03', to: null },
    CAMPAIGN,
    MEMBER_PLEDGE,
    SITE
  )
  assert.ok(unknown.message.includes('미정으로 바뀌었습니다'))
})

// ---------------------------------------------------------------- 비회원 안내

test('조회 화면으로 보내는 문장은 비회원에게 후원번호를 함께 준다', () => {
  for (const build of [
    p => buildPledgeRefundedNotice(p, 'reward_sold_out', SITE),
    p =>
      buildDeliveryChangedNotice(
        { reward_id: 'r-1', reward_title: 'CD', from: '2026-03', to: '2026-06' },
        CAMPAIGN,
        p,
        SITE
      ),
  ]) {
    const guest = build(GUEST_PLEDGE)
    assert.equal(guest.url, 'https://ggac.kr/ko/funding/manage')
    assert.ok(guest.message.includes(GUEST_PLEDGE.pledge_code), '조회하라면서 번호를 안 줬다')

    // 회원은 마이페이지로 가므로 붙이지 않는다.
    const member = build(MEMBER_PLEDGE)
    assert.ok(!member.message.includes(MEMBER_PLEDGE.pledge_code))
  }
})

test('환불 문장은 돈이 안 들어올 때 갈 곳을 알려 준다', () => {
  const notice = buildPledgeRefundedNotice(MEMBER_PLEDGE, 'campaign_closed', SITE)
  assert.ok(notice.message.includes('contact@ggac.kr'))
  assert.ok(notice.message.includes('결제하신 날짜'))
})

test('마감 문장은 코드에 없는 정산 절차를 약속하지 않는다', () => {
  const notice = buildCampaignClosedNotice(CAMPAIGN, SITE)
  assert.ok(!notice.message.includes('정산'))
  assert.ok(notice.message.includes('contact@ggac.kr'))
})

// ---------------------------------------------------------------- 레이트리밋

test('429는 한 번 더 해 본다', async () => {
  let attempts = 0
  const result = await sendManyEmails({
    recipients: [{ email: 'a@example.com', subject: 's', html: 'h' }],
    sendEmail: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Resend 발송 실패 (429): Too many requests')
    },
    minIntervalMs: 0,
    retryDelayMs: 0,
  })
  assert.equal(attempts, 2)
  assert.equal(result.sent, 1)
  assert.equal(result.retried, 1)
  assert.equal(result.failed, 0)
})

test('두 번째도 429면 그때 실패로 센다', async () => {
  const result = await sendManyEmails({
    recipients: [{ email: 'a@example.com', subject: 's', html: 'h' }],
    sendEmail: async () => {
      throw new Error('Resend 발송 실패 (429): Too many requests')
    },
    minIntervalMs: 0,
    retryDelayMs: 0,
  })
  assert.equal(result.sent, 0)
  assert.equal(result.failed, 1)
})

test('429가 아닌 실패는 다시 하지 않는다', async () => {
  let attempts = 0
  await sendManyEmails({
    recipients: [{ email: 'a@example.com', subject: 's', html: 'h' }],
    sendEmail: async () => {
      attempts += 1
      throw new Error('Resend 발송 실패 (422): invalid address')
    },
    minIntervalMs: 0,
    retryDelayMs: 0,
  })
  assert.equal(attempts, 1)
  assert.equal(isRateLimited(new Error('Resend 발송 실패 (422): x')), false)
  assert.equal(isRateLimited(new Error('Resend 발송 실패 (429): x')), true)
})

test('한 통씩 보내고 시작 간격을 벌린다 — 제공자 한도 안에 든다', async () => {
  assert.equal(BULK_CONCURRENCY, 1)
  let inFlight = 0
  const starts = []
  await sendManyEmails({
    recipients: recipients(3),
    sendEmail: async () => {
      inFlight += 1
      assert.equal(inFlight, 1, '동시에 두 통이 떴다')
      starts.push(Date.now())
      await new Promise(r => setTimeout(r, 5))
      inFlight -= 1
    },
    minIntervalMs: 40,
  })
  assert.equal(starts.length, 3)
  assert.ok(starts[2] - starts[0] >= 70, `간격이 너무 짧다: ${starts[2] - starts[0]}ms`)
})

// ---------------------------------------------------------------- 상한 통지

test('발송 포기 통지는 관리자가 할 일을 말한다', () => {
  const notice = buildBulkAbandonedNotice(
    CAMPAIGN,
    "'CD' 전달 시기 변경",
    500,
    MAX_BULK_RECIPIENTS,
    SITE
  )
  assert.ok(notice.message.includes('500'))
  assert.ok(notice.message.includes(String(MAX_BULK_RECIPIENTS)))
  assert.ok(notice.message.includes('직접'))
})
