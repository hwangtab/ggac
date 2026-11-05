import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import JSZip from 'jszip'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'
import { allowEditorFraming, editorFramingOptions } from './helpers/editorFrame'

assertLocalTurso()

/**
 * 이사회 업무툴 3단계 — 앱 안 편집(실제 편집기)을 끝까지 본다(설계 §8-1).
 *
 * ⚠️ 시험용 Blob 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)과 편집기 출처(`NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`)가 있어야만
 * 돈다 — 없으면 통째로 건너뛴다. 편집기는 배포된 정적 사이트(https://ggac-office.vercel.app — ONLYOFFICE WASM `/editor`,
 * rhwp-studio `/rhwp/`)이고, 그 사이트의 `frame-ancestors`가 E2E 포트(3101)만 허용한다.
 *
 * 흐름(오피스): 이사가 공개 채널에 DOCX 를 첨부해 보낸다(실제 업로드) → `/board-room/edit/<id>` → 편집기 iframe 이 뜨고
 * 원본 바이트를 받아 문서를 연다(상태 "변경 없음" = document:opened) → 편집기 안에 글자를 친다(상태 "저장 안 된 변경" =
 * document:dirty-changed) → [저장(새 버전)] → document:save → document:saved{file} → 업로드 → saveFileVersion →
 * 상태 "저장됨 v2" → 같은 채널을 보던 감사 화면에 버전 게시물이 폴링으로 나타난다(새로 고침 없이).
 * HWP(rhwp)와 새 문서(blank.docx)도 같은 식으로 본다. 화면 확인용 스크린숏을 `test-results/board-work-editors-*.png`로 남긴다.
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN || !process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN,
  'BOARD_WORK_TEST_BLOB_TOKEN·NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN 이 없어 실제 편집기 E2E를 건너뛴다'
)

const ORIGIN = process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN ?? ''
const POLL_BUDGET_MS = 20_000
const DESKTOP = { width: 1440, height: 900 }

/** 로컬 turso dev(E2E 전용 DB) — 버전 계보를 직접 확인한다(assertLocalTurso 가 원격을 막는다) */
function e2eDb() {
  return createClient({ url: process.env.E2E_TURSO_DATABASE_URL ?? '' })
}

/** 계보(v1 id 기준)의 버전들 — 번호 오름차순 */
async function lineageOf(rootId: string) {
  const db = e2eDb()
  try {
    const rs = await db.execute({
      sql: `select id, version_no, is_latest, name from work_attachments
            where coalesce(version_root_id, id) = ? order by version_no`,
      args: [rootId],
    })
    return rs.rows.map(r => ({
      id: String(r.id),
      versionNo: Number(r.version_no),
      isLatest: Number(r.is_latest) === 1,
      name: String(r.name),
    }))
  } finally {
    db.close()
  }
}

async function openChannel(browser: Browser, role: string) {
  const context = await browser.newContext({
    storageState: storageStatePath(role),
    viewport: DESKTOP,
    ...editorFramingOptions(),
  })
  // 3000·3101 밖의 포트에서는 편집기 사이트의 frame-ancestors 가 iframe 을 막는다(helpers/editorFrame.ts)
  await allowEditorFraming(context)
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

/**
 * 채널에 파일 하나를 실제로 올리고(메시지 + 첨부) 그 첨부 id 를 돌려준다. dev 서버가 처음 컴파일하는 동안 화면이 한 번
 * 다시 그려지면 고른 파일이 사라질 수 있어(첫 실행에서 실측), 첨부 표시가 없으면 다시 고른다.
 */
async function postFile(page: Page, name: string, mimeType: string, buffer: Buffer, text: string) {
  const chip = page.getByText(name).first()
  await expect(async () => {
    if (!(await chip.isVisible())) {
      await page.getByTestId('attachment-input').setInputFiles([{ name, mimeType, buffer }])
    }
    if ((await composer(page).inputValue()) !== text) await composer(page).fill(text)
    await composer(page).press('Enter')
    await expect(messageRow(page, text)).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 90_000 })
  const row = messageRow(page, text)
  await expect(row.getByText(name)).toBeVisible({ timeout: 30_000 })
  const href =
    (await row.getByRole('link', { name: `${name} 다운로드` }).getAttribute('href')) ?? ''
  const id = /\/files\/([0-9a-f-]{36})/.exec(href)?.[1]
  expect(id, href).toBeTruthy()
  return id as string
}

function editorStatus(page: Page) {
  // 편집 화면은 전역 내비(<header>) 안이라 편집기 머리로 좁힌다
  return page.locator('[data-work-app] header [role="status"]')
}

/**
 * 편집기 안쪽(교차 출처 iframe 의 중첩 frame)에 `selector` 가 나타날 때까지 기다린다. ONLYOFFICE 는 document:opened 를 보낸 뒤에도
 * 한동안 골격 화면을 그리므로(실측) 실제 편집 영역이 생긴 뒤에 입력해야 한다. Playwright 는 교차 출처 frame 도 읽을 수 있다.
 */
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

/** 편집기 iframe 영역의 한 점을 눌러 포커스를 준 뒤 글자를 친다(키 입력은 브라우저가 포커스된 iframe 으로 보낸다) */
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

test.describe('업무툴 앱 안 편집 — 실제 편집기(ggac-office)', () => {
  test('DOCX: 편집기에서 고쳐 저장하면 v2 가 생기고, 감사 화면에 버전 게시물이 폴링으로 뜬다', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const director = await openChannel(browser, 'director')
    const auditor = await openChannel(browser, 'auditor')
    try {
      const stamp = Date.now()
      const name = `e2e-안건-${stamp}.docx`
      const docx = readFileSync('public/doc-templates/blank.docx')
      const id = await postFile(
        director.page,
        name,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docx,
        `편집 시험 ${stamp}`
      )

      const page = director.page
      await page.goto(`/board-room/edit/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('office-edit-screen')).toBeVisible({ timeout: 30_000 })
      const frameSel = `iframe[src^="${ORIGIN}/editor"]`
      await expect(page.locator(frameSel)).toBeVisible({ timeout: 30_000 })
      // document:ready → open-buffer → document:opened 가 오면 상태가 "변경 없음"
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      // 실제 편집 영역(ONLYOFFICE sdk 캔버스 영역)이 생길 때까지
      await waitForEditorUi(page, '#editor_sdk')
      await page.waitForTimeout(2_000)
      // 편집 화면은 이사회실 레이아웃 안이다(03-통합-재설계 §8 결정 2): 전역 내비는 그대로, 이사회실 메뉴는 기본으로 접혀
      // '메뉴 펼치기'만 보인다. 편집기는 화면 높이 안에 들어온다(아래로 넘치지 않는다)
      await expect(page.locator('#navigation')).toBeVisible()
      await expect(page.getByRole('navigation', { name: '이사회 메뉴' })).toBeHidden()
      await expect(page.getByRole('button', { name: '메뉴 펼치기' })).toBeVisible()
      const frameBox = await page.locator(frameSel).boundingBox()
      expect(frameBox, '편집기 iframe 위치').toBeTruthy()
      expect((frameBox?.y ?? 0) + (frameBox?.height ?? 0)).toBeLessThanOrEqual(DESKTOP.height)
      expect(frameBox?.width ?? 0).toBeGreaterThan(1100)
      await page.screenshot({ path: 'test-results/board-work-editors-office-loaded.png' })

      await typeInEditor(page, frameSel, 'board work e2e')
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })

      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await expect(editorStatus(page)).toHaveText(/저장됨 v2/, { timeout: 120_000 })
      await page.screenshot({ path: 'test-results/board-work-editors-office-saved.png' })

      // '메뉴 펼치기' → 이사회실 메뉴가 펼쳐지고 '넓게 보기'로 다시 접힌다. 편집기는 그대로 있다.
      // 저장 완료 대화상자가 떠 있어 먼저 닫는다(대화상자 밖은 누를 수 없다)
      await page.getByRole('dialog').getByRole('button', { name: '닫기' }).first().click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: '메뉴 펼치기' }).click()
      await expect(page.getByRole('navigation', { name: '이사회 메뉴' })).toBeVisible()
      await page.getByRole('button', { name: '넓게 보기' }).click()
      await expect(page.getByRole('navigation', { name: '이사회 메뉴' })).toBeHidden()
      await expect(page.locator(frameSel)).toBeVisible()

      // 계보: v1(이전) → v2(최신), 저장한 v2 에 편집기에서 친 글자가 들어 있다
      const lineage = await lineageOf(id)
      expect(lineage.map(v => [v.versionNo, v.isLatest])).toEqual([
        [1, false],
        [2, true],
      ])
      const v2 = await auditor.context.request.get(
        `/api/board-room/work/files/${lineage[1].id}?download=1`
      )
      expect(v2.status()).toBe(200)
      const zip = await JSZip.loadAsync(await v2.body())
      // ONLYOFFICE 가 문장 첫 글자를 대문자로 고친다(자동 고침) — 대소문자 무시
      expect(await zip.file('word/document.xml')?.async('string')).toMatch(/board work e2e/i)

      // 감사 화면 — 새로 고침 없이(폴링) 원래 게시물에 버전 답글이 달리고 v1 첨부에 "이전 버전" 표시가 붙는다
      const row = messageRow(auditor.page, `편집 시험 ${stamp}`)
      await expect(row.getByText('답글 1개')).toBeVisible({ timeout: POLL_BUDGET_MS })
      await expect(row.getByText('이전 버전')).toBeVisible({ timeout: POLL_BUDGET_MS })
      expect(
        await auditor.page.evaluate(
          () => (window as unknown as { __bwNoReload?: boolean }).__bwNoReload === true
        )
      ).toBe(true)
      await auditor.page.screenshot({ path: 'test-results/board-work-editors-office-poll.png' })
      // 스레드를 열면 버전 게시물 본문
      await row.getByText('답글 1개').click()
      await expect(
        auditor.page.getByText(/v2(을|를) 올렸습니다\. \(앱에서 편집\)/).first()
      ).toBeVisible({
        timeout: 15_000,
      })

      // 버전 기록 패널(첨부 미리보기 머리글 → 버전 기록) 화면 확인
      await auditor.page.keyboard.press('Escape')
      await row.getByRole('button', { name }).click()
      await auditor.page.getByRole('button', { name: '버전 기록' }).first().click()
      await expect(auditor.page.getByRole('dialog').getByText(/v2/).first()).toBeVisible({
        timeout: 15_000,
      })
      await auditor.page.waitForTimeout(500)
      await auditor.page.screenshot({ path: 'test-results/board-work-editors-version-history.png' })
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('HWP(rhwp): 첨부 미리보기의 "앱에서 편집"으로 열어 고쳐 저장하면 서버 검증·미리보기를 거쳐 v2 가 생긴다', async ({
    browser,
  }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED,
      'NEXT_PUBLIC_HWP_EDITOR_ENABLED 가 꺼져 있다'
    )
    test.setTimeout(300_000)
    const director = await openChannel(browser, 'director')
    try {
      const stamp = Date.now()
      const name = `e2e-감사의견-${stamp}.hwp`
      // rhwp 저장소의 작은 공개 표본(한글로 만든 한 쪽 문서) — 개인 파일이 아니다
      const hwp = readFileSync('scripts/testing/fixtures/board-work/sample.hwp')
      const id = await postFile(
        director.page,
        name,
        'application/x-hwp',
        hwp,
        `HWP 편집 시험 ${stamp}`
      )

      // 메시지 첨부 → 미리보기 대화상자 머리글의 "앱에서 편집"(FileVersionControls 진입점)
      const page = director.page
      const row = messageRow(page, `HWP 편집 시험 ${stamp}`)
      await row.getByRole('button', { name }).click()
      await page.getByRole('button', { name: '앱에서 편집' }).first().click({ timeout: 30_000 })
      await expect(page).toHaveURL(new RegExp(`/board-room/edit/${id}$`), { timeout: 30_000 })
      await expect(page.getByTestId('hwp-edit-screen')).toBeVisible({ timeout: 30_000 })
      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      // dev 의 StrictMode 는 효과를 두 번 돌려 잠깐 iframe 이 둘이다(첫 것은 만든 직후 destroy) — 하나로 줄 때까지
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(page.locator(frameSel)).toBeVisible()
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await page.screenshot({ path: 'test-results/board-work-editors-hwp-loaded.png' })

      await typeInEditor(page, frameSel, '이사회 업무툴 시험', { x: 0.5, y: 0.3 })
      // 사용자 편집은 이벤트가 없어 2초마다 dirty 를 묻는다(HWP_DIRTY_POLL_MS)
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })

      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      // 브라우저 검사(쪽 수 재확인·OLE2) → 업로드 → 서버 검증(kordoc) → 미리보기 → 새 버전으로 저장
      const save = page.getByRole('button', { name: '새 버전으로 저장' })
      await expect(save).toBeEnabled({ timeout: 120_000 })
      await page.screenshot({ path: 'test-results/board-work-editors-hwp-verified.png' })
      await save.click()
      await expect(page.getByText(/v2으로 저장됨/)).toBeVisible({ timeout: 60_000 })

      const lineage = await lineageOf(id)
      expect(lineage.map(v => [v.versionNo, v.isLatest])).toEqual([
        [1, false],
        [2, true],
      ])
      const v2 = await director.context.request.get(
        `/api/board-room/work/files/${lineage[1].id}?download=1`
      )
      const head = (await v2.body()).subarray(0, 8)
      expect([...head]).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    } finally {
      await director.context.close()
    }
  })

  test('새 문서(blank.docx): 입력창 "새 문서" → 편집기에서 처음 저장할 때 v1 이 생기고 감사 화면에 게시물이 뜬다', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const director = await openChannel(browser, 'director')
    const auditor = await openChannel(browser, 'auditor')
    try {
      const stamp = Date.now()
      const page = director.page
      await page.getByRole('button', { name: '새 문서 만들기' }).click()
      const dialog = page.getByRole('dialog', { name: '새 문서 만들기' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('radio', { name: 'Word 문서' }).check()
      const nameInput = dialog.getByLabel('파일 이름')
      await nameInput.fill(`e2e-새 문서-${stamp}`)
      await dialog.getByRole('button', { name: '만들기' }).click()
      await expect(page).toHaveURL(/\/board-room\/edit\/new\?/, { timeout: 30_000 })

      const frameSel = `iframe[src^="${ORIGIN}/editor"]`
      await expect(page.locator(frameSel)).toBeVisible({ timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await waitForEditorUi(page, '#editor_sdk')
      await page.waitForTimeout(2_000)
      await typeInEditor(page, frameSel, 'new document e2e')
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await expect(editorStatus(page)).toHaveText('저장됨', { timeout: 120_000 })
      await page.screenshot({ path: 'test-results/board-work-editors-new-saved.png' })

      const fileName = `e2e-새 문서-${stamp}.docx`
      const row = auditor.page.locator('[data-message-id]').filter({ hasText: fileName }).first()
      await expect(row).toContainText('새 문서', { timeout: POLL_BUDGET_MS })
      await expect(row).toContainText('만들었습니다')
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })
  /** 한글 문서 저장: 머리의 저장 → (검사·미리보기 대화상자가 뜨면) 대화상자의 저장 */
  async function saveHwp(page: Page, dialogLabel: '저장' | '새 버전으로 저장') {
    const dialogSave = page
      .getByRole('dialog')
      .getByRole('button', { name: dialogLabel, exact: true })
    await expect(dialogSave).toBeEnabled({ timeout: 120_000 })
    await page.screenshot({ path: `test-results/board-work-editors-hwpx-${dialogLabel}.png` })
    await dialogSave.click()
  }

  test('새 한글 문서(HWPX): 입력창 "새 문서" → rhwp 에서 처음 저장하면 v1, 다시 고쳐 저장하면 v2 가 생기고 둘 다 HWPX 다', async ({
    browser,
  }) => {
    test.skip(
      process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED !== '1' ||
        process.env.NEXT_PUBLIC_HWPX_EDITOR_ENABLED !== '1',
      'HWP·HWPX 편집 플래그가 꺼져 있다'
    )
    test.setTimeout(420_000)
    const director = await openChannel(browser, 'director')
    try {
      const stamp = Date.now()
      const page = director.page
      await page.getByRole('button', { name: '새 문서 만들기' }).click()
      const dialog = page.getByRole('dialog', { name: '새 문서 만들기' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('radio', { name: /한글 문서\(HWPX\)/ }).check()
      await dialog.getByLabel('파일 이름').fill(`e2e-새 한글-${stamp}`)
      await dialog.getByRole('button', { name: '만들기' }).click()
      await expect(page).toHaveURL(/\/board-room\/edit\/new\?.*type=hwpx/, { timeout: 30_000 })
      await expect(page.getByTestId('hwp-edit-screen')).toBeVisible({ timeout: 30_000 })

      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await typeInEditor(page, frameSel, '새 한글 문서 시험', { x: 0.5, y: 0.25 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await saveHwp(page, '저장')
      await expect(editorStatus(page)).toHaveText('저장됨', { timeout: 120_000 })

      // 저장 결과 대화상자("새 문서를 저장했습니다")를 닫고 같은 화면에서 이어 고친다
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '닫기', exact: true })
        .first()
        .click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await typeInEditor(page, frameSel, ' 둘째 판', { x: 0.5, y: 0.25 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await saveHwp(page, '새 버전으로 저장')
      await expect(editorStatus(page)).toHaveText('저장됨 v2', { timeout: 120_000 })
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '닫기', exact: true })
        .first()
        .click()

      const db = e2eDb()
      let rootId = ''
      try {
        const rs = await db.execute({
          sql: `select coalesce(version_root_id, id) root from work_attachments where name = ? limit 1`,
          args: [`e2e-새 한글-${stamp}.hwpx`],
        })
        rootId = String(rs.rows[0]?.root ?? '')
      } finally {
        db.close()
      }
      expect(rootId).toBeTruthy()
      const lineage = await lineageOf(rootId)
      expect(lineage.map(v => [v.versionNo, v.isLatest])).toEqual([
        [1, false],
        [2, true],
      ])
      for (const v of lineage) {
        const res = await director.context.request.get(
          `/api/board-room/work/files/${v.id}?download=1`
        )
        const bytes = await res.body()
        expect([...bytes.subarray(0, 4)], `v${v.versionNo} 은 ZIP(HWPX)`).toEqual([
          0x50, 0x4b, 0x03, 0x04,
        ])
        const zip = await JSZip.loadAsync(bytes)
        expect(await zip.file('mimetype')?.async('string')).toBe('application/hwp+zip')
      }
    } finally {
      await director.context.close()
    }
  })

  test('기존 HWPX: 첨부의 "앱에서 편집"으로 열어 고쳐 저장하면 HWPX 그대로 v2 가 생긴다', async ({
    browser,
  }) => {
    test.skip(
      process.env.NEXT_PUBLIC_HWP_EDITOR_ENABLED !== '1' ||
        process.env.NEXT_PUBLIC_HWPX_EDITOR_ENABLED !== '1',
      'HWP·HWPX 편집 플래그가 꺼져 있다'
    )
    test.setTimeout(300_000)
    const director = await openChannel(browser, 'director')
    try {
      const stamp = Date.now()
      const name = `e2e-한글-${stamp}.hwpx`
      const hwpx = readFileSync('scripts/testing/fixtures/board-work/blank.hwpx')
      const id = await postFile(
        director.page,
        name,
        'application/vnd.hancom.hwpx',
        hwpx,
        `HWPX 편집 시험 ${stamp}`
      )
      const page = director.page
      const row = messageRow(page, `HWPX 편집 시험 ${stamp}`)
      await row.getByRole('button', { name }).click()
      await page.getByRole('button', { name: '앱에서 편집' }).first().click({ timeout: 30_000 })
      await expect(page).toHaveURL(new RegExp(`/board-room/edit/${id}$`), { timeout: 30_000 })
      const frameSel = `[data-testid="hwp-editor-container"] iframe[src^="${ORIGIN}/rhwp/"]`
      await expect(page.locator(frameSel)).toHaveCount(1, { timeout: 60_000 })
      await expect(editorStatus(page)).toHaveText('변경 없음', { timeout: 120_000 })
      await page.waitForTimeout(3_000)
      await typeInEditor(page, frameSel, '한글 편집 시험', { x: 0.5, y: 0.25 })
      await expect(editorStatus(page)).toHaveText('저장 안 된 변경', { timeout: 30_000 })
      await page.getByRole('button', { name: '저장(새 버전)' }).click()
      await saveHwp(page, '새 버전으로 저장')
      await expect(page.getByText(/v2으로 저장됨/)).toBeVisible({ timeout: 60_000 })

      const lineage = await lineageOf(id)
      expect(lineage.map(v => [v.versionNo, v.isLatest, v.name])).toEqual([
        [1, false, name],
        [2, true, name],
      ])
      const v2 = await director.context.request.get(
        `/api/board-room/work/files/${lineage[1].id}?download=1`
      )
      expect([...(await v2.body()).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    } finally {
      await director.context.close()
    }
  })
})
