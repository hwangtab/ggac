import { readFileSync } from 'node:fs'
import { test, expect, type Browser, type Page } from '@playwright/test'
import JSZip from 'jszip'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무툴 본문 추출·전체 검색(4단계) — **실제 Blob 업로드**부터 검색 스니펫까지 끝까지 본다(설계 §8-2·§8-3).
 *
 * ⚠️ 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)이 있어야만 돈다 — 없으면 건너뛴다(board-work-files.spec.ts 와
 * 같은 규칙: 운영 비공개 저장소는 절대 쓰지 않는다).
 *
 * 흐름: 이사가 공개 채널에 DOCX(빈 서식 + 시험 문장)를 첨부해 보낸다 → 첨부 승격 뒤 업로드 직후 훅이 추출 라우트를
 * 부르고, 테스트는 크론 경로(GET + CRON_SECRET)도 직접 한 번 돌린다(어느 쪽이 먼저 끝나도 결과는 같다) → 검색 화면에서
 * 파일 이름에는 없는 본문 낱말로 찾으면 "문서 내용"에 그 파일과 스니펫이 나온다 → 비공개 채널 owner 가 아닌 이사에게는
 * 감사의 비공개 채널 첨부가 같은 방식으로 나오지 않는다(권한 쪽은 authz-board-work.spec.ts 가 시드로 본다).
 * 화면 확인용 스크린숏을 `test-results/board-work-search-*.png`로 남긴다(데스크톱·모바일).
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN,
  'BOARD_WORK_TEST_BLOB_TOKEN(시험용 Blob 저장소)이 없어 실제 업로드 E2E를 건너뛴다'
)

const DOCX_FIXTURE = 'scripts/testing/fixtures/board-work/blank.docx'

/** 빈 서식 DOCX 의 본문에 문단 몇 개를 넣는다 */
async function docxWith(paragraphs: string[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(readFileSync(DOCX_FIXTURE))
  const entry = 'word/document.xml'
  const xml = await zip.file(entry)!.async('string')
  const body = paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
  const next = xml.replace('<w:body>', `<w:body>${body.join('')}`)
  expect(next).not.toBe(xml)
  zip.file(entry, next)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function openChannel(browser: Browser, role: string) {
  const context = await browser.newContext({
    storageState: storageStatePath(role),
    viewport: { width: 1280, height: 800 },
  })
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  const f = readFixtures()
  await page.goto(`/board-room/c/${f.workPublicChannelSlug}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
  return { context, page }
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: /에 메시지 보내기$/ })
}

function messageRow(page: Page, text: string) {
  return page.locator('[data-message-id]').filter({ hasText: text }).first()
}

test.describe('업무툴 전체 검색 — 실제 업로드 → 본문 추출 → 검색(시험 저장소)', () => {
  test('이사가 올린 DOCX 본문 낱말로 찾으면 문서 내용 결과에 스니펫과 함께 나온다', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    // 두 글자 한국어 + 고유 표식. 파일 이름에는 넣지 않는다(본문에서만 찾았다는 것을 보려고)
    const marker = `본문표식${stamp}`
    const fileName = `e2e-회의자료-${stamp}.docx`
    const docx = await docxWith([
      '제1조(목적) 이 문서는 업무툴 검색 시험용이다.',
      `제2조(정관) 이사회는 ${marker} 안건을 심의한다.`,
      '제3조(부칙) 이 정관은 의결한 날부터 시행한다.',
    ])

    const director = await openChannel(browser, 'director')
    try {
      await director.page.getByTestId('attachment-input').setInputFiles([
        {
          name: fileName,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: docx,
        },
      ])
      const text = `검색 시험 첨부 ${stamp}`
      await composer(director.page).fill(text)
      await expect(async () => {
        await composer(director.page).press('Enter')
        await expect(messageRow(director.page, text)).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 60_000 })
      const row = messageRow(director.page, text)
      await expect(row.getByText(fileName)).toBeVisible({ timeout: 30_000 })
      const href =
        (await row.getByRole('link', { name: `${fileName} 다운로드` }).getAttribute('href')) ?? ''
      const attachmentId = /\/files\/([0-9a-f-]{36})/.exec(href)?.[1]
      expect(attachmentId, href).toBeTruthy()

      // 크론 경로를 직접 한 번 돈다(업로드 직후 훅과 겹쳐도 선점·재시도 규칙이 같은 결과를 낸다)
      const secret = process.env.E2E_CRON_SECRET
      const cron = await director.context.request.get('/api/internal/board-work/extract-texts', {
        headers: { authorization: `Bearer ${secret}` },
      })
      expect(cron.status()).toBe(200)

      // 검색 — 결과가 날 때까지(훅이 먼저 처리했으면 바로)
      const page = director.page
      const searchUrl = `/board-room/search?q=${encodeURIComponent(`${marker} 정관`)}`
      await expect(async () => {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: /문서 내용/ })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 60_000 })
      const section = page.locator('section[aria-labelledby="search-documents"]')
      await expect(section.getByText(fileName)).toBeVisible()
      // 스니펫: 평문 문맥 + 검색어 하이라이트(<mark>)
      await expect(section.locator('mark', { hasText: marker })).toBeVisible()
      await expect(section).toContainText('안건을 심의한다')
      await expect(section.getByRole('link', { name: '대화에서 보기' })).toHaveAttribute(
        'href',
        /\/board-room\/c\/.+#msg-/
      )
      await page.screenshot({ path: 'test-results/board-work-search-desktop.png', fullPage: true })

      // 두 글자 낱말 하나로도 찾는다(정관 — 다른 결과와 섞여도 이 파일이 나와야 한다)
      await page.goto(`/board-room/search?q=${encodeURIComponent('정관')}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 15_000 })

      // 채널 파일 탭의 본문 검색에도 나온다
      const f = readFixtures()
      await page.goto(
        `/board-room/c/${f.workPublicChannelSlug}/files?q=${encodeURIComponent(marker)}`,
        { waitUntil: 'domcontentloaded' }
      )
      await expect(page.getByRole('heading', { name: /문서 내용에서 찾음/ })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText(fileName).first()).toBeVisible()

      // 모바일 화면
      const mobile = await browser.newContext({
        storageState: storageStatePath('director'),
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      })
      try {
        const m = await mobile.newPage()
        await m.goto(searchUrl, { waitUntil: 'domcontentloaded' })
        await expect(m.getByText(fileName).first()).toBeVisible({ timeout: 15_000 })
        await m.screenshot({ path: 'test-results/board-work-search-mobile.png', fullPage: true })
      } finally {
        await mobile.close()
      }
    } finally {
      await director.context.close()
    }
  })
})
