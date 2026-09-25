import { test, expect, request as apiRequest } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

test.describe('알림은 본인 것만 보인다', () => {
  test.use({ storageState: storageStatePath('other') })

  test('조합원 B의 알림 목록에 A의 알림이 없다', async ({ request }) => {
    const res = await request.get('/api/notifications')
    expect(res.status()).toBe(200)
    const body = await res.json()
    const items = body.data?.notifications ?? body.data ?? []
    const ids = items.map((n: { id: string }) => n.id)
    expect(ids).not.toContain(fixtures.notificationId)
  })

  test('남의 알림 삭제는 실제로는 삭제되지 않는다', async ({ request, baseURL }) => {
    // 실측: DELETE /api/notifications/[id](src/app/api/notifications/[id]/route.ts)는
    // `.eq('id', notificationId).eq('user_id', user.id)`로 필터링하지만 영향받은
    // 행 수를 확인하지 않는다. 그래서 소유하지 않은 알림 ID를 지워도 매치되는
    // 행이 0개일 뿐 supabase-js는 에러를 주지 않고, 라우트는 200 +
    // "알림이 삭제되었습니다"를 그대로 돌려준다 — 브리프가 가정한 403/404가
    // 아니다. 상태 코드만으로는 "막았다"를 판별할 수 없으므로, A(owner) 세션으로
    // 직접 조회해 알림이 실제로 남아 있는지를 확인한다. 이것이 이 테스트가
    // 확인해야 할 진짜 경계다: 응답 코드가 아니라 데이터의 생존 여부.
    const res = await request.delete(`/api/notifications/${fixtures.notificationId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.message).toContain('삭제되었습니다')

    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      const check = await ownerContext.get('/api/notifications')
      expect(check.status()).toBe(200)
      const checkBody = await check.json()
      const ids = (checkBody.data?.notifications ?? []).map((n: { id: string }) => n.id)
      expect(ids).toContain(fixtures.notificationId)
    } finally {
      await ownerContext.dispose()
    }
  })
})

test.describe('알림은 본인 것이 보인다', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('조합원 A의 알림 목록에 자기 알림이 있다', async ({ request }) => {
    const res = await request.get('/api/notifications')
    expect(res.status()).toBe(200)
    const body = await res.json()
    const items = body.data?.notifications ?? body.data ?? []
    const ids = items.map((n: { id: string }) => n.id)
    expect(ids).toContain(fixtures.notificationId)
  })
})

test.describe('마이페이지 프로필은 본인 것만 수정된다', () => {
  test.use({ storageState: storageStatePath('other') })

  test('프로필 수정은 자기 행에만 적용된다', async ({ request, baseURL }) => {
    // 실측: assertValidProfileBody(src/app/api/mypage/profile/route.ts)는
    // display_name과 phone_number를 둘 다 필수로 요구한다(부분 PATCH가 아니라
    // 전체 필드 검증). 브리프대로 display_name만 보내면 "전화번호는 필수입니다"
    // 400으로 소유권 경계 지점(where user.id) 이전에 막힌다.
    // monthly_fee도 생략하면 라우트가 기본값 0을 대입하는데, DB 체크 제약
    // (member_profiles_monthly_fee_check: 10000~50000)에 걸려 업데이트 자체가
    // 400 "프로필 업데이트에 실패했습니다"로 실패한다. 세 필드를 모두 유효값으로
    // 채워야 검증을 통과해 실제로 확인하려는 지점(자기 행에만 적용되는지)에
    // 도달한다.
    const res = await request.patch('/api/mypage/profile', {
      data: {
        display_name: 'authz-other-변경됨',
        phone_number: '010-1234-5678',
        monthly_fee: 10000,
      },
    })
    expect(res.status()).toBe(200)

    // 요청자 자신의 행에는 새 값이 들었다.
    const mine = await request.get('/api/mypage/profile')
    const body = await mine.json()
    expect(body.data?.display_name ?? body.data?.profile?.display_name).toBe('authz-other-변경됨')

    // **경계는 이 아래에 있다.** 위 단정은 B가 자기 행을 다시 읽은 것뿐이라
    // `updateProfile()`의 `.where(eq(id))`를 통째로 지워 **회원 전원의 프로필을
    // 덮어쓰게** 만들어도 그대로 통과한다(리뷰어가 실증: 실행 후 회원 4명의
    // display_name이 전부 `authz-other-변경됨`이 됐는데도 스위트는 초록이었다).
    // 남의 행이 안 바뀌었다는 것은 **남의 세션으로 읽어야** 드러난다 —
    // 같은 파일의 알림 테스트가 이미 쓰는 패턴이다.
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      const theirs = await ownerContext.get('/api/mypage/profile')
      expect(theirs.status()).toBe(200)
      const theirsBody = await theirs.json()
      expect(
        theirsBody.data?.display_name ?? theirsBody.data?.profile?.display_name,
        'B의 PATCH가 A의 행까지 덮어썼다 — 프로필 수정에 소유자 where가 걸려 있지 않다'
      ).toBe('authz-owner')
    } finally {
      await ownerContext.dispose()
    }
  })
})

test.describe('비인증 접근', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('알림 목록은 401이다', async ({ request }) => {
    const res = await request.get('/api/notifications')
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toContain('인증이 필요합니다')
  })

  test('마이페이지 프로필은 401이다', async ({ request }) => {
    const res = await request.get('/api/mypage/profile')
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toContain('인증이 필요합니다')
  })
})

/**
 * 개인정보 열람 기록은 **서버만 적을 수 있다.**
 *
 * 계좌·배송 주소가 나갈 때 남는 세 줄
 * (`member_account_viewed`·`funding_payout_account_viewed`·
 * `funding_shipping_exported`)은 "서버가 이 사람에게 그 값을 내보냈다"는 증거로
 * 쓰인다. 그런데 그 종류들이 클라이언트 기록 API의 허용 목록에 그대로 들어
 * 있어서, 로그인만 하면 누구나 같은 줄을 만들어 넣을 수 있었다 — 기록이
 * 증명하려던 바로 그 일을 기록이 증명하지 못하게 된다.
 */
test.describe('활동 기록 위조', () => {
  test.use({ storageState: storageStatePath('other') })

  const FORGEABLE = [
    'member_account_viewed',
    'funding_payout_account_viewed',
    'funding_shipping_exported',
    'member_approved',
    'admin_action',
  ]

  for (const actionType of FORGEABLE) {
    test(`조합원은 ${actionType} 기록을 만들지 못한다`, async ({ request }) => {
      const res = await request.post('/api/activities/log', {
        data: { action_type: actionType, target_type: 'system' },
      })
      expect(res.status(), `${actionType}이(가) 그대로 원장에 들어갔다`).toBe(400)
      expect((await res.json()).error).toContain('action_type')
    })
  }

  test('배치로 우회해도 같은 줄은 들어가지 않는다', async ({ request }) => {
    const res = await request.post('/api/activities/batch-log', {
      data: {
        logs: [
          { action_type: 'member_account_viewed', target_type: 'system' },
          { action_type: 'page_viewed', target_type: 'system', metadata: { path: '/' } },
        ],
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // 배치는 항목별로 성공·실패를 돌려준다 — 위조 한 줄만 떨어지고 정상 한
    // 줄은 그대로 기록돼야 한다(정상 기록을 함께 죽이면 고친 게 아니다).
    expect(body.data.failed, '위조 항목이 배치로 들어갔다').toBe(1)
    expect(body.data.processed).toBe(1)
    expect(body.data.errors[0].index).toBe(0)
  })

  test('평범한 참여 기록은 그대로 남는다', async ({ request }) => {
    // 이 허용 목록이 존재하는 이유다. 좁히다가 이쪽을 함께 막으면
    // 화면의 활동 로깅이 통째로 400이 된다.
    for (const actionType of ['page_viewed', 'login', 'search_performed']) {
      const res = await request.post('/api/activities/log', {
        data: { action_type: actionType, target_type: 'system' },
      })
      expect(res.status(), `정상 기록 ${actionType}이(가) 막혔다`).toBe(200)
    }
  })
})
