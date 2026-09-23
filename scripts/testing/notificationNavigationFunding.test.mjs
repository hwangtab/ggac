import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getNotificationRoute } from '../../src/utils/notificationNavigation.ts'
import { NOTIFICATION_TYPE } from '../../src/db/schema/content.ts'
import {
  NOTIFICATION_TYPE_COLOR,
  NOTIFICATION_TYPE_LABEL,
} from '../../src/constants/notificationTypes.ts'

/**
 * 펀딩 알림이 화면에서 실제로 쓸모가 있는가.
 *
 * 다섯 종류는 이 브랜치 전에도 유니온에 있었지만 아무도 만든 적이 없어
 * 아무도 몰랐다 — 목록에서는 `funding_pledged`라는 영문 식별자가 그대로
 * 보이고, 눌러도 아무 데도 가지 않았다. 알림을 실제로 만들기 시작하면
 * 그것이 후원자가 처음 보는 화면이 된다.
 *
 * **목록을 손으로 적지 않는다.** 손으로 적었더니 `funding_shipped`가 한 회차
 * 동안 빠져 있었고(정산 작업에서 발견), 빠진 종류는 검사되지 않는다는 것을
 * 아무도 몰랐다. 스키마의 종류 배열에서 뽑아 쓴다 — 종류를 늘리면 다음 줄이
 * 저절로 늘어난다.
 */
const FUNDING_TYPES = NOTIFICATION_TYPE.filter(t => t.startsWith('funding_'))

test('스키마에서 뽑은 펀딩 종류가 비어 있지 않다', () => {
  // 필터가 빗나가면(접두어 규칙이 바뀌면) 아래 검사들이 0건을 돌며 조용히
  // 통과한다. 그 상태를 실패로 만든다.
  assert.ok(FUNDING_TYPES.length >= 9, `펀딩 종류가 ${FUNDING_TYPES.length}개뿐이다`)
})

function notification(type, data = {}) {
  return {
    id: 'n',
    user_id: 'u',
    type,
    title: 't',
    message: 'm',
    data,
    read_at: null,
    created_at: '',
    expires_at: null,
    related_post_id: null,
    related_user_id: null,
  }
}

test('펀딩 알림이 전부 갈 곳이 있다', () => {
  for (const type of FUNDING_TYPES) {
    const route = getNotificationRoute(notification(type))
    assert.ok(route, `${type}에 경로가 없다`)
    assert.ok(route.startsWith('/'), `${type}의 경로가 이상하다: ${route}`)
  }
})

test('저장해 둔 data.url을 경로로 되돌려 쓴다 — 로케일 접두어는 뗀다', () => {
  assert.equal(
    getNotificationRoute(
      notification('funding_pledged', { url: 'https://ggac.kr/ko/mypage/funding' })
    ),
    '/mypage/funding'
  )
  assert.equal(
    getNotificationRoute(
      notification('funding_approved', { url: 'https://ggac.kr/ko/funding/my-album' })
    ),
    '/funding/my-album'
  )
  assert.equal(
    getNotificationRoute(
      notification('funding_submitted', { url: 'https://ggac.kr/ko/admin/funding' })
    ),
    '/admin/funding'
  )
  assert.equal(
    getNotificationRoute(
      notification('funding_closed', { url: 'https://ggac.kr/en/mypage/funding/x' })
    ),
    '/mypage/funding/x'
  )
})

test('앱 밖으로 튕겨 보내지 않는다', () => {
  // 다른 도메인이든 프로토콜 상대 주소든, 경로만 남기거나 기본값으로 돌아간다.
  assert.equal(
    getNotificationRoute(notification('funding_pledged', { url: '//evil.example.com/x' })),
    '/mypage/funding'
  )
  assert.equal(
    getNotificationRoute(notification('funding_pledged', { url: 'javascript:alert(1)' })),
    '/mypage/funding'
  )
  for (const bad of [null, 123, '', {}]) {
    assert.equal(
      getNotificationRoute(notification('funding_closed', { url: bad })),
      '/mypage/funding'
    )
  }
})

test('url이 없어도 종류별 기본 목적지가 있다', () => {
  assert.equal(getNotificationRoute(notification('funding_submitted')), '/admin/funding')
  assert.equal(getNotificationRoute(notification('funding_refunded')), '/mypage/funding')
  assert.equal(getNotificationRoute(notification('funding_settled')), '/mypage/funding')
})

test('알림 목록 화면의 표가 펀딩 종류를 전부 안다', () => {
  // 소스를 정규식으로 훑던 자리다. 이제 화면과 같은 표를 직접 읽는다 —
  // 표가 `Record<NotificationType, string>`이라 종류를 늘리면 `tsc`가 먼저
  // 막고, 스키마와의 대조는 이 테스트가 한다.
  for (const type of FUNDING_TYPES) {
    assert.ok(NOTIFICATION_TYPE_LABEL[type], `${type}의 한글 이름이 없다`)
    assert.ok(NOTIFICATION_TYPE_COLOR[type], `${type}의 색이 없다`)
    // 영문 식별자가 그대로 보이던 것이 출발점이므로 이름이 식별자면 실패다.
    assert.notEqual(NOTIFICATION_TYPE_LABEL[type], type, `${type}의 이름이 식별자 그대로다`)
  }
})

test('스키마의 모든 알림 종류에 이름표와 색이 있다', () => {
  // 펀딩만의 문제가 아니다 — 새 종류가 어느 갈래든 이름 없이 목록에 뜨면
  // 사용자는 영문 식별자를 본다.
  for (const type of NOTIFICATION_TYPE) {
    assert.ok(NOTIFICATION_TYPE_LABEL[type], `${type}의 한글 이름이 없다`)
    assert.ok(NOTIFICATION_TYPE_COLOR[type], `${type}의 색이 없다`)
  }
})
