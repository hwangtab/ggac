import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 활동 기록의 **허용 목록이 두 개로 갈라져 있는지** 확인한다.
 *
 * 감사(2026-09-25): 계좌·배송 열람 기록 세 종류가 클라이언트가 쓸 수 있는
 * 허용 목록에 그대로 들어 있었다. `/api/activities/log`는 로그인만 했으면
 * 누구나 부를 수 있으므로, "서버가 이 사람에게 계좌를 내보냈다"는 증거를
 * 아무나 만들 수 있었다는 뜻이다.
 *
 * 라우트가 실제로 거절하는지는 `e2e/authz-personal.spec.ts`가 돌아가는
 * 서버에 진짜 요청을 보내 본다. 이 파일은 목록 자체와, 목록을 읽는 함수가
 * 무엇을 통과시키는지를 맡는다.
 */

registerAliasResolveHook(import.meta.url)

const {
  ACTIVITY_ACTION_TYPES,
  CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES,
  SERVER_ONLY_ACTIVITY_ACTION_TYPES,
  parseActivityActionType,
  parseClientActivityActionType,
} = await import('../../src/constants/activity.ts')

/** 값이 나가기 전에 서버가 남기는 세 줄. 위조되면 기록 전체가 값을 잃는다. */
const PERSONAL_DATA_AUDIT_TYPES = [
  'member_account_viewed',
  'funding_payout_account_viewed',
  'funding_shipping_exported',
]

test('개인정보 열람 기록은 브라우저가 적지 못한다', () => {
  for (const type of PERSONAL_DATA_AUDIT_TYPES) {
    assert.equal(
      parseClientActivityActionType(type),
      null,
      `${type}을(를) 클라이언트가 그대로 적을 수 있다 — 증거가 증거가 아니게 된다`
    )
    assert.ok(SERVER_ONLY_ACTIVITY_ACTION_TYPES.includes(type))
  }
})

test('승인·심사·관리 행위와 결제 전이도 브라우저가 적지 못한다', () => {
  // 같은 종류의 거짓말이다 — 조합원이 스스로 "관리자가 나를 승인했다"를
  // 적을 수 있으면 관리자 화면의 활동 기록은 읽을 가치가 없다.
  for (const type of [
    'member_approved',
    'member_rejected',
    'admin_action',
    'funding_campaign_reviewed',
    'funding_pledge_paid',
    'funding_pledge_canceled',
    'funding_fulfillment_updated',
    'attachment_downloaded',
    'password_changed',
    'email_changed',
  ]) {
    assert.equal(parseClientActivityActionType(type), null, `${type}이(가) 위조 가능하다`)
  }
})

test('평범한 참여 기록은 그대로 통과한다 — 화면의 로깅을 죽이지 않는다', () => {
  for (const type of [
    'login',
    'logout',
    'page_viewed',
    'post_created',
    'post_updated',
    'comment_created',
    'like_added',
    'like_removed',
    'profile_updated',
    'file_uploaded',
    'search_performed',
    'notification_read',
  ]) {
    assert.equal(parseClientActivityActionType(type), type, `정상 기록 ${type}이(가) 막혔다`)
  }
})

test('클라이언트가 보내는 종류가 전부 허용 목록에 있다', () => {
  // 허용 목록을 좁히면서 화면이 실제로 보내는 종류를 빠뜨리면, 그 화면의
  // 기록만 조용히 400이 된다(fire-and-forget이라 아무도 모른다). 소스에서
  // 실제로 보내는 값을 긁어 대조한다.
  const sources = [
    readFileSync('src/utils/activityLogger.ts', 'utf8'),
    readFileSync('src/app/[locale]/login/page.tsx', 'utf8'),
  ].join('\n')

  const sent = new Set([...sources.matchAll(/action_type:\s*'([a-z_]+)'/g)].map(match => match[1]))
  assert.ok(sent.size > 0, '보내는 종류를 하나도 못 찾았다 — 정규식이 낡았다')

  for (const type of sent) {
    assert.ok(
      CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES.includes(type),
      `${type}을(를) 화면이 보내는데 허용 목록에 없다 — 그 기록이 조용히 400이 된다`
    )
  }
})

test('두 목록을 합치면 원장의 전체 목록이고, 겹치지 않는다', () => {
  assert.deepEqual(
    [...ACTIVITY_ACTION_TYPES].sort(),
    [...CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES, ...SERVER_ONLY_ACTIVITY_ACTION_TYPES].sort()
  )
  const overlap = CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES.filter(type =>
    SERVER_ONLY_ACTIVITY_ACTION_TYPES.includes(type)
  )
  assert.deepEqual(overlap, [], '한 종류가 양쪽에 있으면 서버 전용이라는 말이 거짓이 된다')
})

test('DB 스키마의 종류 목록과 어긋나지 않는다', () => {
  // 사본이 셋이다(`src/constants/activity.ts`·`src/db/schema/ops.ts`·
  // `src/types/activity.ts`). 목록을 둘로 가르면서 한쪽만 손대면 조용히
  // 갈라진다 — 이 저장소가 여러 번 밟은 함정이다.
  const opsSource = readFileSync('src/db/schema/ops.ts', 'utf8')
  const block = opsSource.slice(
    opsSource.indexOf('export const ACTIVITY_ACTION_TYPE ='),
    opsSource.indexOf('export const ACTIVITY_TARGET_TYPE =')
  )
  const schemaTypes = [...block.matchAll(/'([a-z_]+)'/g)].map(match => match[1])
  assert.deepEqual([...schemaTypes].sort(), [...ACTIVITY_ACTION_TYPES].sort())
})

test('관리자 필터는 여전히 서버 전용 종류도 고를 수 있다', () => {
  // 필터는 "이미 쓰인 값을 고르는" 것이라 좁히면 안 된다 — 계좌 열람 기록을
  // 화면에서 걸러 볼 수 없게 되면 기록을 남긴 의미가 반쯤 사라진다.
  for (const type of PERSONAL_DATA_AUDIT_TYPES) {
    assert.equal(parseActivityActionType(type), type)
  }
})

test('모르는 값과 문자열이 아닌 값은 양쪽 모두 거절한다', () => {
  for (const value of ['', 'nope', 'MEMBER_ACCOUNT_VIEWED', null, undefined, 1, {}, ['login']]) {
    assert.equal(parseClientActivityActionType(value), null)
    assert.equal(parseActivityActionType(value), null)
  }
})
