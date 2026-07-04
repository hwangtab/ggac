import { expect, test } from '@playwright/test'

// 이 스펙은 2·3단계 감사에서 강화한 권한 경계(비인증 변이 차단·보호 페이지
// 리다이렉트)와 API 응답 계약의 회귀를 방지한다. 모든 단언은 인증 세션·실데이터
// 없이 결정적으로 통과하도록 설계했다. 로그인 쿠키가 없는 요청은 미들웨어/서버
// 권한 헬퍼가 DB 조회 이전에 401/리다이렉트로 응답하므로 운영 DB 연결과 무관하다.

test.describe('권한 경계 회귀 (비인증)', () => {
  // 임의의 형식상 유효한 UUID. UUID 검증을 통과시켜 인증 게이트까지 도달시키기
  // 위한 값으로, 실제 레코드 존재 여부와 무관하다(인증 실패가 DB 조회보다 앞선다).
  const VALID_UUID = '00000000-0000-4000-8000-000000000000'

  // board-room 변이 API는 모두 requireBoardMember()로 게이트되며,
  // 비인증 요청은 DB 접근 이전에 401을 반환한다(src/lib/server/boardRoomAuth.ts).
  const boardRoomMutations: Array<{
    method: 'post' | 'put'
    path: string
    data: Record<string, unknown>
  }> = [
    {
      method: 'post',
      path: '/api/board-room/agendas',
      data: { meeting_id: VALID_UUID, title: 'x' },
    },
    { method: 'post', path: '/api/board-room/meetings', data: { title: 'x' } },
    {
      method: 'post',
      path: '/api/board-room/minutes',
      data: { meeting_id: VALID_UUID, content: 'x' },
    },
    { method: 'post', path: '/api/board-room/documents', data: { meeting_id: VALID_UUID } },
    { method: 'put', path: '/api/board-room/date-votes', data: { meeting_id: VALID_UUID } },
    { method: 'put', path: '/api/board-room/attendees', data: { meeting_id: VALID_UUID } },
  ]

  for (const { method, path, data } of boardRoomMutations) {
    test(`비인증 ${method.toUpperCase()} ${path} 는 401을 반환한다`, async ({ request }) => {
      const response = await request[method](path, { data })
      expect(response.status()).toBe(401)
    })
  }

  test('비인증 comment-like POST 는 401을 반환한다', async ({ request }) => {
    // 순서: rate-limit → UUID 검증 → 인증(getUser) → DB. 유효한 UUID를 보내
    // UUID 검증을 통과시키면 인증 게이트에서 401로 응답한다(DB 무관).
    const response = await request.post(`/api/comments/${VALID_UUID}/like`)
    expect(response.status()).toBe(401)
  })
})

test.describe('보호 페이지 리다이렉트 (비인증)', () => {
  // localePrefix 'as-needed' + defaultLocale 'ko' 환경에서 로케일 협상을 고정.
  test.use({ locale: 'ko-KR' })

  // 미들웨어(src/middleware/auth.ts)가 isProtectedPage 로 분류해 비로그인
  // 사용자를 /login 으로 리다이렉트하는 경로들. 인증 세션이 없어도 결정적이다.
  const guardedPaths = ['/mypage', '/mypage/profile', '/mypage/settings', '/en/mypage']

  for (const path of guardedPaths) {
    test(`비로그인 사용자는 ${path} 접근 시 로그인으로 리다이렉트된다`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    })
  }

  test('마이페이지 리다이렉트는 원래 경로를 redirect 쿼리에 보존한다', async ({ page }) => {
    await page.goto('/mypage/profile', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    const redirectedUrl = new URL(page.url())
    expect(redirectedUrl.searchParams.get('redirect')).toBe('/mypage/profile')
  })
})

test.describe('API 응답 계약 회귀', () => {
  // GET /api/profiles 는 { success:true, data } 계약을 유지해야 한다.
  // ids 가 없으면 DB 접근 없이 빈 배열을 반환하므로 계약을 결정적으로 검증한다.
  test('GET /api/profiles(ids 없음)는 200 + { success:true, data:[] } 계약을 지킨다', async ({
    request,
  }) => {
    const response = await request.get('/api/profiles')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toEqual([])
  })

  // public_profiles 뷰 폴백 경로(3단계 뷰 복원)의 계약 유지. ids 조회는 DB에
  // 의존하므로, 200이면 형태만 검증하고 그 외에는 skip+경고(무음 skip 금지).
  test('GET /api/profiles(ids 지정)는 200일 때 배열 계약을 유지한다 (DB 의존)', async ({
    request,
  }) => {
    const response = await request.get('/api/profiles?ids=00000000-0000-4000-8000-000000000000')
    if (response.status() !== 200) {
      test.skip(
        true,
        `profiles ids 조회가 200이 아님(status=${response.status()}). DB 미연결로 간주하고 skip.`
      )
      return
    }
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })
})
