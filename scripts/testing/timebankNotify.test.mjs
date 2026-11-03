import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getNotificationRoute } from '../../src/utils/notificationNavigation.ts'
import { NOTIFICATION_TYPE } from '../../src/db/schema/content.ts'
import {
  NOTIFICATION_TYPE_COLOR,
  NOTIFICATION_TYPE_LABEL,
} from '../../src/constants/notificationTypes.ts'

/**
 * 타임뱅크 알림(계획 Task 6, 스펙 §10)의 종류·이동·받는 사람·발송 래퍼.
 *
 * 알림 종류는 사본이 다섯 곳이다(스키마 배열·유니온·이름표/색·이동·테스트).
 * 이동에 case를 빠뜨리면 `default`가 `/board/{id}`로 보내 **404**다 — 그래서
 * 이 파일은 스키마 배열에서 `timebank_*`를 뽑아 하나라도 case가 없으면 실패한다.
 *
 * 발송 래퍼는 DB를 쓰지 않는다 — 의존성을 주입한다(`fundingNotify.test.mjs`와
 * 같은 이유). 쿼리 모듈은 임포트되지만 DB 클라이언트는 쿼리 시점까지 만들어지지
 * 않는다.
 */

const notify = await import('../../src/lib/server/timebankNotify.ts')

const EXPECTED_TYPES = [
  'timebank_pending',
  'timebank_confirmed',
  'timebank_rejected',
  'timebank_canceled',
  'timebank_comment',
  'timebank_credited',
  'timebank_volunteer',
  'timebank_withdrawal_negative',
]
const TIMEBANK_TYPES = NOTIFICATION_TYPE.filter(t => t.startsWith('timebank_'))

const LISTING_ID = '3f2b8c1e-5a4d-4e6f-9b8a-1c2d3e4f5a6b'

function notification(type, overrides = {}) {
  return {
    id: 'n',
    user_id: 'u',
    type,
    title: 't',
    message: 'm',
    data: {},
    read_at: null,
    created_at: '',
    expires_at: null,
    related_post_id: null,
    related_user_id: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------- 종류와 사본

test('스키마의 timebank_* 종류는 계획의 8종 그대로다', () => {
  assert.deepEqual([...TIMEBANK_TYPES].sort(), [...EXPECTED_TYPES].sort())
})

test('timebank_* 종류마다 이름표와 색이 있다', () => {
  for (const type of TIMEBANK_TYPES) {
    assert.ok(NOTIFICATION_TYPE_LABEL[type], `${type} 이름표가 없다`)
    assert.ok(NOTIFICATION_TYPE_COLOR[type], `${type} 색이 없다`)
  }
})

test('유니온(src/types/notification.ts)에 timebank_* 종류가 전부 있다', () => {
  const src = readFileSync('src/types/notification.ts', 'utf8')
  for (const type of TIMEBANK_TYPES) {
    assert.match(src, new RegExp(`\\| '${type}'`), `${type}이(가) NotificationType에 없다`)
  }
})

test('이동 함수에 timebank_* 종류마다 명시적 case가 있다 — default는 /board/{id}로 보내 404다', () => {
  const src = readFileSync('src/utils/notificationNavigation.ts', 'utf8')
  assert.ok(TIMEBANK_TYPES.length > 0, '스키마에서 timebank_* 종류를 하나도 못 뽑았다')
  for (const type of TIMEBANK_TYPES) {
    assert.match(src, new RegExp(`case '${type}'`), `${type}에 case가 없다`)
  }
})

test('timebank_* 알림은 /board/{id}로 떨어지지 않는다(글 id가 있어도)', () => {
  for (const type of TIMEBANK_TYPES) {
    const route = getNotificationRoute(notification(type, { related_post_id: LISTING_ID }))
    assert.ok(route, `${type}에 경로가 없다`)
    assert.notEqual(route, `/board/${LISTING_ID}`, `${type}이(가) default로 떨어졌다`)
  }
})

test('종류별 이동 경로(스펙 §10)', () => {
  const route = (type, o) => getNotificationRoute(notification(type, o))
  assert.equal(route('timebank_pending'), '/mypage/timebank#pending')
  assert.equal(route('timebank_confirmed'), '/mypage/timebank')
  assert.equal(route('timebank_rejected'), '/mypage/timebank')
  assert.equal(route('timebank_canceled'), '/mypage/timebank')
  assert.equal(route('timebank_credited'), '/mypage/timebank')
  assert.equal(
    route('timebank_comment', { related_post_id: LISTING_ID }),
    `/board/timebank/${LISTING_ID}`
  )
  assert.equal(
    route('timebank_volunteer', { related_post_id: LISTING_ID }),
    `/board/timebank/${LISTING_ID}`
  )
  assert.equal(route('timebank_withdrawal_negative'), '/board-room/timebank')
})

test('글 id가 UUID가 아니면 게시판 경로를 만들지 않는다(market_comment와 같은 모양)', () => {
  for (const type of ['timebank_comment', 'timebank_volunteer']) {
    for (const id of [null, '../admin', 'not-a-uuid']) {
      assert.equal(getNotificationRoute(notification(type, { related_post_id: id })), null)
      assert.equal(
        getNotificationRoute(notification(type, { related_post_id: id }), {
          fallbackToNotifications: true,
        }),
        '/notifications'
      )
    }
  }
})

// ---------------------------------------------------------------- 받는 사람

function row(overrides = {}) {
  return {
    id: 'tr-1',
    from_account: 'payer',
    to_account: 'payee',
    minutes: 90,
    kind: 'exchange',
    status: 'pending',
    created_by: 'payee',
    counterparty_id: 'payer',
    decided_by: null,
    decided_at: null,
    ref_type: null,
    ref_id: null,
    reverses_id: null,
    category: 'lesson',
    memo: null,
    from_name: '김지불',
    to_name: '이수령',
    approved_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

test('결정 알림: 상대가 확인하면 기록자에게, 기록자가 취소하면 상대에게', () => {
  assert.deepEqual(notify.pickRecipientsForDecision(row({ status: 'confirmed' }), 'payer'), [
    'payee',
  ])
  assert.deepEqual(notify.pickRecipientsForDecision(row({ status: 'rejected' }), 'payer'), [
    'payee',
  ])
  assert.deepEqual(notify.pickRecipientsForDecision(row({ status: 'canceled' }), 'payee'), [
    'payer',
  ])
})

test('결정 알림: 당사자가 아닌 사람(관리자 취소)이면 두 당사자 모두에게', () => {
  assert.deepEqual(
    notify.pickRecipientsForDecision(row({ status: 'canceled' }), 'admin-1').sort(),
    ['payee', 'payer']
  )
})

test('결정 알림: 조합 계좌와 비어 있는 칸에는 보내지 않는다', () => {
  assert.deepEqual(
    notify.pickRecipientsForDecision(
      row({ created_by: 'coop', counterparty_id: null, status: 'canceled' }),
      'admin-1'
    ),
    []
  )
})

test('관리자 취소 알림: 행위자를 뺀 모든 당사자 — 회원 간이면 두 사람, 조정이면 대상과 만든 관리자', () => {
  assert.deepEqual(
    notify.pickRecipientsForAdminCancel(row({ status: 'canceled' }), 'admin-1').sort(),
    ['payee', 'payer']
  )
  const adjustment = row({
    kind: 'adjustment',
    status: 'canceled',
    from_account: 'coop',
    to_account: 'member-1',
    created_by: 'admin-2',
    counterparty_id: null,
  })
  assert.deepEqual(notify.pickRecipientsForAdminCancel(adjustment, 'admin-1').sort(), [
    'admin-2',
    'member-1',
  ])
  // 만든 관리자가 스스로 거두면 대상에게만
  assert.deepEqual(notify.pickRecipientsForAdminCancel(adjustment, 'admin-2'), ['member-1'])
})

// ---------------------------------------------------------------- 발송 래퍼

function spy(overrides = {}) {
  const calls = { bulk: [], errors: [] }
  const deps = {
    createBulkNotifications: async input => {
      calls.bulk.push(input)
      return input.user_ids.length
    },
    log: { error: (m, meta) => calls.errors.push([m, meta]) },
    now: () => Date.UTC(2026, 10, 2),
    ...overrides,
  }
  return { deps, calls }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function assertExpiry(input) {
  assert.equal(input.expires_at, new Date(Date.UTC(2026, 10, 2) + THIRTY_DAYS_MS).toISOString())
}

test('기록 알림은 확인할 상대에게 timebank_pending으로 간다', async () => {
  const { deps, calls } = spy()
  await notify.notifyTransferPending(row(), deps)
  assert.equal(calls.bulk.length, 1)
  assert.equal(calls.bulk[0].type, 'timebank_pending')
  assert.deepEqual(calls.bulk[0].user_ids, ['payer'])
  assert.equal(calls.bulk[0].related_user_id, 'payee')
  assert.equal(calls.bulk[0].data.transfer_id, 'tr-1')
  assert.match(calls.bulk[0].message, /이수령/)
  assert.match(calls.bulk[0].message, /1시간 30분/)
  assertExpiry(calls.bulk[0])
})

test('기록 알림: 상대가 없으면(즉시 확정 kind) 보내지 않는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyTransferPending(row({ counterparty_id: null }), deps)
  assert.equal(calls.bulk.length, 0)
})

test('결정 알림은 상태에 맞는 종류로 다른 당사자에게 간다', async () => {
  for (const [status, type] of [
    ['confirmed', 'timebank_confirmed'],
    ['rejected', 'timebank_rejected'],
    ['canceled', 'timebank_canceled'],
  ]) {
    const { deps, calls } = spy()
    const actor = status === 'canceled' ? 'payee' : 'payer'
    await notify.notifyTransferDecided(row({ status }), actor, deps)
    assert.equal(calls.bulk.length, 1, status)
    assert.equal(calls.bulk[0].type, type)
    assert.deepEqual(calls.bulk[0].user_ids, [status === 'canceled' ? 'payer' : 'payee'])
    assertExpiry(calls.bulk[0])
  }
})

test('결정 알림: 아직 pending인 행이면 아무것도 보내지 않는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyTransferDecided(row({ status: 'pending' }), 'payer', deps)
  assert.equal(calls.bulk.length, 0)
})

test('적립 알림은 받은 회원에게 timebank_credited로 간다', async () => {
  const { deps, calls } = spy()
  await notify.notifyCredited({ memberId: 'm-1', kind: 'coop_task', minutes: 120 }, deps)
  assert.equal(calls.bulk.length, 1)
  assert.equal(calls.bulk[0].type, 'timebank_credited')
  assert.deepEqual(calls.bulk[0].user_ids, ['m-1'])
  assert.match(calls.bulk[0].message, /2시간/)
  assert.match(calls.bulk[0].message, /조합 업무/)
})

test('댓글 알림: 남이 쓰면 글쓴이에게, 글쓴이가 쓰면 앞서 댓글 단 사람들에게', async () => {
  const base = {
    listingId: LISTING_ID,
    listingTitle: '기타 레슨',
    authorId: 'author',
    commentId: 'c-1',
  }
  {
    const { deps, calls } = spy()
    await notify.notifyTimebankComment(
      { ...base, actorId: 'guest', priorCommenterIds: ['other'] },
      deps
    )
    assert.equal(calls.bulk[0].type, 'timebank_comment')
    assert.deepEqual(calls.bulk[0].user_ids, ['author'])
    assert.equal(calls.bulk[0].related_post_id, LISTING_ID)
  }
  {
    const { deps, calls } = spy()
    await notify.notifyTimebankComment(
      { ...base, actorId: 'author', priorCommenterIds: ['a', 'b', 'a', 'author'] },
      deps
    )
    assert.deepEqual(calls.bulk[0].user_ids.sort(), ['a', 'b'])
  }
  {
    const { deps, calls } = spy()
    await notify.notifyTimebankComment({ ...base, actorId: 'author', priorCommenterIds: [] }, deps)
    assert.equal(calls.bulk.length, 0)
  }
})

test('자원 알림은 조합 업무 글쓴이에게 가고, 스스로 자원하면 보내지 않는다', async () => {
  const input = {
    listingId: LISTING_ID,
    listingTitle: '공연 접수 돕기',
    authorId: 'admin-1',
    volunteerId: 'm-2',
  }
  {
    const { deps, calls } = spy()
    await notify.notifyVolunteer(input, deps)
    assert.equal(calls.bulk[0].type, 'timebank_volunteer')
    assert.deepEqual(calls.bulk[0].user_ids, ['admin-1'])
    assert.equal(calls.bulk[0].related_post_id, LISTING_ID)
    assert.equal(calls.bulk[0].related_user_id, 'm-2')
  }
  {
    const { deps, calls } = spy()
    await notify.notifyVolunteer({ ...input, volunteerId: 'admin-1' }, deps)
    assert.equal(calls.bulk.length, 0)
  }
})

test('음수 탈퇴 알림은 이사 전원에게(중복 없이) 가고, 이사가 없으면 보내지 않는다', async () => {
  {
    const { deps, calls } = spy()
    await notify.notifyNegativeWithdrawal({ directorIds: ['d1', 'd2', 'd1'], minutes: -300 }, deps)
    assert.equal(calls.bulk[0].type, 'timebank_withdrawal_negative')
    assert.deepEqual(calls.bulk[0].user_ids.sort(), ['d1', 'd2'])
    assert.match(calls.bulk[0].message, /5시간/)
  }
  {
    const { deps, calls } = spy()
    await notify.notifyNegativeWithdrawal({ directorIds: [], minutes: -300 }, deps)
    assert.equal(calls.bulk.length, 0)
  }
})

test('관리자 취소 알림은 timebank_canceled로 당사자 모두에게, 사유를 싣는다', async () => {
  const { deps, calls } = spy()
  await notify.notifyTransferCanceledByAdmin(
    row({ status: 'canceled' }),
    { adminId: 'admin-1', memo: '분쟁 정리' },
    deps
  )
  assert.equal(calls.bulk.length, 1)
  assert.equal(calls.bulk[0].type, 'timebank_canceled')
  assert.deepEqual([...calls.bulk[0].user_ids].sort(), ['payee', 'payer'])
  assert.match(calls.bulk[0].message, /관리자/)
  assert.match(calls.bulk[0].message, /분쟁 정리/)
  assert.equal(calls.bulk[0].data.by_admin, true)
  assertExpiry(calls.bulk[0])
})

test('발송이 던져도 래퍼는 절대 던지지 않고 오류만 남긴다', async () => {
  const boom = async () => {
    throw new Error('DB 폭발')
  }
  const { deps, calls } = spy({ createBulkNotifications: boom })
  await notify.notifyTransferPending(row(), deps)
  await notify.notifyTransferDecided(row({ status: 'confirmed' }), 'payer', deps)
  await notify.notifyCredited({ memberId: 'm-1', kind: 'signup_grant', minutes: 120 }, deps)
  await notify.notifyTimebankComment(
    {
      listingId: LISTING_ID,
      listingTitle: 't',
      authorId: 'a',
      commentId: 'c',
      actorId: 'b',
      priorCommenterIds: [],
    },
    deps
  )
  await notify.notifyVolunteer(
    { listingId: LISTING_ID, listingTitle: 't', authorId: 'a', volunteerId: 'b' },
    deps
  )
  await notify.notifyNegativeWithdrawal({ directorIds: ['d1'], minutes: -60 }, deps)
  assert.equal(calls.errors.length, 6)
})

test('입력이 망가져도(행 없음) 래퍼는 던지지 않는다', async () => {
  const { deps } = spy()
  await notify.notifyTransferPending(undefined, deps)
  await notify.notifyTransferDecided(null, 'x', deps)
})
