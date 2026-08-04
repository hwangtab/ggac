import { test, expect } from '@playwright/test'

test.describe('히어로 포스터 모션', () => {
  test('장식 레이어(워시·그레인·스포트라이트)가 접근성 트리에서 제외된다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.hero-wash')).toHaveCount(2)
    await expect(page.locator('[aria-hidden="true"] .hero-grain')).toBeAttached()
    await expect(page.locator('[aria-hidden="true"] .hero-spotlight')).toBeAttached()
  })

  test('마퀴 트랙이 전역 max-width에 잘리지 않는다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // 전역 `* { max-width: 100% }`가 width:max-content 트랙을 뷰포트 폭으로 잘라버리면
    // 마퀴가 -50% 이동하는 순간 빈 화면이 드러난다. 해제 여부를 회귀 방지로 못박는다.
    const track = page.locator('.hero-marquee').last()
    const maxWidth = await track.evaluate(el => getComputedStyle(el).maxWidth)
    expect(maxWidth).toBe('none')

    // 트랙 자체가 max-content라 트랙의 scrollWidth == clientWidth다. 실제로 확인해야 할
    // 것은 트랙이 뷰포트(클리핑 부모)보다 넓은가, 그리고 그 부모는 화면 폭을 넘지 않는가다.
    const widths = await track.evaluate(el => ({
      track: el.scrollWidth,
      viewport: el.parentElement!.clientWidth,
      docWidth: document.documentElement.clientWidth,
    }))
    expect(widths.track).toBeGreaterThan(widths.viewport)
    expect(widths.viewport).toBeLessThanOrEqual(widths.docWidth)
  })

  test('필름스트립 카드가 아티스트 상세로 연결되고 복제본은 중복 노출되지 않는다', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const strip = page.locator('.hero-marquee').last()
    const firstLink = strip.locator('a').first()
    await expect(firstLink).toHaveAttribute('href', /\/artists\//)

    // 트랙은 같은 목록 2벌이지만, 복제된 벌은 aria-hidden + tabIndex=-1이라
    // 접근성 트리에 노출되는 링크는 정확히 절반이어야 한다.
    const total = await strip.locator('a').count()
    const exposed = await strip.locator('li:not([aria-hidden="true"]) a').count()
    expect(exposed * 2).toBe(total)
  })

  test('reduced-motion에서 마퀴·그레인 애니메이션이 정지한다', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const marqueeAnim = await page
      .locator('.hero-marquee')
      .first()
      .evaluate(el => getComputedStyle(el).animationName)
    expect(marqueeAnim).toBe('none')

    const grainAnim = await page
      .locator('.hero-grain')
      .first()
      .evaluate(el => getComputedStyle(el).animationName)
    expect(grainAnim).toBe('none')

    await context.close()
  })

  test('LCP 텍스트(h1 첫 줄)는 진입 시 즉시 보인다(opacity 1)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const firstLine = page.locator('h1 .hero-line-settle').first()
    const opacity = await firstLine.evaluate(el => getComputedStyle(el).opacity)
    expect(Number(opacity)).toBe(1)

    // 클리핑된 조상이 있으면 첫 프레임에 보이지 않아 LCP가 밀린다.
    const box = await firstLine.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(0)
  })

  test('진입 직후 레이아웃 시프트가 발생하지 않는다(CLS≈0)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' })
    const cls = await page.evaluate(
      () =>
        new Promise<number>(resolve => {
          let total = 0
          const obs = new PerformanceObserver(list => {
            for (const entry of list.getEntries() as any[]) {
              if (!entry.hadRecentInput) total += entry.value
            }
          })
          obs.observe({ type: 'layout-shift', buffered: true })
          setTimeout(() => {
            obs.disconnect()
            resolve(total)
          }, 1500)
        })
    )
    expect(cls).toBeLessThan(0.1)
  })
})
