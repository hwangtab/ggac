import { test, expect, type Browser, type Page } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무툴 채팅 화면(1b) — **폴링이 실시간을 대신하는지** 두 사람의 브라우저로 본다.
 * 계약: docs/board-work/02-sync.md(3초 폴링 → `loadMessagesByIds` 재조회 → 같은 TopicEvent).
 *
 * 이사(director)와 감사(auditor)는 시드의 공개 채널(`workPublicChannelSlug`) 멤버다. 한 사람이 쓰고 다른 사람이
 * **새로 고침 없이** 보는지를 본다 — 새로 고침을 했다면 `window.__bwNoReload` 표식이 사라진다.
 * 각 단계의 상한(10초)은 폴 주기(3초) + 재조회 + 렌더에 여유를 둔 값이다. 6초 안에 보였는지는 따로 잰다.
 *
 * 화면 확인용 스크린숏(데스크톱 1280·모바일 390)을 `test-results/board-work-*.png`로 남긴다.
 */

const POLL_BUDGET_MS = 10_000

async function openChannel(
  browser: Browser,
  role: string,
  viewport = { width: 1280, height: 800 }
) {
  const context = await browser.newContext({ storageState: storageStatePath(role), viewport })
  // 로그인 상태(storageState)는 스위트 맨 앞(authz-setup)에서 만들어져, 이 스펙이 돌 때쯤이면 세션 쿠키 캐시
  // (`better-auth.session_data`, 5분)가 이미 만료돼 있다. 실제 화면은 주기적인 세션 확인이 캐시를 새로 써 주지만
  // 새 컨텍스트에는 그 이력이 없다 — 전체 스위트(dev 서버 부하)에서 첫 이동이 로그인으로 튕긴 일이 있어
  // 먼저 한 번 세션을 확인해 캐시를 새로 받는다(화면 동작과 무관한 준비 단계).
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  const f = readFixtures()
  await page.goto(`/board-room/c/${f.workPublicChannelSlug}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
  await expect(composer(page)).toBeVisible({ timeout: 20_000 })
  // 새로 고침하면 사라지는 표식 — "새로 고침 없이 보였다"를 단정하는 데 쓴다
  await page.evaluate(() => {
    ;(window as unknown as { __bwNoReload?: boolean }).__bwNoReload = true
  })
  return { context, page }
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: /에 메시지 보내기$/ })
}

function messageRow(page: Page, text: string) {
  return page.locator('[data-message-id]').filter({ hasText: text }).first()
}

async function stillSameDocument(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __bwNoReload?: boolean }).__bwNoReload === true
  )
}

test.describe('업무툴 채팅 — 폴링 동기화', () => {
  test('이사가 쓴 글을 감사가 새로 고침 없이 보고, 답글 수·반응이 서로에게 전해진다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const director = await openChannel(browser, 'director')
    // 감사는 2xl(1536px) — 스레드 패널이 대화 칸을 덮지 않고 세 번째 칸으로 열린다(03-통합-재설계 §3).
    // 1280에서는 패널이 대화 칸 오른쪽을 덮어 메시지 행의 반응 단추가 가려진다
    const auditor = await openChannel(browser, 'auditor', { width: 1536, height: 864 })
    try {
      const text = `폴링 확인 ${Date.now()}`

      // 1) 이사가 보낸다 → 이사 화면에 바로(낙관적 갱신), 감사 화면에는 폴링으로
      await composer(director.page).fill(text)
      await composer(director.page).press('Enter')
      await expect(messageRow(director.page, text)).toBeVisible()
      const sentAt = Date.now()
      await expect(messageRow(auditor.page, text)).toBeVisible({ timeout: POLL_BUDGET_MS })
      const seenAfterMs = Date.now() - sentAt
      expect(seenAfterMs, `감사 화면에 ${seenAfterMs}ms 뒤에 보였다(목표 6초 안)`).toBeLessThan(
        6_000
      )
      expect(await stillSameDocument(auditor.page)).toBe(true)

      // 2) 감사가 스레드에 답글 → 이사 화면의 "답글 1개"
      const auditorRow = messageRow(auditor.page, text)
      await auditorRow.hover()
      await auditorRow.getByRole('button', { name: '스레드에 답글' }).click()
      const threadBox = auditor.page.getByRole('textbox', { name: '스레드에 답글 보내기' })
      await expect(threadBox).toBeVisible()
      const reply = `답글 ${Date.now()}`
      await threadBox.fill(reply)
      await threadBox.press('Enter')
      await expect(auditor.page.getByRole('log', { name: '답글' }).getByText(reply)).toBeVisible()
      await expect(
        messageRow(director.page, text).getByRole('button', { name: /답글 1개/ })
      ).toBeVisible({ timeout: POLL_BUDGET_MS })
      expect(await stillSameDocument(director.page)).toBe(true)

      // 3) 감사가 반응(좋아요) → 이사 화면에 "좋아요 1명"
      await auditorRow.hover()
      await auditorRow.getByRole('button', { name: '반응 추가' }).click()
      await auditor.page.getByRole('menuitem', { name: '좋아요' }).click()
      await expect(auditorRow.getByRole('button', { name: /^좋아요 1명/ })).toBeVisible()
      await expect(
        messageRow(director.page, text).getByRole('button', { name: /^좋아요 1명/ })
      ).toBeVisible({ timeout: POLL_BUDGET_MS })
      expect(await stillSameDocument(director.page)).toBe(true)

      // 화면 확인용 — 데스크톱(이사: 채널 + 글·답글 수·반응), 감사(스레드 패널 열림)
      await director.page.screenshot({ path: 'test-results/board-work-chat-desktop.png' })
      await auditor.page.screenshot({ path: 'test-results/board-work-thread-desktop.png' })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('모바일(390px)에서도 채널 화면이 그려진다', async ({ browser }) => {
    test.setTimeout(120_000)
    const mobile = await openChannel(browser, 'director', { width: 390, height: 844 })
    try {
      // 목록 칸은 접히고(메일함과 같은 목록 → 상세), 본문 머리 ← 목록·입력창이 보인다
      await expect(mobile.page.getByRole('complementary', { name: '대화 목록' })).toBeHidden()
      await expect(mobile.page.getByRole('link', { name: '목록', exact: true })).toBeVisible()
      await mobile.page.screenshot({ path: 'test-results/board-work-chat-mobile.png' })

      // 대화 첫 화면은 목록이 화면을 차지한다. 이사회실 모바일 가로 탭에 '업무' 묶음이 이어 붙는다(하단 탭은 없다)
      await mobile.page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(mobile.page.getByRole('complementary', { name: '대화 목록' })).toBeVisible({
        timeout: 20_000,
      })
      await expect(
        mobile.page
          .getByRole('navigation', { name: '이사회 메뉴' })
          .getByRole('link', { name: /^대화/ })
      ).toBeAttached()
      await mobile.page.screenshot({ path: 'test-results/board-work-home-mobile.png' })
    } finally {
      await mobile.context.close()
    }
  })

  test('데스크톱 첫 화면·활동·설정이 그려지고, 영어 경로에서는 링크가 /en을 유지한다', async ({
    browser,
  }) => {
    // 화면 네 개를 차례로 연다(dev 서버는 처음 여는 화면마다 컴파일한다)
    test.setTimeout(120_000)
    const f = readFixtures()
    const desk = await openChannel(browser, 'director')
    try {
      const { page } = desk
      await page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: '대화', level: 1 })).toBeVisible({
        timeout: 20_000,
      })
      // 이사회실 다른 화면으로 가는 길은 이사회실 메뉴가 그대로 맡는다
      await expect(
        page
          .getByRole('navigation', { name: '이사회 메뉴' })
          .getByRole('link', { name: '대시보드' })
      ).toHaveAttribute('href', '/board-room')
      await page.screenshot({ path: 'test-results/board-work-home-desktop.png' })

      await page.goto('/board-room/inbox', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
      await page.screenshot({ path: 'test-results/board-work-inbox-desktop.png' })

      await page.goto('/board-room/settings', { waitUntil: 'domcontentloaded' })
      await expect(page.getByLabel('표시 이름')).toBeVisible({ timeout: 20_000 })
      await page.screenshot({ path: 'test-results/board-work-settings-desktop.png' })

      // 영어 로케일 경로: 원본 루트 경로(/c/…)가 /en/board-room/…으로 바뀌어야 한다(src/work/lib/nav)
      await page.goto(`/en/board-room/c/${f.workPublicChannelSlug}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
      await expect(
        page
          .getByRole('complementary', { name: '대화 목록' })
          .getByRole('link', { name: /authz-e2e 공개/ })
      ).toHaveAttribute('href', `/en/board-room/c/${f.workPublicChannelSlug}`)
    } finally {
      await desk.context.close()
    }
  })
})
