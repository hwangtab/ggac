import { test, expect, type Browser, type Page } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무툴 대화 탭·메모·할 일(2b) — 두 사람의 브라우저로 **탭 내용이 폴링으로 갱신되는지** 본다.
 * 계약: docs/board-work/02-sync.md — 메모 저장·할 일 쓰기가 `work_channels.tabs_rev`를 올리고, 다른 사람의
 * 폴링 응답에 `tabsChanged`가 실려 ConversationTabBar가 서버 렌더를 다시 부른다(router.refresh — 문서 새로 고침 아님).
 *
 * 시드의 탭 채널(`workTabsChannelSlug` — 이사 owner, 감사 멤버)에 메모 탭·할 일 탭이 있다. 채팅 E2E의 공개 채널과
 * 섞이지 않게 따로 둔다. 실행마다 고유한 문구를 쓰므로 다시 돌려도 된다.
 *
 * 화면 확인용 스크린숏을 `test-results/board-work-tabs-*.png`로 남긴다(데스크톱 1280·모바일 390).
 */

const POLL_BUDGET_MS = 10_000

async function openTab(
  browser: Browser,
  role: string,
  path: string,
  viewport = { width: 1280, height: 800 }
) {
  const context = await browser.newContext({ storageState: storageStatePath(role), viewport })
  // 세션 쿠키 캐시를 새로 받는다(board-work-chat.spec.ts와 같은 준비 단계)
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('board-work-tab')).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => {
    ;(window as unknown as { __bwNoReload?: boolean }).__bwNoReload = true
  })
  return { context, page }
}

async function stillSameDocument(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __bwNoReload?: boolean }).__bwNoReload === true
  )
}

function tabPath(kind: 'note' | 'tasks') {
  const f = readFixtures()
  const tabId = kind === 'note' ? f.workTabsNoteTabId : f.workTabsTasksTabId
  return `/board-room/c/${f.workTabsChannelSlug}/t/${tabId}`
}

test.describe('업무툴 대화 탭 — 폴링 동기화', () => {
  test('이사가 메모를 고치면 감사의 열린 메모 탭이 새로 고침 없이 바뀌고, 이력에 그 버전이 남는다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const director = await openTab(browser, 'director', tabPath('note'))
    const auditor = await openTab(browser, 'auditor', tabPath('note'))
    try {
      // 탭 바: 기본 탭(게시물·파일) + 시드의 메모·할 일 탭
      const tabBar = auditor.page.getByRole('navigation', { name: '대화 탭' })
      await expect(tabBar.getByRole('link', { name: '회의 메모' })).toBeVisible()
      await expect(tabBar.getByRole('link', { name: '할 일' })).toBeVisible()

      const stamp = `메모 동기화 ${Date.now()}`
      await director.page.getByRole('button', { name: '편집' }).click()
      const box = director.page.getByLabel('메모 내용')
      await box.fill(`## 안건\n\n${stamp}`)
      await director.page.getByRole('button', { name: '저장' }).click()
      await expect(director.page.getByText(stamp)).toBeVisible()

      const savedAt = Date.now()
      await expect(auditor.page.getByText(stamp)).toBeVisible({ timeout: POLL_BUDGET_MS })
      const seenAfterMs = Date.now() - savedAt
      expect(seenAfterMs, `감사 화면에 ${seenAfterMs}ms 뒤에 보였다(목표 6초 안)`).toBeLessThan(
        6_000
      )
      expect(await stillSameDocument(auditor.page)).toBe(true)

      // 이력: 맨 위(최신) 버전이 '현재'이고, 열면 방금 저장한 본문이 보인다
      await auditor.page.getByRole('button', { name: '이력' }).click()
      const versions = auditor.page.getByRole('list', { name: '버전 목록' }).getByRole('listitem')
      await expect(versions.first()).toContainText('현재', { timeout: 10_000 })
      expect(await versions.count()).toBeGreaterThanOrEqual(2)
      await versions.first().getByRole('button').click()
      await expect(
        auditor.page.getByRole('region', { name: '메모 이력' }).getByText(stamp).first()
      ).toBeVisible()

      await director.page.screenshot({ path: 'test-results/board-work-tabs-note-desktop.png' })
      await auditor.page.screenshot({ path: 'test-results/board-work-tabs-history-desktop.png' })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('이사가 할 일 탭에 할 일을 더하면 감사의 열린 할 일 탭에 새로 고침 없이 나타난다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const director = await openTab(browser, 'director', tabPath('tasks'))
    const auditor = await openTab(browser, 'auditor', tabPath('tasks'))
    try {
      const title = `할 일 동기화 ${Date.now()}`
      await director.page.getByRole('button', { name: '새 할 일' }).click()
      await director.page.getByLabel('제목').fill(title)
      await director.page.getByRole('button', { name: '만들기' }).click()
      await expect(director.page.getByText(title)).toBeVisible()

      await expect(auditor.page.getByText(title)).toBeVisible({ timeout: POLL_BUDGET_MS })
      expect(await stillSameDocument(auditor.page)).toBe(true)

      await director.page.screenshot({ path: 'test-results/board-work-tabs-tasks-desktop.png' })

      // /board-room/tasks(전체 보기)에도 같은 할 일이 있다 — 이사회실 메뉴 '업무' 묶음의 '할 일'
      await auditor.page.goto('/board-room/tasks?view=all', { waitUntil: 'domcontentloaded' })
      await expect(auditor.page.getByTestId('board-work-tasks')).toBeVisible({ timeout: 20_000 })
      await expect(auditor.page.getByText(title).first()).toBeVisible()
      await expect(auditor.page.getByRole('complementary', { name: '할 일 목록' })).toBeVisible()
      await auditor.page.screenshot({ path: 'test-results/board-work-tasks-page-desktop.png' })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('모바일(390px): 탭 바·메모 탭·할 일 화면이 그려진다', async ({ browser }) => {
    test.setTimeout(120_000)
    const mobile = await openTab(browser, 'director', tabPath('note'), { width: 390, height: 844 })
    try {
      await expect(mobile.page.getByRole('navigation', { name: '대화 탭' })).toBeVisible()
      await expect(mobile.page.getByRole('link', { name: '대화', exact: true })).toBeVisible()
      await mobile.page.screenshot({ path: 'test-results/board-work-tabs-note-mobile.png' })

      await mobile.page.goto('/board-room/tasks', { waitUntil: 'domcontentloaded' })
      await expect(mobile.page.getByTestId('board-work-tasks')).toBeVisible({ timeout: 20_000 })
      await expect(mobile.page.getByRole('navigation', { name: '이사회 메뉴' })).toBeVisible()
      await mobile.page.screenshot({ path: 'test-results/board-work-tasks-page-mobile.png' })
    } finally {
      await mobile.context.close()
    }
  })
})
