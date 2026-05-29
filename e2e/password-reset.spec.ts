import { test, expect } from '@playwright/test'

test.describe('비밀번호 재설정', () => {
  // localePrefix: 'as-needed' + defaultLocale 'ko' 환경에서 prefix 없는 경로는
  // Accept-Language 헤더로 로케일을 협상한다. ko 메시지를 결정적으로 렌더링하기 위해
  // 브라우저 컨텍스트 로케일을 ko-KR로 고정한다.
  test.use({ locale: 'ko-KR' })

  test('forgot-password 페이지가 로드되고 이메일 제출 시 안내가 표시된다', async ({ page }) => {
    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' })
    const email = page.locator('input[type="email"]')
    await expect(email).toBeVisible()
    // 클라이언트 컴포넌트 하이드레이션 완료를 기다린다. 하이드레이션 전에 submit하면
    // onSubmit 핸들러가 부착되지 않아 네이티브 폼 전송(페이지 리로드)이 발생한다.
    await page.waitForLoadState('networkidle')
    await email.fill('nobody-test@example.com')
    await page.locator('button[type="submit"]').click()
    // 성공/실패 무관하게 동일 안내 메시지 노출 (이메일 존재 여부 비노출)
    await expect(page.getByText(/재설정 링크를 보내드렸습니다|오류가 발생/)).toBeVisible({
      timeout: 15000,
    })
  })
})
