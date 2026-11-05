import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from '@libsql/client'
import { head } from '@vercel/blob'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'
import { cronHeaders } from './helpers/cron'
import { allowEditorFraming, editorFramingOptions } from './helpers/editorFrame'

assertLocalTurso()

/**
 * 조합원 내 문서함을 **실제 저장소·실제 편집기**로 끝까지 본다(docs/board-work/04-조합원-문서함.md).
 *
 * ⚠️ 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)과 편집기 출처(`NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`)가 있어야만
 * 돈다 — 없으면 통째로 건너뛴다. 서버는 playwright.config.ts가 `BOARD_WORK_BLOB_READ_WRITE_TOKEN`을 그 시험 토큰으로
 * 넘기므로 운영 비공개 저장소(DB 백업·메일 첨부)에는 닿지 않는다. 편집기는 배포된 https://ggac-office.vercel.app 이고
 * 그 사이트의 `frame-ancestors`가 E2E 포트(3101)를 허용한다.
 *
 * 화면 확인용 스크린숏을 `test-results/member-documents-*.png`(1280·390)로 남긴다.
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN || !process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN,
  'BOARD_WORK_TEST_BLOB_TOKEN·NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN 이 없어 내 문서함 실제 E2E를 건너뛴다'
)

const ORIGIN = process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN ?? ''
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function versionsOf(documentId: string) {
  const client = db()
  try {
    const rs = await client.execute({
      sql: 'select id, version_no, blob_path, source from member_document_versions where document_id = ? order by version_no',
      args: [documentId],
    })
    return rs.rows.map(r => ({
      id: String(r.id),
      versionNo: Number(r.version_no),
      blobPath: String(r.blob_path),
      source: String(r.source),
    }))
  } finally {
    client.close()
  }
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await head(pathname, { token: process.env.BOARD_WORK_TEST_BLOB_TOKEN as string })
    return true
  } catch (e) {
    if (e instanceof Error && /not.?found|does not exist|404/i.test(`${e.name} ${e.message}`)) {
      return false
    }
    throw e
  }
}

async function ownerContext(
  browser: { newContext: (o: object) => Promise<BrowserContext> },
  viewport = DESKTOP
) {
  const context = await browser.newContext({
    storageState: storageStatePath('owner'),
    viewport,
    ...editorFramingOptions(),
  })
  // 3000·3101 밖의 포트에서는 편집기 사이트의 frame-ancestors 가 iframe 을 막는다(helpers/editorFrame.ts)
  await allowEditorFraming(context)
  await context.request.get('/api/auth/get-session')
  return context
}

/** 목록 화면에서 파일을 실제로 올리고 새 문서 id 를 돌려준다 */
async function uploadFromList(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto('/mypage/documents', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('member-documents-list')).toBeVisible({ timeout: 30_000 })
  await page
    .getByTestId('member-documents-upload-input')
    .setInputFiles([{ name, mimeType, buffer }])
  const link = page.getByRole('link', { name, exact: true })
  await expect(link).toBeVisible({ timeout: 60_000 })
  const href = (await link.getAttribute('href')) ?? ''
  const id = /\/mypage\/documents\/([0-9a-f-]{36})/.exec(href)?.[1]
  expect(id, href).toBeTruthy()
  return id as string
}

function editorStatus(page: Page) {
  return page.locator('[data-testid="member-document-edit-screen"] header [role="status"]')
}

async function waitForEditorUi(page: Page, selector: string, timeout = 120_000) {
  await expect(async () => {
    let found = 0
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      found += await frame
        .locator(selector)
        .count()
        .catch(() => 0)
    }
    expect(found, `편집기 안의 ${selector}`).toBeGreaterThan(0)
  }).toPass({ timeout, intervals: [1_000] })
}

async function typeInEditor(
  page: Page,
  frameSelector: string,
  text: string,
  at = { x: 0.5, y: 0.35 }
) {
  const frame = page.locator(frameSelector).first()
  const box = await frame.boundingBox()
  expect(box, '편집기 iframe 이 화면에 없다').toBeTruthy()
  if (!box) return
  await page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y)
  await page.waitForTimeout(800)
  await page.keyboard.type(text, { delay: 80 })
}

async function removeDocument(context: BrowserContext, id: string) {
  await context.request.delete(`/api/mypage/documents/${id}`).catch(() => undefined)
}

test.describe('내 문서함 — 실제 저장소·편집기', () => {
  test.describe.configure({ mode: 'serial' })

  test('DOCX: 올리고 미리 본 뒤 편집기에서 고쳐 저장하면 v2 가 생기고 내려받은 v2 에 친 글자가 있다', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const context = await ownerContext(browser)
    const page = await context.newPage()
    let id: string | null = null
    try {
      const stamp = Date.now()
      const name = `e2e-문서-${stamp}.docx`
      id = await uploadFromList(
        page,
        name,
        DOCX_MIME,
        readFileSync('public/doc-templates/blank.docx')
      )
      await expect(page.getByRole('link', { name: '내 문서함' })).toBeVisible()
      await expect(page.getByTestId('member-documents-usage')).toContainText('/ 200.0 MB')
      await page.screenshot({ path: 'test-results/member-documents-list-1280.png', fullPage: true })

      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.getByTestId('member-document-detail')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('member-document-preview')).toBeVisible()
      await page.waitForTimeout(1_500)
      await page.screenshot({
        path: 'test-results/member-documents-preview-1280.png',
        fullPage: true,
      })

      await page.getByRole('link', { name: '앱에서 편집' }).click()
      await expect(page).toHaveURL(new RegExp(`/mypage/documents/${id}/edit$`), { timeout: 30_000 })
      const frameSel = `iframe[src^="${ORIGIN}/editor"]`
      await expect(page.locator(frameSel)).toBeVisible({ timeout: 30_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await waitForEditorUi(page, '#editor_sdk')
      await page.waitForTimeout(2_000)
      // 편집기는 화면 높이 안에 들어온다(아래로 넘치지 않는다)
      const frameBox = await page.locator(frameSel).boundingBox()
      expect((frameBox?.y ?? 0) + (frameBox?.height ?? 0)).toBeLessThanOrEqual(DESKTOP.height)
      await page.screenshot({ path: 'test-results/member-documents-edit-office-1280.png' })

      await typeInEditor(page, frameSel, 'member docs e2e')
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await expect(editorStatus(page)).toHaveText(/저장됨 v2/, { timeout: 120_000 })

      const versions = await versionsOf(id)
      expect(versions.map(v => [v.versionNo, v.source])).toEqual([
        [1, 'upload'],
        [2, 'editor'],
      ])
      const v2 = await context.request.get(
        `/api/mypage/documents/files/${versions[1].id}?download=1`
      )
      expect(v2.status()).toBe(200)
      const zip = await JSZip.loadAsync(await v2.body())
      // ONLYOFFICE 가 문장 첫 글자를 대문자로 고친다(자동 고침) — 대소문자 무시
      expect(await zip.file('word/document.xml')?.async('string')).toMatch(/member docs e2e/i)
      // v1 은 그대로 남아 있다(되돌리기 대상)
      const v1 = await context.request.get(
        `/api/mypage/documents/files/${versions[0].id}?download=1`
      )
      const zip1 = await JSZip.loadAsync(await v1.body())
      expect(await zip1.file('word/document.xml')?.async('string')).not.toMatch(/member docs e2e/i)

      // 되돌리기 → v3 은 v1 의 복사본
      await page.goto(`/mypage/documents/${id}`)
      await page
        .getByTestId('member-document-version')
        .filter({ hasText: 'v1' })
        .getByRole('button', { name: '되돌리기' })
        .click()
      await expect(page.getByText(/v1을 복사해 v3으로 저장했습니다/)).toBeVisible({
        timeout: 30_000,
      })
      expect((await versionsOf(id)).map(v => [v.versionNo, v.source])).toEqual([
        [1, 'upload'],
        [2, 'editor'],
        [3, 'restore'],
      ])
      await page.screenshot({
        path: 'test-results/member-documents-versions-1280.png',
        fullPage: true,
      })
    } finally {
      if (id) {
        const paths = (await versionsOf(id)).map(v => v.blobPath)
        await removeDocument(context, id)
        for (const p of paths) expect(await exists(p), p).toBe(false)
      }
      await context.close()
    }
  })

  test('HWP: 올린 .hwp 를 rhwp 편집기로 열면 경고 띠가 보이고, 고쳐 저장하면 서버 검사를 지나 v2 가 생긴다', async ({
    browser,
  }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED,
      'NEXT_PUBLIC_HWP_EDITOR_ENABLED 가 꺼져 있다'
    )
    test.setTimeout(300_000)
    const context = await ownerContext(browser)
    const page = await context.newPage()
    let id: string | null = null
    try {
      const name = `e2e-한글-${Date.now()}.hwp`
      id = await uploadFromList(
        page,
        name,
        'application/x-hwp',
        readFileSync('scripts/testing/fixtures/board-work/sample.hwp')
      )
      await page.goto(`/mypage/documents/${id}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('hwp-editor-warning')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('hwp-editor-warning')).toContainText('한컴오피스 한글')
      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await page.screenshot({ path: 'test-results/member-documents-edit-hwp-1280.png' })

      await typeInEditor(page, frameSel, '내 문서함 시험', { x: 0.5, y: 0.3 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await expect(editorStatus(page)).toHaveText(/저장됨 v2/, { timeout: 120_000 })
      const versions = await versionsOf(id)
      expect(versions.map(v => v.versionNo)).toEqual([1, 2])
      const v2 = await context.request.get(
        `/api/mypage/documents/files/${versions[1].id}?download=1`
      )
      expect([...(await v2.body()).subarray(0, 8)]).toEqual([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ])
    } finally {
      if (id) await removeDocument(context, id)
      await context.close()
    }
  })

  test('새 HWPX 문서: 빈 서식으로 편집기가 열리고, 처음 저장하면 v1 이 생긴다', async ({
    browser,
  }) => {
    test.skip(
      process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED !== '1' ||
        process.env.NEXT_PUBLIC_HWPX_EDITOR_ENABLED !== '1',
      'HWP·HWPX 편집 플래그가 꺼져 있다'
    )
    test.setTimeout(300_000)
    const context = await ownerContext(browser)
    const page = await context.newPage()
    let id: string | null = null
    try {
      await page.goto('/mypage/documents', { waitUntil: 'domcontentloaded' })
      await page.getByRole('link', { name: /새 한글 문서\(HWPX\)/ }).click()
      await expect(page).toHaveURL(/\/mypage\/documents\/new\?type=hwpx/, { timeout: 30_000 })
      await expect(page.getByTestId('hwp-editor-warning')).toBeVisible({ timeout: 30_000 })
      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await page.screenshot({ path: 'test-results/member-documents-new-hwpx-1280.png' })

      await typeInEditor(page, frameSel, '새 문서 시험', { x: 0.5, y: 0.25 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await expect(editorStatus(page)).toHaveText('저장됨', { timeout: 120_000 })
      // 주소가 그 문서의 편집 화면으로 바뀌었다(새로 고치면 이 문서가 열린다)
      await expect(page).toHaveURL(/\/mypage\/documents\/[0-9a-f-]{36}\/edit$/)
      id = /\/mypage\/documents\/([0-9a-f-]{36})\/edit/.exec(page.url())?.[1] ?? null
      expect(id).toBeTruthy()
      expect((await versionsOf(id as string)).map(v => [v.versionNo, v.source])).toEqual([
        [1, 'editor'],
      ])
    } finally {
      if (id) await removeDocument(context, id)
      await context.close()
    }
  })

  test('보존 크론: 1년 미사용 문서에 알림을 남기고, 알린 지 30일 지나도 안 열었으면 객체까지 지운다', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const f = readFixtures()
    const context = await ownerContext(browser)
    const page = await context.newPage()
    const cron = await playwright.request.newContext({ baseURL })
    const client = db()
    let id: string | null = null
    try {
      const name = `e2e-보존-${Date.now()}.txt`
      id = await uploadFromList(page, name, 'text/plain', Buffer.from('보존 시험'))
      const [v1] = await versionsOf(id)
      expect(await exists(v1.blobPath)).toBe(true)

      const DAY = 24 * 60 * 60 * 1000
      await client.execute({
        sql: 'update member_documents set last_opened_at = ?, deletion_notified_at = null where id = ?',
        args: [Date.now() - 400 * DAY, id],
      })
      const first = await cron.post('/api/internal/member-documents/retention', {
        headers: cronHeaders(),
      })
      expect(first.status()).toBe(200)
      expect((await first.json()).data.notifiedDocuments).toBeGreaterThanOrEqual(1)
      const marked = await client.execute({
        sql: 'select deletion_notified_at from member_documents where id = ?',
        args: [id],
      })
      expect(marked.rows[0].deletion_notified_at).not.toBeNull()
      const notice = await client.execute({
        sql: `select message from notifications where user_id = ? and type = 'member_document_expiring'
              order by created_at desc limit 1`,
        args: [f.users.owner],
      })
      expect(String(notice.rows[0]?.message ?? '')).toContain(name)
      // 목록에 '곧 지워집니다' 표시
      await page.goto('/mypage/documents')
      await expect(
        page
          .getByTestId('member-document-row')
          .filter({ hasText: name })
          .getByText(/곧 지워집니다/)
      ).toBeVisible()

      // 알린 지 31일 — 지운다
      await client.execute({
        sql: 'update member_documents set deletion_notified_at = ?, last_opened_at = ? where id = ?',
        args: [Date.now() - 31 * DAY, Date.now() - 400 * DAY, id],
      })
      const second = await cron.post('/api/internal/member-documents/retention', {
        headers: cronHeaders(),
      })
      expect(second.status()).toBe(200)
      expect((await second.json()).data.deletedDocuments).toBeGreaterThanOrEqual(1)
      const gone = await client.execute({
        sql: 'select count(*) n from member_documents where id = ?',
        args: [id],
      })
      expect(Number(gone.rows[0].n)).toBe(0)
      expect(await exists(v1.blobPath)).toBe(false)
      id = null
    } finally {
      if (id) await removeDocument(context, id)
      client.close()
      await cron.dispose()
      await context.close()
    }
  })

  test('모바일(390): 목록·미리보기는 되고, 편집 화면은 "PC에서 열어 주세요"다', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const desktop = await ownerContext(browser)
    const mobile = await ownerContext(browser, MOBILE)
    let id: string | null = null
    try {
      const page = await desktop.newPage()
      id = await uploadFromList(
        page,
        `e2e-모바일-${Date.now()}.docx`,
        DOCX_MIME,
        readFileSync('public/doc-templates/blank.docx')
      )
      const m = await mobile.newPage()
      await m.goto('/mypage/documents')
      await expect(m.getByTestId('member-documents-list')).toBeVisible()
      // 새 문서는 PC 전용이라 모바일 목록에는 없다
      await expect(m.getByRole('link', { name: /새 Word 문서/ })).toHaveCount(0)
      await m.screenshot({ path: 'test-results/member-documents-list-390.png', fullPage: true })
      await m.goto(`/mypage/documents/${id}`)
      await expect(m.getByText('문서 편집은 PC에서 할 수 있습니다')).toBeVisible()
      await expect(m.getByRole('link', { name: '앱에서 편집' })).toHaveCount(0)
      await m.waitForTimeout(1_500)
      await m.screenshot({ path: 'test-results/member-documents-preview-390.png', fullPage: true })
      await m.goto(`/mypage/documents/${id}/edit`)
      await expect(m.getByTestId('desktop-only-notice')).toBeVisible()
      await m.screenshot({ path: 'test-results/member-documents-edit-390.png' })
      await m.goto('/mypage')
      await m.screenshot({ path: 'test-results/member-documents-menu-390.png', fullPage: true })
      await page.goto('/mypage')
      await expect(page.getByRole('link', { name: '내 문서함' })).toBeVisible({ timeout: 15_000 })
      await page.screenshot({ path: 'test-results/member-documents-menu-1280.png', fullPage: true })
    } finally {
      if (id) await removeDocument(desktop, id)
      await desktop.close()
      await mobile.close()
    }
  })

  test('스위치를 끈 화면(1280·390) — "준비 중" 안내', async ({ browser }) => {
    const client = db()
    const set = (enabled: boolean) =>
      client.execute({
        sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
              WHERE category = 'features' AND setting_key = 'member_documents'`,
        args: [JSON.stringify({ enabled }), Date.now()],
      })
    const desktop = await ownerContext(browser)
    const mobile = await ownerContext(browser, MOBILE)
    try {
      await set(false)
      for (const [ctx, label] of [
        [desktop, '1280'],
        [mobile, '390'],
      ] as const) {
        const p = await ctx.newPage()
        await p.goto('/mypage/documents')
        await expect(p.getByTestId('member-documents-off')).toBeVisible()
        await p.screenshot({
          path: `test-results/member-documents-off-${label}.png`,
          fullPage: true,
        })
      }
    } finally {
      await set(true)
      client.close()
      await desktop.close()
      await mobile.close()
    }
  })
})
