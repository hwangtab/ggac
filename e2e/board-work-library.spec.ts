import { test, expect, type Browser } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 통합 재설계 R4 — 업무툴 직함·자료실의 '이사회 서류'(docs/board-work/03-통합-재설계.md §10).
 *
 * - 직함: 이사가 설정에서 업무툴 직함을 정하면 다른 사람의 업무 화면(새 대화 상대 고르기)에 보이고, 이사회 공식 직함
 *   (`member_profiles.director_title`)은 그대로다.
 * - 자료실: 이사에게 '이사회 서류'(분류 5개) + '대화 첨부'가 보이고, 분류를 고르면 서류함 자료가 등급 칩과 함께 나온다.
 *   업무 검색이 서류를 찾는다. 조합원은 자료실·미리보기 라우트 모두 막히고, 'board' 자료는 조합원 목록 어디에도 없다.
 * - 실제 바이트(올리기·미리보기·지우기)는 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)이 있을 때만 돈다.
 *
 * 화면 확인용 스크린숏을 `test-results/board-work-library-*.png`로 남긴다.
 */

const BOARD_ONLY_ID = '00000000-0000-4000-8000-00000000e101'
const MEMBERS_ID = '00000000-0000-4000-8000-00000000e102'
const TAG = 'R4자료실표식'
const BOARD_ONLY_TITLE = `${TAG} 이사회 전용 계약서`
const MEMBERS_TITLE = `${TAG} 조합원 공개 계약서`

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function seedDocuments(): Promise<void> {
  const client = db()
  const admin = readFixtures().users.admin
  try {
    for (const [id, title, visibility, file] of [
      [BOARD_ONLY_ID, BOARD_ONLY_TITLE, 'board', 'board-only-lease.pdf'],
      [MEMBERS_ID, MEMBERS_TITLE, 'members', 'members-lease.pdf'],
    ] as const) {
      await client.execute({
        sql: `INSERT INTO board_documents
                (id, title, category, file_path, file_name, file_size, mime_type,
                 uploaded_by, body_markdown, visibility, created_at)
              VALUES (?, ?, '계약', ?, ?, 2048, 'application/pdf', ?, NULL, ?, ?)
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, visibility = excluded.visibility`,
        args: [id, title, `authz-e2e-fixtures/${file}`, file, admin, visibility, Date.now()],
      })
    }
  } finally {
    client.close()
  }
}

async function removeDocuments(): Promise<void> {
  const client = db()
  try {
    await client.execute({
      sql: 'DELETE FROM board_documents WHERE id IN (?, ?)',
      args: [BOARD_ONLY_ID, MEMBERS_ID],
    })
  } finally {
    client.close()
  }
}

async function newPage(browser: Browser, role: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ storageState: storageStatePath(role), viewport })
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  return { context, page }
}

// 시드 서류는 파일 전체가 함께 쓴다(작업자 1명 — playwright.config.ts)
test.beforeAll(seedDocuments)
test.afterAll(removeDocuments)

test.describe('업무툴 직함', () => {
  test('이사가 정한 업무툴 직함이 다른 이사의 화면에 보이고, 이사회 직함은 그대로다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const f = readFixtures()
    const workTitle = `R4 업무 직함 ${Date.now() % 100000}`
    const director = await newPage(browser, 'director')
    const auditor = await newPage(browser, 'auditor')
    const client = db()
    try {
      const { page } = director
      await page.goto('/board-room/settings', { waitUntil: 'domcontentloaded' })
      const input = page.getByLabel('직함', { exact: true })
      await expect(input).toBeEditable({ timeout: 20_000 })
      // 비워 두면 이사회 직함으로 떨어진다는 안내 — 시드의 이사회 직함은 '이사'
      await expect(page.getByText('비워 두면 이사회 직함(이사)이 보입니다.')).toBeVisible()
      await expect(page.getByText('관리자가 정합니다')).toHaveCount(0)
      await page.screenshot({ path: 'test-results/board-work-library-settings-desktop.png' })

      const status = page.getByRole('status').filter({ hasText: /저장/ })
      // 하이드레이션 전에 누른 제출은 무시될 수 있어 저장될 때까지 다시 누른다
      await expect(async () => {
        await input.fill(workTitle)
        await page.getByRole('button', { name: '저장', exact: true }).click()
        await expect(status).toHaveText('저장했습니다.', { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })

      const rows = await client.execute({
        sql: `SELECT p.director_title AS official, w.work_title AS work
                FROM member_profiles p LEFT JOIN work_member_prefs w ON w.user_id = p.id
               WHERE p.id = ?`,
        args: [f.users.director],
      })
      expect(rows.rows[0]?.work).toBe(workTitle)
      expect(rows.rows[0]?.official, '이사회 공식 직함은 업무툴이 쓰지 않는다').toBe('이사')

      // 다른 이사(감사)의 업무 화면 — 새 대화 상대 고르기에 업무툴 직함이 보이고 그 직함으로 찾힌다
      await auditor.page.goto('/board-room/chat?new=1', { waitUntil: 'domcontentloaded' })
      const search = auditor.page.getByPlaceholder('이름이나 직함으로 찾기')
      await expect(search).toBeVisible({ timeout: 20_000 })
      await search.fill(workTitle)
      const option = auditor.page.getByRole('list', { name: '대화 상대' }).getByRole('listitem')
      await expect(option).toHaveCount(1)
      await expect(option).toContainText('authz-director')
      await expect(option).toContainText(workTitle)

      // 이사회 화면의 직함(출석 등 공식 직함)은 그대로 — 관리자 회원 API가 같은 열을 본다
      const official = await client.execute({
        sql: 'SELECT director_title FROM member_profiles WHERE id = ?',
        args: [f.users.director],
      })
      expect(official.rows[0]?.director_title).toBe('이사')

      // 비우면 다시 이사회 직함으로 떨어진다
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(input).toHaveValue(workTitle, { timeout: 20_000 })
      await expect(async () => {
        await input.fill('')
        await page.getByRole('button', { name: '저장', exact: true }).click()
        await expect(status).toHaveText('저장했습니다.', { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
      const cleared = await client.execute({
        sql: 'SELECT work_title FROM work_member_prefs WHERE user_id = ?',
        args: [f.users.director],
      })
      expect(cleared.rows[0]?.work_title ?? null).toBeNull()
    } finally {
      await client
        .execute({
          sql: 'UPDATE work_member_prefs SET work_title = NULL WHERE user_id = ?',
          args: [f.users.director],
        })
        .catch(() => {})
      client.close()
      await director.context.close()
      await auditor.context.close()
    }
  })
})

test.describe('자료실 — 이사회 서류', () => {
  test('이사는 이사회 서류(분류 5개)와 대화 첨부를 보고, 분류를 고르면 서류가 등급과 함께 나온다', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const { context, page } = await newPage(browser, 'director')
    try {
      await page.goto('/board-room/files', { waitUntil: 'domcontentloaded' })
      const pane = page.getByRole('navigation', { name: '자료실 폴더' })
      await expect(pane).toBeVisible({ timeout: 20_000 })
      const boardSection = pane.getByRole('region', { name: '이사회 서류' })
      for (const category of ['등록증', '정관', '계약', '기타', '총회']) {
        await expect(boardSection.getByRole('link', { name: category, exact: true })).toBeVisible()
      }
      await expect(pane.getByRole('heading', { name: '대화 첨부' })).toBeVisible()
      await expect(pane.getByRole('link', { name: '전체 파일' })).toBeVisible()

      await boardSection.getByRole('link', { name: '계약', exact: true }).click()
      await expect(page).toHaveURL(/\/board-room\/files\?board=%EA%B3%84%EC%95%BD$/)
      await expect(
        page.getByRole('heading', { name: '이사회 서류 · 계약', level: 1 })
      ).toBeVisible()
      await expect(boardSection.getByRole('link', { name: '계약', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await expect(pane.getByRole('link', { name: '전체 파일' })).not.toHaveAttribute(
        'aria-current',
        'page'
      )
      const table = page.getByRole('table', { name: '이사회 서류 — 계약' })
      const boardRow = table.locator(`[data-board-document="${BOARD_ONLY_ID}"]`)
      const membersRow = table.locator(`[data-board-document="${MEMBERS_ID}"]`)
      await expect(boardRow).toContainText(BOARD_ONLY_TITLE)
      await expect(boardRow).toContainText('이사회만')
      await expect(membersRow).toContainText(MEMBERS_TITLE)
      await expect(membersRow).toContainText('조합원 공개')
      // 이사는 올릴 수 있고, 남(관리자)이 올린 서류는 지울 수 없다(올린 사람 또는 관리자만 — 서류함과 같다)
      await expect(page.getByRole('button', { name: '서류 올리기' })).toBeVisible()
      await expect(boardRow.getByRole('button', { name: /삭제$/ })).toHaveCount(0)
      await expect(boardRow.getByRole('link', { name: /다운로드$/ })).toHaveAttribute(
        'href',
        `/api/board-room/documents/${BOARD_ONLY_ID}/download`
      )

      // 메뉴: 자료실이 활성이고, 서류함 화면에서도 자료실이 활성이다
      const menu = page.getByRole('navigation', { name: '이사회 메뉴' })
      await expect(menu.getByRole('link', { name: '자료실' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await page.screenshot({ path: 'test-results/board-work-library-folder-desktop.png' })

      // 정기총회 폴더는 정기총회 화면처럼 관리자만 올린다
      await boardSection.getByRole('link', { name: '총회', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: '이사회 서류 · 총회', level: 1 })
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '서류 올리기' })).toHaveCount(0)

      await page.goto('/board-room/documents', { waitUntil: 'domcontentloaded' })
      await expect(menu.getByRole('link', { name: '자료실' })).toHaveAttribute(
        'aria-current',
        'page',
        {
          timeout: 20_000,
        }
      )
      // 검색 화면에서는 아무 항목도 칠하지 않는다
      await page.goto(`/board-room/search?q=${encodeURIComponent(TAG)}`, {
        waitUntil: 'domcontentloaded',
      })
      const results = page.getByRole('region', { name: /이사회 서류/ })
      await expect(results).toBeVisible({ timeout: 20_000 })
      await expect(menu.getByRole('group', { name: '소통' })).toBeVisible()
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(0)
      // 업무 검색이 이사회 서류(제목)를 찾고, 결과는 그 폴더의 미리보기로 간다
      const hit = results.getByRole('link', { name: new RegExp(BOARD_ONLY_TITLE) })
      await expect(hit).toHaveAttribute(
        'href',
        `/board-room/files?board=%EA%B3%84%EC%95%BD&doc=${BOARD_ONLY_ID}`
      )
      await expect(results.getByRole('link', { name: new RegExp(MEMBERS_TITLE) })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test("조합원은 자료실·서류 미리보기 라우트가 막히고, 'board' 자료는 목록 어디에도 없다", async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const { context, page } = await newPage(browser, 'other')
    try {
      await page.goto('/board-room/files?board=%EA%B3%84%EC%95%BD', {
        waitUntil: 'domcontentloaded',
      })
      await expect(page).toHaveURL(/\/board$/, { timeout: 15_000 })

      for (const path of ['', '/render', '/board-only-lease.pdf']) {
        const res = await context.request.get(
          `/api/board-room/work/board-documents/${BOARD_ONLY_ID}${path}`,
          { maxRedirects: 0 }
        )
        expect(res.status(), path || '/').toBe(403)
      }
      // 서류함 목록(조합원용 '조합 서류')에는 조합원 공개 자료만 — 기존 동작 그대로
      const list = await context.request.get(
        '/api/board-room/documents?category=%EA%B3%84%EC%95%BD'
      )
      expect(list.status()).toBe(200)
      const ids = ((await list.json()).data.documents as { id: string }[]).map(d => d.id)
      expect(ids).toContain(MEMBERS_ID)
      expect(ids).not.toContain(BOARD_ONLY_ID)
    } finally {
      await context.close()
    }
  })

  test('이사 쪽 미리보기 라우트: 없는 서류는 404, 문서·다운로드 요청은 기존 다운로드 라우트로 보낸다', async ({
    browser,
  }) => {
    const { context } = await newPage(browser, 'director')
    try {
      const missing = await context.request.get(
        '/api/board-room/work/board-documents/00000000-0000-4000-8000-00000000e1ff/render'
      )
      expect(missing.status()).toBe(404)
      const bad = await context.request.get('/api/board-room/work/board-documents/not-a-uuid')
      expect(bad.status()).toBe(404)
      const dl = await context.request.get(
        `/api/board-room/work/board-documents/${BOARD_ONLY_ID}?download=1`,
        { maxRedirects: 0 }
      )
      expect(dl.status()).toBe(302)
      expect(dl.headers()['location']).toContain(
        `/api/board-room/documents/${BOARD_ONLY_ID}/download`
      )
    } finally {
      await context.close()
    }
  })
})

test.describe('자료실 — 이사회 서류 올리기·미리보기·지우기(시험 저장소)', () => {
  test.skip(
    !process.env.BOARD_WORK_TEST_BLOB_TOKEN,
    'BOARD_WORK_TEST_BLOB_TOKEN(시험용 Blob 저장소)이 없어 실제 업로드 E2E를 건너뛴다'
  )

  test('이사가 기타 폴더에 텍스트 서류를 올려 미리 보고 지운다 — 조합원에게는 보이지 않는다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const title = `R4 올리기 확인 ${stamp}`
    const body = `이사회 서류 미리보기 본문 ${stamp}`
    const director = await newPage(browser, 'director')
    const member = await newPage(browser, 'other')
    let uploadedId: string | null = null
    try {
      const { page } = director
      await page.goto('/board-room/files?board=%EA%B8%B0%ED%83%80', {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByRole('heading', { name: '이사회 서류 · 기타', level: 1 })).toBeVisible(
        {
          timeout: 20_000,
        }
      )
      await expect(async () => {
        const toggle = page.getByRole('button', { name: '서류 올리기' })
        if (await toggle.isVisible()) await toggle.click()
        await expect(page.getByRole('form', { name: '기타에 서류 올리기' })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 20_000 })
      const form = page.getByRole('form', { name: '기타에 서류 올리기' })
      // 이사(관리자 아님)에게는 열람 범위 선택이 없다 — 늘 '이사회만'
      await expect(form.getByLabel('열람 범위')).toHaveCount(0)
      await form.getByLabel('파일').setInputFiles({
        name: `r4-${stamp}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(body, 'utf8'),
      })
      await form.getByLabel('제목').fill(title)
      await form.getByRole('button', { name: '기타에 올리기' }).click()
      await expect(page.getByRole('status').filter({ hasText: '올렸습니다' })).toBeVisible({
        timeout: 20_000,
      })

      const row = page.locator('[data-board-document]').filter({ hasText: title })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText('이사회만')
      uploadedId = await row.getAttribute('data-board-document')

      // 미리보기 — 업무툴 미리보기 부품이 이사회 서류 라우트로 본문을 받아 그린다
      await row
        .getByRole('button', { name: `${title} 미리보기` })
        .first()
        .click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
      await expect(dialog.getByLabel(`r4-${stamp}.txt 내용`)).toContainText(body, {
        timeout: 20_000,
      })
      await page.screenshot({ path: 'test-results/board-work-library-preview-desktop.png' })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // 조합원은 같은 서류의 미리보기·다운로드 모두 막힌다
      const named = await member.context.request.get(
        `/api/board-room/work/board-documents/${uploadedId}/r4.txt`
      )
      expect(named.status()).toBe(403)
      const download = await member.context.request.get(
        `/api/board-room/documents/${uploadedId}/download`
      )
      expect(download.status()).toBe(404)

      // 올린 사람은 지울 수 있다
      await row.getByRole('button', { name: `${title} 삭제` }).click()
      await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click()
      await expect(row).toHaveCount(0, { timeout: 20_000 })
      uploadedId = null
    } finally {
      if (uploadedId) {
        await director.context.request
          .delete(`/api/board-room/documents/${uploadedId}`)
          .catch(() => {})
      }
      await director.context.close()
      await member.context.close()
    }
  })
})

test.describe('화면 확인(스크린숏)', () => {
  test('새 메뉴 — 회의 화면과 업무 화면, 1280·390', async ({ browser }) => {
    test.setTimeout(120_000)
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const { context, page } = await newPage(browser, 'director', viewport)
      const tag = viewport.width === 390 ? 'mobile' : 'desktop'
      try {
        await page.goto('/board-room/meetings', { waitUntil: 'domcontentloaded' })
        const menu = page.getByRole('navigation', { name: '이사회 메뉴' })
        await expect(menu.getByRole('group', { name: '소통' })).toBeAttached({ timeout: 20_000 })
        await page.screenshot({ path: `test-results/board-work-library-menu-meetings-${tag}.png` })
        await page.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('complementary', { name: '대화 목록' })).toBeVisible({
          timeout: 20_000,
        })
        await page.screenshot({ path: `test-results/board-work-library-menu-chat-${tag}.png` })
        await page.goto('/board-room/files?board=%EA%B3%84%EC%95%BD', {
          waitUntil: 'domcontentloaded',
        })
        await expect(
          page.getByRole('heading', { name: '이사회 서류 · 계약', level: 1 })
        ).toBeVisible({
          timeout: 20_000,
        })
        await page.screenshot({ path: `test-results/board-work-library-folder-${tag}.png` })
        await page.goto('/board-room/settings', { waitUntil: 'domcontentloaded' })
        await expect(page.getByLabel('직함', { exact: true })).toBeEditable({ timeout: 20_000 })
        await page.screenshot({ path: `test-results/board-work-library-settings-${tag}.png` })
      } finally {
        await context.close()
      }
    }
  })
})
