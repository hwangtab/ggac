import { test, expect } from '@playwright/test'

test.describe('메인 레이어드 모션', () => {
  test('앰비언트 빛 레이어가 aria-hidden으로 존재한다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const ambient = page.locator('.ambient-light')
    await expect(ambient).toHaveCount(2)
    const wrapper = page.locator('[aria-hidden="true"] .ambient-light').first()
    await expect(wrapper).toBeAttached()
  })

  test('앰비언트 빛 레이어가 다크 오버레이 위에 배치된다(가려지지 않음)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // 빛 레이어 부모의 z-index가 히어로의 어둠 오버레이(다크 오버레이 z10,
    // 중앙 radial z15)보다 커야 빛이 화면에 더해져 보인다.
    const z = await page
      .locator('.ambient-light')
      .first()
      .evaluate(el => Number(getComputedStyle(el.parentElement).zIndex))
    expect(z).toBeGreaterThan(15)
  })

  test('reduced-motion에서 앰비언트 애니메이션이 정지한다', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const animName = await page
      .locator('.ambient-drift')
      .first()
      .evaluate(el => getComputedStyle(el).animationName)
    expect(animName).toBe('none')
    await context.close()
  })

  test('LCP 텍스트(h1)는 진입 시 즉시 보인다(opacity 1)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const opacity = await page
      .locator('h1')
      .first()
      .evaluate(el => getComputedStyle(el).opacity)
    expect(Number(opacity)).toBe(1)
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
