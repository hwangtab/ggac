import { test, expect, type Browser, type Page } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 업무툴 파일(2a) — **실제 Blob 업로드**를 끝까지 본다(설계 §7-2·§7-3·§7-5).
 *
 * ⚠️ 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)이 있어야만 돈다 — 없으면 통째로 건너뛴다. 이 스위트는
 * 운영 비공개 저장소(DB 백업이 들어 있다)를 **절대** 쓰지 않는다: playwright.config.ts 가 dev 서버에
 * `BOARD_WORK_BLOB_READ_WRITE_TOKEN`을 늘 명시하고(토큰이 없으면 빈 값 → 업무툴 저장소는 503), 토큰이 있을 때만
 * 그 값을 비공개 저장소 토큰으로도 넘긴다. 만든 객체는 시험 저장소에 남는다(정리 크론은 5단계).
 *
 * 흐름: 이사가 공개 채널에서 PDF·동영상을 첨부해 보낸다(브라우저 → 토큰 라우트 → vercel.com/api/blob 직접 업로드 →
 * 전송 뒤 attachUploads 가 head()로 확인해 승격) → 감사 화면에 **새로 고침 없이**(폴링) 첨부가 보인다 → 감사가 PDF
 * 미리보기를 연다(같은 출처 iframe) → 동영상에 Range 를 보내 206 을 받는다.
 * 화면 확인용 스크린숏을 `test-results/board-work-files-*.png`로 남긴다.
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN,
  'BOARD_WORK_TEST_BLOB_TOKEN(시험용 Blob 저장소)이 없어 실제 업로드 E2E를 건너뛴다'
)

const POLL_BUDGET_MS = 15_000

/** 한 쪽짜리 최소 PDF(글자 하나) — 바이트 오프셋을 맞춘 xref 를 손으로 만든다 */
function tinyPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    (() => {
      const stream = `BT /F1 12 Tf 20 50 Td (${text}) Tj ET`
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function openChannel(
  browser: Browser,
  role: string,
  viewport = { width: 1280, height: 800 }
) {
  const context = await browser.newContext({ storageState: storageStatePath(role), viewport })
  await context.request.get('/api/auth/get-session')
  const page = await context.newPage()
  const f = readFixtures()
  await page.goto(`/board-room/c/${f.workPublicChannelSlug}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('board-work-channel')).toBeVisible({ timeout: 20_000 })
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

test.describe('업무툴 파일 — 실제 업로드(시험 저장소)', () => {
  test('이사가 올린 PDF·동영상을 감사가 폴링으로 보고, PDF 미리보기와 Range 206 이 된다', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const director = await openChannel(browser, 'director')
    const auditor = await openChannel(browser, 'auditor')
    try {
      const stamp = Date.now()
      const pdfName = `e2e-회의자료-${stamp}.pdf`
      const videoName = `e2e-영상-${stamp}.webm`
      // 동영상은 재생 가능 여부가 아니라 저장·Range 를 본다 — 64KB 짜리 바이트면 충분하다
      const video = Buffer.alloc(64 * 1024, 7)

      await director.page.getByTestId('attachment-input').setInputFiles([
        { name: pdfName, mimeType: 'application/pdf', buffer: tinyPdf('board work e2e') },
        { name: videoName, mimeType: 'video/webm', buffer: video },
      ])
      // 업로드가 끝나야 전송 단추가 풀린다(sendBlocked)
      const text = `첨부 확인 ${stamp}`
      await composer(director.page).fill(text)
      await expect(async () => {
        await composer(director.page).press('Enter')
        await expect(messageRow(director.page, text)).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 60_000 })
      await expect(messageRow(director.page, text).getByText(pdfName)).toBeVisible({
        timeout: 30_000,
      })

      // 감사 화면 — 새로 고침 없이 첨부까지(승격이 메시지 rev 를 올려 폴링이 다시 읽는다)
      const row = messageRow(auditor.page, text)
      await expect(row.getByText(pdfName)).toBeVisible({ timeout: POLL_BUDGET_MS })
      await expect(row.getByText(videoName)).toBeVisible({ timeout: POLL_BUDGET_MS })
      expect(
        await auditor.page.evaluate(
          () => (window as unknown as { __bwNoReload?: boolean }).__bwNoReload === true
        )
      ).toBe(true)
      await auditor.page.screenshot({ path: 'test-results/board-work-files-message.png' })

      // PDF 미리보기 — 같은 출처 iframe(미리보기 라우트만 SAMEORIGIN)
      await row.getByRole('button', { name: pdfName }).click()
      const frame = auditor.page.locator('iframe[src*="/api/board-room/work/files/"]')
      await expect(frame).toBeVisible({ timeout: 15_000 })
      const src = (await frame.getAttribute('src')) ?? ''
      const display = await auditor.context.request.get(src)
      expect(display.status()).toBe(200)
      expect(display.headers()['x-frame-options']).toBe('SAMEORIGIN')
      expect(display.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
      expect(display.headers()['cache-control']).toContain('no-store')
      expect((await display.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
      await auditor.page.screenshot({ path: 'test-results/board-work-files-preview.png' })
      await auditor.page.keyboard.press('Escape')

      // 동영상 Range — 다운로드 링크에서 첨부 id 를 읽어 스트리밍 라우트에 bytes=0-9 를 보낸다
      const href =
        (await row.getByRole('link', { name: `${videoName} 다운로드` }).getAttribute('href')) ?? ''
      const id = /\/files\/([0-9a-f-]{36})/.exec(href)?.[1]
      expect(id, href).toBeTruthy()
      const ranged = await auditor.context.request.get(`/api/board-room/work/files/${id}`, {
        headers: { Range: 'bytes=0-9' },
      })
      expect(ranged.status()).toBe(206)
      expect(ranged.headers()['content-range']).toBe(`bytes 0-9/${video.length}`)
      expect((await ranged.body()).length).toBe(10)
      const whole = await auditor.context.request.get(`/api/board-room/work/files/${id}`)
      expect(whole.status()).toBe(200)
      expect((await whole.body()).length).toBe(video.length)

      // 자료실에서도 보인다
      await auditor.page.goto('/board-room/files', { waitUntil: 'domcontentloaded' })
      await expect(auditor.page.getByText(pdfName).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })
})
