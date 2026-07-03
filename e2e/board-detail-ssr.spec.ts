import { test, expect } from '@playwright/test'

// 회귀 방지: PostContentRenderer 가 브라우저 전용 dompurify 를 SSR 경로에서
// 호출해 content_format='html' 인 모든 게시글 상세가 SSR 500 으로 크래시하던
// 버그(운영 420건)를 isomorphic-dompurify 로 근본 수정했다.
// 실제 게시글 상세가 500 이 아니라 정상(200 계열)으로 렌더되고 본문 컨테이너가
// 표시되는지 검증한다. dev 서버 + 운영 Supabase 연결 기준.
test.describe('게시글 상세 SSR 렌더링', () => {
  test.use({ locale: 'ko-KR' })

  test('실제 게시글 상세가 SSR 500 없이 본문을 렌더한다', async ({ page }) => {
    const listResponse = await page.goto('/board', { waitUntil: 'domcontentloaded' })
    expect(listResponse?.status(), '게시판 목록이 500 없이 응답').toBeLessThan(500)

    // 목록에서 첫 게시글 상세 링크(/board/<uuid>)를 찾는다.
    const detailLink = page
      .locator('a[href^="/board/"]')
      .filter({ hasNot: page.locator('[href*="/write"]') })
      .first()

    const linkCount = await page.locator('a[href^="/board/"]').count()
    test.skip(linkCount === 0, '게시글이 없어(DB 미연결 등) 상세 렌더를 검증할 수 없다')

    const href = await detailLink.getAttribute('href')
    expect(href, '상세 링크 href 존재').toBeTruthy()

    // 상세 페이지로 직접 이동해 SSR 응답 상태를 확인한다(핵심 회귀 검증).
    const detailResponse = await page.goto(href!, { waitUntil: 'domcontentloaded' })
    expect(detailResponse?.status(), '게시글 상세가 SSR 500 없이 응답').toBeLessThan(500)

    // PostContentRenderer 본문 컨테이너(.prose)가 렌더됐는지 확인한다.
    await expect(page.locator('.prose').first()).toBeVisible({ timeout: 15000 })
  })
})
