import { test as setup, expect } from '@playwright/test'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

const ACCOUNTS = [
  { role: 'admin', email: 'authz-admin@test.local', password: 'Authz!Admin2026' },
  { role: 'owner', email: 'authz-owner@test.local', password: 'Authz!Owner2026' },
  { role: 'other', email: 'authz-other@test.local', password: 'Authz!Other2026' },
  { role: 'pending', email: 'authz-pending@test.local', password: 'Authz!Pend2026' },
  // 관리자가 아닌 이사. 이사회 경계(`authz-roles.spec.ts`)의 허용 쪽이다 —
  // 계정 정의는 `scripts/testing/seed-authz-fixtures.mjs`의 ACCOUNTS와 짝이다.
  { role: 'director', email: 'authz-director@test.local', password: 'Authz!Direct2026' },
  // 탈퇴 "신청" 상태(Task 8) — `registration_status`는 여전히 'approved'라
  // 정상 로그인된다. 신청 중에도 마이페이지·게시판 접근이 그대로임을
  // `authz-roles.spec.ts`가 이 storageState로 확인한다.
  {
    role: 'withdrawalRequested',
    email: 'authz-withdrawal-requested@test.local',
    password: 'Authz!WithdrawReq2026',
  },
]

for (const account of ACCOUNTS) {
  setup(`${account.role} 로그인 상태를 저장한다`, async ({ page }) => {
    assertLocalTurso()

    await page.goto('/login')
    // 라벨 텍스트(`이메일 주소`/`비밀번호`)는 messages/ko.json에서 오므로 문구가
    // 바뀌면 조용히 깨진다. 폼의 id는 src/app/[locale]/login/page.tsx:447,468에
    // 하드코딩돼 있어 더 안정적이다.
    await page.locator('#email-address').fill(account.email)
    await page.locator('#password').fill(account.password)
    await page.locator('form button[type="submit"]').click()

    // 실측: 로그인 성공 후 URL은 그대로 /login에 머문다. `/login` 페이지는
    // `redirect` 쿼리 파라미터가 명시된 경우에만 자동 이동하고(src/app/[locale]/
    // login/page.tsx:31-32, 127-136), 그 외(우리 setup처럼 `/login`으로 직접
    // 이동한 경우)에는 승인된 사용자라도 같은 URL에서 "로그인에 성공했습니다"
    // 패널로 전환될 뿐이다(그 상태에서만 이동은 버튼 클릭으로 한다). 승인 대기/
    // 거절 계정만 각각 /register/pending, /register/rejected로 자동 이동한다.
    // 두 경우 모두 세션 쿠키는 이미 생겼으므로, URL이 아니라 로그인 폼(#email-address)이
    // 화면에서 사라졌는지로 완료를 판정한다 — 폼은 `isAlreadyLoggedIn`이 아닐 때만
    // 렌더되므로(같은 파일:398,443), 페이지에 남아 있든 다른 곳으로 이동했든 이 조건은
    // 로그인 완료의 신뢰할 수 있는 신호다.
    await expect(page.locator('#email-address')).toHaveCount(0, { timeout: 15_000 })

    await page.context().storageState({ path: storageStatePath(account.role) })
  })
}
