import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from '@libsql/client'
import { head, list } from '@vercel/blob'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

import { assertLocalTurso, storageStatePath } from './helpers/authState'
import { cronHeaders } from './helpers/cron'
import { allowEditorFraming, editorFramingOptions } from './helpers/editorFrame'

assertLocalTurso()

/**
 * 이사회 서류 앱 편집을 **실제 저장소·실제 편집기**로 끝까지 본다(docs/board-work/05-이사회-서류-앱-편집.md).
 *
 * ⚠️ 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)과 편집기 출처(`NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`)가 있어야만
 * 돈다 — 없으면 통째로 건너뛴다. 서버는 playwright.config.ts 가 비공개 저장소 토큰 둘을 그 시험 토큰으로 넘기므로 운영
 * 비공개 저장소(DB 백업·메일 첨부)에는 닿지 않는다. 편집기는 배포된 https://ggac-office.vercel.app 이다(3000·3101 밖의
 * 포트면 `allowEditorFraming`이 시험 브라우저 안에서만 frame-ancestors 를 걷어 낸다).
 *
 * - DOCX: 서류함에서 올림 → '앱에서 편집' → 고쳐 저장 → v1(올린 파일)·v2(오피스 편집기), 내려받은 v2 에 친 글자.
 *   웹 본문이 있던 서류라 본문이 새 파일로 다시 만들어지고 v1 본문은 v1 기록에 남는다. 검색 본문이 새 파일로 다시 뽑히고
 *   미리보기 캐시가 지워진다. 버전 기록에서 v1 로 되돌리면 v3(되돌리기) — 파일과 본문이 v1 로 돌아온다.
 *   서류를 지우면 버전 객체가 전부 사라진다.
 * - HWP: 올린 .hwp 를 rhwp 로 열면 경고 띠, 고쳐 저장하면 서버 검사를 지나 v2(OLE 머리).
 *
 * 화면 확인용 스크린숏을 `test-results/board-document-edit-*.png`로 남긴다.
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN || !process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN,
  'BOARD_WORK_TEST_BLOB_TOKEN·NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN 이 없어 이사회 서류 앱 편집 실제 E2E를 건너뛴다'
)

const ORIGIN = process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN ?? ''
const TOKEN = process.env.BOARD_WORK_TEST_BLOB_TOKEN as string
const DESKTOP = { width: 1280, height: 900 }
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function versionsOf(documentId: string) {
  const client = db()
  try {
    const rs = await client.execute({
      sql: `SELECT id, version_no, file_path, source, body_markdown FROM board_document_versions
            WHERE document_id = ? ORDER BY version_no`,
      args: [documentId],
    })
    return rs.rows.map(r => ({
      id: String(r.id),
      versionNo: Number(r.version_no),
      filePath: String(r.file_path),
      source: String(r.source),
      body: r.body_markdown === null ? null : String(r.body_markdown),
    }))
  } finally {
    client.close()
  }
}

async function documentRow(documentId: string) {
  const client = db()
  try {
    const rs = await client.execute({
      sql: 'SELECT file_path, body_markdown FROM board_documents WHERE id = ?',
      args: [documentId],
    })
    const r = rs.rows[0]
    return r
      ? {
          filePath: String(r.file_path),
          body: r.body_markdown === null ? null : String(r.body_markdown),
        }
      : null
  } finally {
    client.close()
  }
}

async function setBody(documentId: string, body: string) {
  const client = db()
  try {
    await client.execute({
      sql: 'UPDATE board_documents SET body_markdown = ? WHERE id = ?',
      args: [body, documentId],
    })
  } finally {
    client.close()
  }
}

async function textRow(documentId: string) {
  const client = db()
  try {
    const rs = await client.execute({
      sql: 'SELECT status, content FROM work_board_document_texts WHERE document_id = ?',
      args: [documentId],
    })
    const r = rs.rows[0]
    return r ? { status: String(r.status), content: String(r.content) } : null
  } finally {
    client.close()
  }
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await head(pathname, { token: TOKEN })
    return true
  } catch (e) {
    if (e instanceof Error && /not.?found|does not exist|404/i.test(`${e.name} ${e.message}`)) {
      return false
    }
    throw e
  }
}

async function renderCacheKeys(documentId: string): Promise<string[]> {
  const page = await list({ prefix: `board-work/renders/${documentId}-`, token: TOKEN })
  return page.blobs.map(b => b.pathname)
}

async function directorContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: storageStatePath('director'),
    viewport: DESKTOP,
    ...editorFramingOptions(),
  })
  await allowEditorFraming(context)
  await context.request.get('/api/auth/get-session')
  return context
}

/** 서류함 API 로 실제 업로드(서류함 화면의 업로드와 같은 라우트) — 새 서류 id */
async function uploadDocument(
  context: BrowserContext,
  input: { title: string; name: string; mimeType: string; buffer: Buffer }
): Promise<string> {
  const res = await context.request.post('/api/board-room/documents', {
    multipart: {
      file: { name: input.name, mimeType: input.mimeType, buffer: input.buffer },
      title: input.title,
      category: '기타',
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const json = await res.json()
  return (json.data?.id ?? json.id) as string
}

function editorStatus(page: Page) {
  return page.locator('[data-testid="board-document-edit-screen"] header [role="status"]')
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

async function docxText(body: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(body)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

test.describe('이사회 서류 앱 편집 — 실제 저장소·편집기', () => {
  test.describe.configure({ mode: 'serial' })

  test('DOCX: 고쳐 저장하면 v2, 본문·검색·미리보기가 새 파일을 따르고, 되돌리면 v3 이 v1 을 복사한다', async ({
    browser,
  }) => {
    test.setTimeout(420_000)
    const context = await directorContext(browser)
    const page = await context.newPage()
    let id: string | null = null
    const allPaths = new Set<string>()
    try {
      const stamp = Date.now()
      const title = `e2e 앱편집 회의록 ${stamp}`
      id = await uploadDocument(context, {
        title,
        name: `e2e-board-${stamp}.docx`,
        mimeType: DOCX_MIME,
        buffer: readFileSync('public/doc-templates/blank.docx'),
      })
      const original = await documentRow(id)
      expect(original?.filePath).toMatch(/^[0-9a-f-]{36}\//)
      await setBody(id, '# 옛 웹 본문')
      // 미리보기를 한 번 그려 캐시를 만든다 — 저장 뒤 지워져야 한다
      const render = await context.request.get(`/api/board-room/work/board-documents/${id}/render`)
      expect([200, 422]).toContain(render.status())

      // 서류함 목록의 진입점 → 편집 화면
      await page.goto('/board-room/documents', { waitUntil: 'domcontentloaded' })
      const row = page
        .locator('div')
        .filter({ hasText: title })
        .filter({
          has: page.getByRole('link', { name: '앱에서 편집' }),
        })
      await row.last().getByRole('link', { name: '앱에서 편집' }).click()
      await expect(page).toHaveURL(new RegExp(`/board-room/documents/${id}/edit$`), {
        timeout: 30_000,
      })
      // 이사회실 메뉴는 남고(접힌 채) 편집 화면이 그 안에 열린다
      await expect(page.getByRole('button', { name: '메뉴 펼치기' })).toBeVisible()
      const frameSel = `iframe[src^="${ORIGIN}/editor"]`
      await expect(page.locator(frameSel)).toBeVisible({ timeout: 30_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await waitForEditorUi(page, '#editor_sdk')
      await page.waitForTimeout(2_000)
      await page.screenshot({ path: 'test-results/board-document-edit-office-1280.png' })

      await typeInEditor(page, frameSel, 'board docs e2e')
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await expect(editorStatus(page)).toHaveText(/저장됨 v2/, { timeout: 120_000 })

      const v = await versionsOf(id)
      for (const x of v) allPaths.add(x.filePath)
      expect(v.map(x => [x.versionNo, x.source])).toEqual([
        [1, 'upload'],
        [2, 'office-editor'],
      ])
      // v1 은 올린 파일 그대로·그때의 본문, 서류 칸은 v2 를 가리킨다
      expect(v[0].filePath).toBe(original?.filePath)
      expect(v[0].body).toBe('# 옛 웹 본문')
      expect(v[1].filePath).toMatch(new RegExp(`^versions/${id}/${v[1].id}/`))
      const after = await documentRow(id)
      expect(after?.filePath).toBe(v[1].filePath)
      // 웹 본문은 새 파일에서 다시 만들어졌다(대소문자 무시 — ONLYOFFICE 자동 고침)
      expect(after?.body ?? '').toMatch(/board docs e2e/i)
      expect(v[1].body).toBe(after?.body)

      // 내려받은 최신(v2)에 친 글자가 있고, v1 은 그대로다
      const latest = await context.request.get(`/api/board-room/documents/${id}/download`)
      expect(latest.status()).toBe(200)
      expect(await docxText(await latest.body())).toMatch(/board docs e2e/i)
      const v1 = await context.request.get(
        `/api/board-room/documents/${id}/versions/${v[0].id}/download`
      )
      expect(v1.status()).toBe(200)
      expect(await docxText(await v1.body())).not.toMatch(/board docs e2e/i)

      // 미리보기 캐시가 지워졌다 · 검색 본문이 새 파일로 다시 뽑힌다(저장 직후 훅 또는 크론)
      expect(await renderCacheKeys(id)).toEqual([])
      const docId = id
      await expect(async () => {
        const cron = await context.request.get('/api/internal/board-work/extract-texts', {
          headers: cronHeaders(),
        })
        expect(cron.status()).toBe(200)
        const t = await textRow(docId)
        expect(t?.status).toBe('ok')
        expect(t?.content ?? '').toMatch(/board docs e2e/i)
      }).toPass({ timeout: 60_000 })

      // 버전 기록 → v1 되돌리기 → v3
      await page.goto(`/board-room/documents/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('board-document-detail')).toBeVisible({ timeout: 30_000 })
      const items = page.getByTestId('board-document-version')
      await expect(items).toHaveCount(2)
      await expect(items.first()).toContainText('오피스 편집기')
      await expect(items.first()).toContainText('최신')
      page.once('dialog', d => void d.accept())
      await items.filter({ hasText: 'v1' }).getByRole('button', { name: '되돌리기' }).click()
      await expect(page.getByText(/v1을 복사해 v3으로 저장했습니다/)).toBeVisible({
        timeout: 30_000,
      })
      await expect(items).toHaveCount(3)
      await page.screenshot({
        path: 'test-results/board-document-edit-versions-1280.png',
        fullPage: true,
      })
      const v3 = await versionsOf(id)
      for (const x of v3) allPaths.add(x.filePath)
      expect(v3.map(x => [x.versionNo, x.source])).toEqual([
        [1, 'upload'],
        [2, 'office-editor'],
        [3, 'revert'],
      ])
      // 지나간 기록은 고치지 않는다 · 되돌린 파일과 본문은 v1 것이다
      expect(v3[1].filePath).toBe(v[1].filePath)
      expect(v3[2].filePath).not.toBe(v[0].filePath)
      expect((await documentRow(id))?.body).toBe('# 옛 웹 본문')
      const reverted = await context.request.get(`/api/board-room/documents/${id}/download`)
      expect(await docxText(await reverted.body())).not.toMatch(/board docs e2e/i)

      // 지우면 버전 객체가 전부 사라진다
      const removed = await context.request.delete(`/api/board-room/documents/${id}`)
      expect(removed.status()).toBe(200)
      id = null
      for (const p of allPaths) expect(await exists(`board-documents/${p}`), p).toBe(false)
      expect(await versionsOf(docId)).toEqual([])
    } finally {
      if (id) await context.request.delete(`/api/board-room/documents/${id}`).catch(() => {})
      await context.close()
    }
  })

  test('HWP: rhwp 편집기로 열면 경고 띠가 보이고, 고쳐 저장하면 서버 검사를 지나 v2 가 생긴다', async ({
    browser,
  }) => {
    test.skip(
      process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED !== '1',
      'NEXT_PUBLIC_HWP_EDITOR_ENABLED 가 꺼져 있다'
    )
    test.setTimeout(300_000)
    const context = await directorContext(browser)
    const page = await context.newPage()
    let id: string | null = null
    try {
      id = await uploadDocument(context, {
        title: `e2e 앱편집 한글 ${Date.now()}`,
        name: `e2e-board-${Date.now()}.hwp`,
        mimeType: 'application/x-hwp',
        buffer: readFileSync('scripts/testing/fixtures/board-work/sample.hwp'),
      })
      await page.goto(`/board-room/documents/${id}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('hwp-editor-warning')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('hwp-editor-warning')).toContainText('한컴오피스 한글')
      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await page.screenshot({ path: 'test-results/board-document-edit-hwp-1280.png' })

      await typeInEditor(page, frameSel, '이사회 서류 시험', { x: 0.5, y: 0.3 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await expect(editorStatus(page)).toHaveText(/저장됨 v2/, { timeout: 120_000 })
      const versions = await versionsOf(id)
      expect(versions.map(v => [v.versionNo, v.source])).toEqual([
        [1, 'upload'],
        [2, 'hwp-editor'],
      ])
      const v2 = await context.request.get(`/api/board-room/documents/${id}/download`)
      expect(v2.status()).toBe(200)
      expect([...(await v2.body()).subarray(0, 8)]).toEqual([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ])
      // 본문이 없던 서류는 그대로 NULL
      expect((await documentRow(id))?.body).toBeNull()
    } finally {
      if (id) await context.request.delete(`/api/board-room/documents/${id}`).catch(() => {})
      await context.close()
    }
  })
})
