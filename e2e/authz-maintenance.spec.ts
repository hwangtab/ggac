import { test, expect } from '@playwright/test'

import { assertLocalSupabase, storageStatePath } from './helpers/authState'

assertLocalSupabase()

const SUPABASE = process.env.E2E_SUPABASE_URL!
const KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!

async function setMaintenance(enabled: boolean) {
  const res = await fetch(`${SUPABASE}/rest/v1/system_settings?setting_key=eq.maintenance_mode`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ setting_value: { enabled, message: '점검 중입니다.' } }),
  })
  if (!res.ok) throw new Error(`유지보수 설정 실패: ${res.status} ${await res.text()}`)
}

test.describe('유지보수 모드', () => {
  test.afterEach(async () => {
    await setMaintenance(false)
  })

  test.describe('비로그인', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('페이지는 503이다', async ({ request }) => {
      await setMaintenance(true)
      const res = await request.get('/board')
      expect(res.status()).toBe(503)
    })

    test('쓰기 API도 503이다', async ({ request }) => {
      await setMaintenance(true)
      const res = await request.post('/api/posts', {
        data: { title: '점검 중 글', content: '<p>x</p>', category: '잡담' },
      })
      // 유지보수가 인증보다 먼저 걸린다 — 401이 아니라 503이어야 한다.
      expect(res.status()).toBe(503)
    })

    test('인증 경로는 열려 있다', async ({ request }) => {
      await setMaintenance(true)
      const res = await request.get('/api/auth/get-session')
      expect(res.status()).not.toBe(503)
    })

    test('헬스체크는 열려 있다', async ({ request }) => {
      await setMaintenance(true)
      const res = await request.get('/api/health')
      expect(res.status()).toBe(200)
    })
  })

  test.describe('관리자', () => {
    test.use({ storageState: storageStatePath('admin') })

    test('관리자는 유지보수 중에도 통과한다', async ({ request }) => {
      await setMaintenance(true)
      const res = await request.get('/api/notifications')
      expect(res.status()).not.toBe(503)
    })
  })
})
