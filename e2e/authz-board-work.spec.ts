import { test, expect } from '@playwright/test'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무툴(kosmart-work 이식) 권한 경계 — docs/board-work/01-설계.md §10.
 *
 * 원본은 Postgres RLS가 막았다. 여기에는 RLS가 없어서 **이 스펙이 안전망**이다
 * (scripts/testing/assert-runtime-risks.mjs의 server action 검사는 문자열만 본다).
 * 단계마다 케이스를 늘린다. 0단계는 진입 게이트 하나다.
 *
 * authz-roles.spec.ts와 같은 규칙: **짝지어 단정한다.** 금지 쪽 리다이렉트만 보면
 * 게이트가 "전원 리다이렉트"로 퇴화해도(이사도 못 들어가는 상태) 초록이다.
 */
test.describe('업무툴 진입', () => {
  test('일반 조합원은 /board로 돌아가고, 관리자가 아닌 이사는 업무툴을 연다', async ({
    browser,
  }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })
    const directorContext = await browser.newContext({
      storageState: storageStatePath('director'),
    })

    try {
      // 금지 쪽: 승인된 **일반** 조합원(미승인 계정은 앞선 승인 분기에 먼저 걸려 이사 판정을 검사하지 못한다).
      const memberPage = await memberContext.newPage()
      await memberPage.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(memberPage).toHaveURL(/\/board$/, { timeout: 15000 })

      // 허용 쪽: **관리자가 아닌 이사**(admin으로 보면 is_admin 분기만 타서 is_director 판정이 검사되지 않는다).
      const directorPage = await directorContext.newPage()
      await directorPage.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(directorPage).toHaveURL(/\/board-room\/chat$/, { timeout: 15000 })
      // 게이트를 지나 화면이 실제로 그려졌는지 — 가드가 넘겨 준 역할까지 본다(이사 = 구성원, 관리자 아님).
      await expect(
        directorPage.getByRole('heading', { name: '이사회 업무툴', level: 1 })
      ).toBeVisible({
        timeout: 15000,
      })
      await expect(directorPage.getByTestId('board-work-staff')).toContainText('구성원')
      // 업무툴은 전역 내비·이사회실 메뉴 없이 앱 셸만 그린다(ConditionalLayout·board-room/layout).
      await expect(directorPage.getByRole('navigation', { name: '이사회 메뉴' })).toHaveCount(0)
    } finally {
      await memberContext.close()
      await directorContext.close()
    }
  })
})
