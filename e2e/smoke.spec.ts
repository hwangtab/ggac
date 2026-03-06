import { test, expect } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('메인 페이지가 정상 로드된다', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/경기아트콜렉티브|GGAC/i)
  })

  test('헤더 네비게이션 링크가 존재한다', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav, header')
    await expect(nav.first()).toBeVisible()
  })

  test('메인 페이지가 500 에러 없이 응답한다', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(500)
  })
})
