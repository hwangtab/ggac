import { test, expect, request as apiRequest } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 유지보수 모드를 켜고 끈다.
 *
 * 단계 4(Task 4)에서 미들웨어가 `system_settings`를 **Turso**에서 읽도록
 * 바뀌었는데(`src/middleware/settings.ts`) 이 헬퍼는 Supabase REST를 계속
 * PATCH하고 있었다. 그래서 스펙이 유지보수 모드를 "켜도" 미들웨어가 보는
 * 값은 영원히 꺼짐이었다 — 503을 기대하는 두 건은 깨지고, "503이 아니어야
 * 한다"는 세 건은 유지보수가 애초에 안 켜졌으니 **아무것도 검증하지 않은
 * 채** 초록불이었다. 이제 미들웨어가 실제로 읽는 그 행을 직접 쓴다.
 *
 * `rowsAffected`를 확인하는 이유가 이 스펙의 핵심이다. 시드가
 * `system_settings` 행을 만들지 않으면 UPDATE는 0행에 적용되고 아무 에러도
 * 나지 않는다 — 그 상태에서도 "503이 아니다" 단정들은 그대로 통과한다.
 * 같은 종류의 조용한 무력화가 재발하지 않도록 여기서 fail-closed로 막는다
 * (행은 `scripts/testing/seed-authz-fixtures.mjs`가 심는다).
 */
async function setMaintenance(enabled: boolean) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
            WHERE category = 'site' AND setting_key = 'maintenance_mode'`,
      args: [JSON.stringify({ enabled, message: '점검 중입니다.' }), Date.now()],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `유지보수 설정 실패: system_settings(site/maintenance_mode) 행이 ${res.rowsAffected}개 갱신됐다. ` +
          '픽스처 시드(scripts/testing/seed-authz-fixtures.mjs)를 먼저 돌렸는지 확인할 것.'
      )
    }
  } finally {
    client.close()
  }
}

/**
 * "503이 아니다" 계열 단정은 **유지보수가 실제로 켜져 있을 때만** 무언가를
 * 증명한다. 유지보수가 꺼져 있으면 아무 봉쇄도 없으니 당연히 503이 아니고,
 * 그 통과는 예외 경로(인증·헬스체크·관리자)에 대해 아무 말도 하지 않는다 —
 * 이번 사고(시드 누락 + 저장소 불일치)가 정확히 그 모습이었다.
 *
 * 그래서 그 세 건은 세션이 전혀 없는 별도 컨텍스트로 봉쇄 대상 경로가
 * 실제로 503인지 먼저 확인한 뒤에 예외를 단정한다. `request` 픽스처는
 * describe의 storageState(관리자 등)를 물고 있어 이 확인에 쓸 수 없다.
 */
async function expectMaintenanceIsActuallyOn(baseURL: string | undefined) {
  const anon = await apiRequest.newContext({ baseURL, storageState: undefined })
  try {
    expect(
      (await anon.get('/board')).status(),
      '유지보수가 실제로 켜지지 않았다면 아래 예외 단정은 아무것도 증명하지 않는다'
    ).toBe(503)
  } finally {
    await anon.dispose()
  }
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

    test('인증 경로는 열려 있다', async ({ request, baseURL }) => {
      await setMaintenance(true)
      await expectMaintenanceIsActuallyOn(baseURL)
      const res = await request.get('/api/auth/get-session')
      expect(res.status()).not.toBe(503)
    })

    test('헬스체크는 열려 있다', async ({ request, baseURL }) => {
      await setMaintenance(true)
      await expectMaintenanceIsActuallyOn(baseURL)
      const res = await request.get('/api/health')
      expect(res.status()).toBe(200)
    })
  })

  test.describe('관리자', () => {
    test.use({ storageState: storageStatePath('admin') })

    test('관리자는 유지보수 중에도 통과한다', async ({ request, baseURL }) => {
      await setMaintenance(true)
      await expectMaintenanceIsActuallyOn(baseURL)
      const res = await request.get('/api/notifications')
      expect(res.status()).not.toBe(503)
    })
  })
})
