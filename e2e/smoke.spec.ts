import { test, expect } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('메인 페이지가 정상 로드된다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/경기아트콜렉티브|GGAC/i)
  })

  test('헤더 네비게이션 링크가 존재한다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // 내비는 fixed라서 이를 감싼 <header>는 높이 0이다. 랜드마크 래퍼가 아니라
    // 실제 내비게이션의 가시성을 검사해야 한다.
    await expect(page.locator('nav#navigation')).toBeVisible()
  })

  test('메인 페이지가 500 에러 없이 응답한다', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(500)
  })

  test('게시판은 잘못된 page 쿼리를 canonical에 반영하지 않는다', async ({ page }) => {
    const response = await page.goto('/board?page=1.5', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(500)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toBeTruthy()
    const canonicalUrl = new URL(canonical!, page.url())
    expect(canonicalUrl.pathname).toBe('/board')
    expect(canonicalUrl.search).toBe('')
  })

  test('게시글 상세/수정은 잘못된 id를 DB 조회나 로그인 redirect로 넘기지 않는다', async ({
    page,
  }) => {
    const detailResponse = await page.goto('/board/not-a-uuid', {
      waitUntil: 'domcontentloaded',
    })
    expect(detailResponse?.status()).toBeLessThan(500)

    const editResponse = await page.goto('/board/not-a-uuid/edit', {
      waitUntil: 'domcontentloaded',
    })
    expect(editResponse?.status()).toBeLessThan(500)
    expect(new URL(page.url()).pathname).not.toContain('/login')
  })

  test('프로젝트 목록은 잘못된 page 쿼리를 canonical에 반영하지 않는다', async ({ page }) => {
    const response = await page.goto('/projects?page=1.5', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(500)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toBeTruthy()
    const canonicalUrl = new URL(canonical!, page.url())
    expect(['/projects', '/en/projects']).toContain(canonicalUrl.pathname)
    expect(canonicalUrl.search).toBe('')
  })
})
