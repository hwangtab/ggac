import { test, expect, type Page } from '@playwright/test'

/** 히어로 섹션 로케이터. role=banner를 떼고 h1으로 이름 붙인 region이 됐다. */
const hero = (page: Page) => page.locator('section[aria-labelledby="hero-title"]')

test.describe('히어로 포스터 — 구조와 접근성', () => {
  test('장식 레이어가 접근성 트리에서 제외되고 banner 랜드마크를 만들지 않는다', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.hero-wash')).toHaveCount(2)
    await expect(page.locator('.hero-grain')).toHaveCount(2)
    await expect(page.locator('[aria-hidden="true"] .hero-spotlight')).toBeAttached()

    // banner는 사이트 헤더용 최상위 랜드마크다. main 안에 두면 스펙 위반이고,
    // 라벨("메인 영역")과 역할("배너")이 모순되게 읽히던 회귀를 막는다.
    await expect(page.locator('main [role="banner"]')).toHaveCount(0)
    await expect(hero(page)).toHaveAttribute('aria-labelledby', 'hero-title')
  })

  test('채움용 카드는 접근성 트리와 탭 순서 양쪽에서 빠진다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const strip = page.locator('.hero-marquee').last()
    const exposed = strip.locator('li:not([aria-hidden="true"]) a')
    const filler = strip.locator('li[aria-hidden="true"] a')

    await expect(exposed.first()).toHaveAttribute('href', /\/artists\//)

    // aria-hidden만으로는 부족하다. tabIndex가 빠지면 스크린리더가 못 읽는 링크에
    // 키보드 포커스가 들어가는 최악의 조합이 된다 — 이전 테스트는 이걸 놓쳤다.
    const tabIndexes = await filler.evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('tabindex'))
    )
    expect(tabIndexes.every(value => value === '-1')).toBe(true)

    // 노출 목록 안에 같은 아티스트가 두 번 들어가면 안 된다(이음매 중복 회귀).
    const hrefs = await exposed.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
    expect(hrefs.length).toBeGreaterThan(0)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  test('자동 움직임에 명시적 정지 컨트롤이 있다 (WCAG 2.2.2)', async ({ page }) => {
    // 하이드레이션 전에는 버튼이 있어도 반응하지 않는다. load까지 기다린다.
    await page.goto('/', { waitUntil: 'load' })

    // 라벨은 상태에 따라 "멈추기" ↔ "재생"으로 바뀐다. 양쪽을 모두 매칭해야
    // 클릭 이후에도 같은 로케이터가 유효하다.
    const toggle = page.getByRole('button', { name: /멈추기|재생|Pause|Resume/ })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    // 클릭이 상태를 바꿀 때까지(= 하이드레이션 완료까지) 재시도한다.
    await expect(async () => {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // 티커에는 포커스 가능한 자손이 없어 :focus-within으로는 절대 멈출 수 없다.
    // 두 마퀴 모두 실제로 정지해야 한다.
    const states = await page
      .locator('.hero-marquee')
      .evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationPlayState))
    expect(states.every(state => state === 'paused')).toBe(true)
  })
})

test.describe('히어로 포스터 — 마퀴', () => {
  test('트랙 한 벌이 뷰포트를 덮어 사이클 끝에 빈 구간이 없다', async ({ page }) => {
    // 넓은 화면일수록 깨진다. 이전 테스트는 `track > viewport`를 단언해서
    // 2560px에서 600px 구멍이 뚫린 상태로도 통과했다. 옳은 불변식은 한 벌 기준이다.
    for (const width of [1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/', { waitUntil: 'load' })
      await page.waitForTimeout(900)

      const tracks = await page.locator('.hero-marquee').evaluateAll(nodes =>
        nodes.map(node => {
          const viewport = node.parentElement as HTMLElement
          return {
            maxWidth: getComputedStyle(node).maxWidth,
            gap: Math.round(viewport.clientWidth - node.scrollWidth / 2),
          }
        })
      )

      for (const { maxWidth, gap } of tracks) {
        // 전역 `* { max-width: 100% }`가 max-content 트랙을 잘라내면 마퀴가 무너진다.
        expect(maxWidth).toBe('none')
        expect(gap, `${width}px에서 마퀴 빈 구간`).toBeLessThanOrEqual(0)
      }
    }
  })

  test('키보드 포커스가 마퀴 위치를 영구히 오염시키지 않는다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' })
    await page.waitForTimeout(900)

    const viewport = page.locator('.hero-marquee-viewport--scrollable')
    await viewport.locator('li:not([aria-hidden="true"]) a').last().focus()
    await page.waitForTimeout(200)

    // 포커스가 밴드를 벗어나면 원위치로 돌아와야 한다. 스크롤바가 없는 컨테이너라
    // 오염이 남으면 사용자가 되돌릴 방법이 없다.
    await page.locator('a[href$="/about"]').first().focus()
    await page.waitForTimeout(300)

    expect(await viewport.evaluate(el => el.scrollLeft)).toBe(0)
  })
})

test.describe('히어로 포스터 — 레이아웃', () => {
  const sizes = [
    { width: 1024, height: 720 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]

  for (const locale of ['/', '/en']) {
    test(`${locale} 크레딧 목록이 제목과 겹치지 않는다`, async ({ page }) => {
      for (const size of sizes) {
        await page.setViewportSize(size)
        await page.goto(locale, { waitUntil: 'load' })
        await page.waitForTimeout(400)

        const overlap = await page.evaluate(() => {
          const list = document.querySelector(
            'section[aria-labelledby="hero-title"] ul:not(.hero-marquee)'
          )
          if (!list || getComputedStyle(list).display === 'none') return -1
          const listLeft = list.getBoundingClientRect().left
          const h1 = document.querySelector('h1')!
          let rightMost = 0
          for (const line of Array.from(h1.children)) {
            const target = (line.firstElementChild as HTMLElement) || (line as HTMLElement)
            const range = document.createRange()
            range.selectNodeContents(target)
            rightMost = Math.max(rightMost, range.getBoundingClientRect().right)
          }
          return Math.round(rightMost - listLeft)
        })

        expect(overlap, `${locale} ${size.width}x${size.height}`).toBeLessThanOrEqual(0)
      }
    })

    test(`${locale} 히어로가 화면 안에 들어온다`, async ({ page }) => {
      for (const size of sizes) {
        await page.setViewportSize(size)
        await page.goto(locale, { waitUntil: 'load' })
        await page.waitForTimeout(400)

        const overflow = await page.evaluate(() => {
          const section = document.querySelector('section[aria-labelledby="hero-title"]')!
          return Math.round(section.getBoundingClientRect().height - window.innerHeight)
        })
        expect(overflow, `${locale} ${size.width}x${size.height}`).toBeLessThanOrEqual(24)
      }
    })
  }
})

test.describe('히어로 포스터 — 성능 회귀 가드', () => {
  test('히어로 안에서는 opacity 진입 애니메이션을 쓰지 않는다', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // 어떤 요소가 LCP로 뽑힐지는 뷰포트 폭에 따라 바뀐다. 폰에서는 h1이 아니라
    // 부제가 가장 커서, 거기 걸린 opacity 페이드가 LCP를 800ms 밀었다.
    // "이 요소는 LCP가 아닐 것"이라는 가정 자체를 금지한다.
    await expect(hero(page).locator('.motion-fade-up')).toHaveCount(0)
  })

  test('폰 폭에서 LCP 요소가 투명도로 지연되지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      ;(window as unknown as Record<string, unknown>).__lcp = null
      new PerformanceObserver(list => {
        const entry = list.getEntries().at(-1) as unknown as { element?: Element }
        if (!entry?.element) return
        const style = getComputedStyle(entry.element)
        ;(window as unknown as Record<string, unknown>).__lcp = {
          opacity: style.opacity,
          animation: style.animationName,
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    })
    await page.goto('/', { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    const lcp = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__lcp
    )) as { opacity: string; animation: string } | null

    expect(lcp).not.toBeNull()
    expect(Number(lcp!.opacity)).toBe(1)
    expect(['none', 'heroRise']).toContain(lcp!.animation)
  })
})

test.describe('히어로 포스터 — reduced motion', () => {
  test('모든 장식 애니메이션이 정지하고 숨은 탭 정지점이 생기지 않는다', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })

    for (const selector of ['.hero-marquee', '.hero-grain', '.hero-wash']) {
      const names = await page
        .locator(selector)
        .evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName))
      expect(
        names.every(name => name === 'none'),
        selector
      ).toBe(true)
    }

    // 이름 티커가 스크롤 컨테이너가 되면 Chrome이 Tab 정지점으로 만든다.
    // aria-hidden 안에 보이지 않는 포커스 지점이 생기던 회귀를 막는다.
    let landedInHidden = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      landedInHidden = await page.evaluate(
        () => !!document.activeElement?.closest('[aria-hidden="true"]')
      )
      if (landedInHidden) break
    }
    expect(landedInHidden).toBe(false)

    await context.close()
  })
})

test.describe('히어로 포스터 — 안정성', () => {
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
