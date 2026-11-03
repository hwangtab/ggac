import { test, expect, type Browser, type Page } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무 화면 통합 재설계 R1(구조) — docs/board-work/03-통합-재설계.md §2·§3·§4.
 *
 * - 업무 화면은 전역 내비·이사회실 메뉴·푸터 **안에서** 열린다(예전 전체 화면 앱 셸이 아니다)
 * - 이사회실 메뉴의 '업무' 묶음(대화·활동·할 일·자료실·검색·업무 설정)이 이사에게 보인다
 * - 배지는 업무 화면 밖(회의 화면)에서도 폴링으로 갱신된다 — 두 사람의 브라우저로 본다
 * - 조합원에게는 '업무' 묶음이 없고 폴링(sync)도 부르지 않는다
 * - 좁은 화면(390px): 대화 목록 → 대화 → `← 목록`으로 돌아온다
 *
 * 화면 확인용 스크린숏을 `test-results/board-work-layout-*.png`로 남긴다.
 */

const POLL_BUDGET_MS = 30_000

async function newPage(browser: Browser, role: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ storageState: storageStatePath(role), viewport })
  // board-work-chat.spec.ts와 같은 준비 — 새 컨텍스트의 세션 쿠키 캐시를 먼저 받는다
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  return { context, page }
}

function boardMenu(page: Page) {
  return page.getByRole('navigation', { name: '이사회 메뉴' })
}

function workGroup(page: Page) {
  return boardMenu(page).getByRole('group', { name: '업무' })
}

function composer(page: Page) {
  // 채널은 "#… 에 메시지 보내기", DM은 "…님에게 메시지 보내기"
  return page.getByRole('textbox', { name: /메시지 보내기$/ })
}

/** 메뉴 '대화' 항목의 숫자 배지(없으면 0) */
async function chatBadgeCount(page: Page): Promise<number> {
  const badge = workGroup(page).locator('[data-board-work-nav="chat"] [data-badge="mention"]')
  if ((await badge.count()) === 0) return 0
  const text = (await badge.locator('[aria-hidden="true"]').textContent()) ?? '0'
  return Number.parseInt(text, 10) || 0
}

test.describe('업무 화면 — 이사회실 레이아웃 안', () => {
  test('대화 화면에 전역 내비·이사회실 메뉴(업무 묶음)·푸터가 있고, 목록 칸이 채널·메시지로 나뉜다', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const { context, page } = await newPage(browser, 'director')
    try {
      await page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('board-work-staff')).toBeVisible({ timeout: 20_000 })

      await expect(page.locator('#navigation')).toBeVisible()
      await expect(boardMenu(page)).toBeVisible()
      await expect(page.getByRole('contentinfo')).toBeAttached()

      const group = workGroup(page)
      for (const label of ['대화', '활동', '할 일', '자료실', '검색', '업무 설정']) {
        await expect(group.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible()
      }
      await expect(group.getByRole('link', { name: /^대화/ })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await expect(boardMenu(page).getByRole('link', { name: '업무툴' })).toHaveCount(0)

      const list = page.getByRole('complementary', { name: '대화 목록' })
      await expect(list).toBeVisible()
      await expect(list.getByRole('heading', { name: '채널' })).toBeVisible()
      await expect(list.getByRole('heading', { name: '메시지' })).toBeVisible()
      // 찾기 입력이 목록을 거른다
      const f = readFixtures()
      await list.getByRole('searchbox').fill('authz-e2e-public')
      await expect(list.getByRole('link', { name: /authz-e2e 공개/ })).toBeVisible()
      await expect(list.getByText('찾는 대화가 없습니다')).toBeVisible()
      await page.screenshot({ path: 'test-results/board-work-layout-chat-desktop.png' })

      // 메뉴에서 활동으로 — 같은 레이아웃이 남고 활성 항목만 바뀐다
      await group.getByRole('link', { name: /^활동/ }).click()
      await expect(page).toHaveURL(/\/board-room\/inbox$/)
      await expect(group.getByRole('link', { name: /^활동/ })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await expect(page.getByRole('complementary', { name: '활동 목록' })).toBeVisible()
      await expect(page.locator('#navigation')).toBeVisible()

      // 채널 화면도 같은 칸 안에서 열린다
      await page.goto(`/board-room/c/${f.workPublicChannelSlug}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
      await expect(composer(page)).toBeVisible()
      await expect(boardMenu(page)).toBeVisible()
      // 입력창은 화면 안(대화 칸 바닥)에 있다 — 페이지를 내리지 않아도 보인다
      const box = await composer(page).boundingBox()
      expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(800)
    } finally {
      await context.close()
    }
  })

  test('회의 화면을 보는 중에도 다른 사람이 보낸 DM이 메뉴 대화 배지를 올린다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const f = readFixtures()
    const director = await newPage(browser, 'director')
    const auditor = await newPage(browser, 'auditor')
    try {
      // 이사가 DM을 먼저 읽어 둔다(배지 기준선) → 회의 화면으로
      await director.page.goto(`/board-room/dm/${f.workDmChannelId}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(composer(director.page)).toBeVisible({ timeout: 20_000 })
      // 읽음 처리(markChannelRead)가 끝날 틈을 준다
      await director.page.waitForTimeout(2_000)
      await director.page.goto('/board-room/meetings', { waitUntil: 'domcontentloaded' })
      await expect(workGroup(director.page)).toBeVisible({ timeout: 20_000 })
      // 첫 폴링이 반영될 때까지 잠깐 기다려 기준선을 잡는다
      await director.page.waitForTimeout(3_000)
      const before = await chatBadgeCount(director.page)

      await auditor.page.goto(`/board-room/dm/${f.workDmChannelId}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(composer(auditor.page)).toBeVisible({ timeout: 20_000 })
      const text = `메뉴 배지 확인 ${Date.now()}`
      const sent = auditor.page.locator('[data-message-id]').filter({ hasText: text }).first()
      // 하이드레이션 전에 친 글자는 지워질 수 있어 보일 때까지 다시 친다(board-work-editors.spec.ts와 같은 방식)
      await expect(async () => {
        if (!(await sent.isVisible())) {
          if ((await composer(auditor.page).inputValue()) !== text) {
            await composer(auditor.page).fill(text)
          }
          await composer(auditor.page).press('Enter')
        }
        await expect(sent).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 30_000 })

      // 회의 화면(업무 밖)은 배지만 10초 주기로 돈다
      await expect
        .poll(() => chatBadgeCount(director.page), { timeout: POLL_BUDGET_MS })
        .toBeGreaterThan(before)
      await expect(director.page).toHaveURL(/\/board-room\/meetings$/)
      await director.page.screenshot({ path: 'test-results/board-work-layout-meetings-badge.png' })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('조합원 메뉴에는 업무 묶음이 없고 폴링도 부르지 않는다', async ({ browser }) => {
    test.setTimeout(60_000)
    const { context, page } = await newPage(browser, 'other')
    try {
      const syncCalls: string[] = []
      page.on('request', req => {
        if (req.url().includes('/api/board-room/work/')) syncCalls.push(req.url())
      })
      await page.goto('/board-room/charter', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('navigation', { name: '조합 자료 메뉴' })).toBeVisible({
        timeout: 20_000,
      })
      await page.waitForTimeout(4_000)
      await expect(page.getByRole('group', { name: '업무' })).toHaveCount(0)
      expect(syncCalls).toEqual([])

      // 업무 화면은 여전히 막힌다
      await page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/board$/, { timeout: 15_000 })
    } finally {
      await context.close()
    }
  })

  test('좁은 화면(390px): 대화 목록 → 채널 → ← 목록', async ({ browser }) => {
    test.setTimeout(90_000)
    const { context, page } = await newPage(browser, 'director', { width: 390, height: 844 })
    try {
      await page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      const list = page.getByRole('complementary', { name: '대화 목록' })
      await expect(list).toBeVisible({ timeout: 20_000 })
      // 가로 탭 줄이 지금 화면의 항목(대화)을 보이는 자리로 스크롤해 둔다 — 업무 묶음은 줄 끝이라
      // 맞추지 않으면 첫머리(대시보드·정관…)만 보인다
      const menu = page.getByRole('navigation', { name: '이사회 메뉴' })
      const current = menu.locator('[aria-current="page"]')
      await expect(current).toContainText('대화')
      await expect
        .poll(async () => {
          const [m, c] = await Promise.all([menu.boundingBox(), current.boundingBox()])
          return !!m && !!c && c.x >= m.x - 1 && c.x + c.width <= m.x + m.width + 1
        })
        .toBe(true)
      await page.screenshot({ path: 'test-results/board-work-layout-list-mobile.png' })

      await list.getByRole('link', { name: /authz-e2e 공개/ }).click()
      await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
      await expect(list).toBeHidden()
      await expect(composer(page)).toBeVisible()
      await page.screenshot({ path: 'test-results/board-work-layout-channel-mobile.png' })

      await page.getByRole('link', { name: '목록', exact: true }).click()
      await expect(page).toHaveURL(/\/board-room\/chat$/)
      await expect(list).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
