import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getNotificationRoute } from '../../src/utils/notificationNavigation.ts'

/**
 * 펀딩 알림이 화면에서 실제로 쓸모가 있는가.
 *
 * 다섯 종류는 이 브랜치 전에도 유니온에 있었지만 아무도 만든 적이 없어
 * 아무도 몰랐다 — 목록에서는 `funding_pledged`라는 영문 식별자가 그대로
 * 보이고, 눌러도 아무 데도 가지 않았다. 알림을 실제로 만들기 시작하면
 * 그것이 후원자가 처음 보는 화면이 된다.
 */

const FUNDING_TYPES = [
  'funding_submitted',
  'funding_approved',
  'funding_rejected',
  'funding_pledged',
  'funding_closed',
  'funding_delivery_changed',
  'funding_refunded',
  'funding_shipped',
  'funding_settled',
]

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

test('펀딩 알림 아홉 종류가 전부 갈 곳이 있다', () => {
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

test('알림 목록 화면이 아홉 종류의 한글 이름과 색을 안다', () => {
  const source = readFileSync(
    new URL('../../src/app/[locale]/notifications/page.tsx', import.meta.url),
    'utf8'
  )
  // 이름표에 영문 식별자가 그대로 보이던 것이 출발점이라, 두 표 모두에
  // 항목이 있는지를 문자열로 확인한다.
  const names = source.slice(source.indexOf('const getTypeName'))
  const colors = source.slice(
    source.indexOf('const getTypeColor'),
    source.indexOf('const getTypeName')
  )
  for (const type of FUNDING_TYPES) {
    assert.ok(names.includes(`${type}:`), `${type}의 한글 이름이 없다`)
    assert.ok(colors.includes(`${type}:`), `${type}의 색이 없다`)
  }
})
