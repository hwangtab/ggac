import { test, expect } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'
import { cronHeaders, E2E_CRON_SECRET } from './helpers/cron'

assertLocalTurso()

/**
 * 이사회 업무툴(kosmart-work 이식) 권한 경계 — docs/board-work/01-설계.md §10.
 *
 * 원본은 Postgres RLS가 막았다. 여기에는 RLS가 없어서 **이 스펙이 안전망**이다
 * (scripts/testing/assert-runtime-risks.mjs의 server action 검사는 문자열만 본다).
 * 단계마다 케이스를 늘린다. 0단계는 진입 게이트 하나다.
 *
 * authz-roles.spec.ts와 같은 규칙: **짝지어 단정한다.** 금지 쪽 리다이렉트만 보면
 * 게이트가 "전원 리다이렉트"로 퇴화해도(이사도 못 들어가는 상태) 초록이다.
 */
test.describe('업무툴 진입', () => {
  test('일반 조합원은 /board로 돌아가고, 관리자가 아닌 이사는 업무툴을 연다', async ({
    browser,
  }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })
    const directorContext = await browser.newContext({
      storageState: storageStatePath('director'),
    })

    try {
      // 금지 쪽: 승인된 **일반** 조합원(미승인 계정은 앞선 승인 분기에 먼저 걸려 이사 판정을 검사하지 못한다).
      const memberPage = await memberContext.newPage()
      await memberPage.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(memberPage).toHaveURL(/\/board$/, { timeout: 15000 })

      // 허용 쪽: **관리자가 아닌 이사**(admin으로 보면 is_admin 분기만 타서 is_director 판정이 검사되지 않는다).
      const directorPage = await directorContext.newPage()
      await directorPage.goto('/board-room/chat', { waitUntil: 'domcontentloaded' })
      await expect(directorPage).toHaveURL(/\/board-room\/chat$/, { timeout: 15000 })
      // 게이트를 지나 화면이 실제로 그려졌는지 — 가드가 넘겨 준 역할까지 본다(이사 = 구성원, 관리자 아님).
      await expect(directorPage.getByRole('heading', { name: '대화', level: 1 })).toBeVisible({
        timeout: 15000,
      })
      await expect(directorPage.getByTestId('board-work-staff')).toContainText('구성원')
      // 업무 화면은 이사회실의 한 영역이다 — 전역 내비·이사회실 메뉴('업무' 묶음 포함) 안에서 그린다
      // (docs/board-work/03-통합-재설계.md §4-1).
      const boardMenu = directorPage.getByRole('navigation', { name: '이사회 메뉴' })
      await expect(boardMenu).toBeVisible()
      await expect(
        boardMenu.getByRole('group', { name: '업무' }).getByRole('link', { name: /^대화/ })
      ).toHaveAttribute('aria-current', 'page')
    } finally {
      await memberContext.close()
      await directorContext.close()
    }
  })
})

/**
 * 채널 읽기 경계(1단계) — 원본 can_read_channel(kosmart-work 0037):
 *   멤버 / 공개 채널 + 내부 구성원 / 비공개 채널 + 관리자. **DM·그룹은 멤버만**(관리자도 남의 DM은 못 읽는다).
 * 시드(`seed-authz-fixtures.mjs`): 공개 채널(관리자가 만듦, 이사·감사 멤버) · 비공개 채널(감사 owner, 이사는 아님) ·
 * 이사–감사 DM. 각 채널에 메시지 1개.
 *
 * server action은 Playwright에서 부르기 번거로워 여기서는 **폴링 라우트와 페이지 로더**로 본다. action의 쓰기 규칙
 * (보관 채널·공지 채널·작성자 강제·답글 1단계)은 `scripts/testing/queriesBoardWork.test.mjs`가 실제 SQLite로 본다.
 */
type SyncBody = {
  success: boolean
  data: {
    changed: Record<string, { rev: number; messageIds: string[]; pinsChanged: boolean }>
    membershipRev: number
    badges: { channels: Record<string, { unread: number; mentions: number }> }
    online: string[]
  }
}

async function syncAs(
  browser: import('@playwright/test').Browser,
  role: string,
  channels: Record<string, number>
): Promise<{ status: number; body: SyncBody | null }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) })
  try {
    const res = await context.request.post('/api/board-room/work/sync', {
      data: { channels, membershipRev: null, focus: null, typing: null },
    })
    const status = res.status()
    const body = status === 200 ? ((await res.json()) as SyncBody) : null
    return { status, body }
  } finally {
    await context.close()
  }
}

test.describe('업무툴 채널 읽기 경계 — 폴링(/api/board-room/work/sync)', () => {
  test('이사: 공개 채널·자기 DM은 changed에 나오고, 초대받지 않은 비공개 채널은 절대 나오지 않는다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const all = {
      [f.workPublicChannelId]: 0,
      [f.workPrivateChannelId]: 0,
      [f.workDmChannelId]: 0,
    }
    const { status, body } = await syncAs(browser, 'director', all)
    expect(status).toBe(200)
    const changed = body!.data.changed
    // 허용 쪽: 읽을 수 있는 채널은 바뀐 메시지 id까지 돌아온다
    expect(changed[f.workPublicChannelId]?.messageIds).toContain(f.workPublicMessageId)
    expect(changed[f.workDmChannelId]?.messageIds).toContain(f.workDmMessageId)
    // 금지 쪽: 비공개 채널은 키조차 없다(rev·메시지 id·고정 여부 어느 것도 새지 않는다)
    expect(Object.keys(changed)).not.toContain(f.workPrivateChannelId)
    expect(JSON.stringify(body)).not.toContain(f.workPrivateMessageId)
    expect(Object.keys(body!.data.badges.channels)).not.toContain(f.workPrivateChannelId)
  })

  test('감사(비공개 채널 owner): 같은 요청에 비공개 채널이 나온다', async ({ browser }) => {
    const f = readFixtures()
    const { status, body } = await syncAs(browser, 'auditor', {
      [f.workPrivateChannelId]: 0,
      [f.workDmChannelId]: 0,
    })
    expect(status).toBe(200)
    expect(body!.data.changed[f.workPrivateChannelId]?.messageIds).toContain(f.workPrivateMessageId)
    expect(body!.data.changed[f.workDmChannelId]?.messageIds).toContain(f.workDmMessageId)
  })

  test('관리자: 비공개 채널은 읽지만(0037) 이사–감사 DM은 나오지 않는다', async ({ browser }) => {
    const f = readFixtures()
    const { status, body } = await syncAs(browser, 'admin', {
      [f.workPrivateChannelId]: 0,
      [f.workDmChannelId]: 0,
    })
    expect(status).toBe(200)
    // 허용 쪽: 관리자는 멤버가 아닌 비공개 채널도 읽는다
    expect(body!.data.changed[f.workPrivateChannelId]?.messageIds).toContain(f.workPrivateMessageId)
    // 금지 쪽: 관리자도 남의 DM은 못 읽는다
    expect(Object.keys(body!.data.changed)).not.toContain(f.workDmChannelId)
    expect(JSON.stringify(body)).not.toContain(f.workDmMessageId)
  })

  test('일반 조합원은 403이고, 이사는 같은 요청에 200이다', async ({ browser }) => {
    const f = readFixtures()
    const req = { [f.workPublicChannelId]: 0 }
    const member = await syncAs(browser, 'other', req)
    expect(member.status).toBe(403)
    expect(member.body).toBeNull()
    const director = await syncAs(browser, 'director', req)
    expect(director.status).toBe(200)
  })

  test('rev가 같으면 changed가 비고, 잘못된 채널 id는 400이다', async ({ browser }) => {
    const f = readFixtures()
    const first = await syncAs(browser, 'director', { [f.workPublicChannelId]: 0 })
    const rev = first.body!.data.changed[f.workPublicChannelId].rev
    expect(rev).toBeGreaterThan(0)
    const again = await syncAs(browser, 'director', { [f.workPublicChannelId]: rev })
    expect(again.status).toBe(200)
    expect(again.body!.data.changed).toEqual({})
    const bad = await syncAs(browser, 'director', { 'not-a-uuid': 0 })
    expect(bad.status).toBe(400)
  })
})

test.describe('업무툴 채널 읽기 경계 — 화면 로더', () => {
  test('비공개 채널 페이지: 초대받지 않은 이사는 404, owner인 감사는 본문을 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const directorContext = await browser.newContext({
      storageState: storageStatePath('director'),
    })
    const auditorContext = await browser.newContext({ storageState: storageStatePath('auditor') })
    try {
      const path = `/board-room/c/${f.workPrivateChannelSlug}`
      const denied = await directorContext.newPage()
      const deniedRes = await denied.goto(path, { waitUntil: 'domcontentloaded' })
      expect(deniedRes?.status()).toBe(404)
      await expect(denied.getByTestId('board-work-channel')).toHaveCount(0)
      await expect(denied.getByText('authz-e2e 비공개 채널 글')).toHaveCount(0)

      const allowed = await auditorContext.newPage()
      const allowedRes = await allowed.goto(path, { waitUntil: 'domcontentloaded' })
      expect(allowedRes?.status()).toBe(200)
      await expect(allowed.getByTestId('board-work-channel')).toBeVisible({ timeout: 15000 })
      await expect(allowed.getByText('authz-e2e 비공개 채널 글')).toBeVisible()
    } finally {
      await directorContext.close()
      await auditorContext.close()
    }
  })

  test('DM 페이지: 관리자는 남의 DM이 404, 당사자인 이사는 본문을 본다', async ({ browser }) => {
    const f = readFixtures()
    const adminContext = await browser.newContext({ storageState: storageStatePath('admin') })
    const directorContext = await browser.newContext({
      storageState: storageStatePath('director'),
    })
    try {
      const path = `/board-room/dm/${f.workDmChannelId}`
      const denied = await adminContext.newPage()
      const deniedRes = await denied.goto(path, { waitUntil: 'domcontentloaded' })
      expect(deniedRes?.status()).toBe(404)
      await expect(denied.getByText('authz-e2e 이사와 감사의 DM')).toHaveCount(0)

      const allowed = await directorContext.newPage()
      const allowedRes = await allowed.goto(path, { waitUntil: 'domcontentloaded' })
      expect(allowedRes?.status()).toBe(200)
      await expect(allowed.getByText('authz-e2e 이사와 감사의 DM')).toBeVisible({
        timeout: 15000,
      })
    } finally {
      await adminContext.close()
      await directorContext.close()
    }
  })
})

/**
 * 입력 중 표시 경계 — 원본은 채널 토픽(typing broadcast)을 **멤버만** 받았다(0001 work_channel_topic_read).
 * 관리자는 비공개 채널 메시지를 읽을 수 있지만(0037) 멤버가 아니면 입력 중 신호는 받지 않는다
 * (독립 권한 검토 2026-11-02 — 처음 구현은 읽기 범위로만 걸러 관리자에게 보였다).
 *
 * 짝 단정: 같은 경로로 **멤버끼리는 보인다**는 것도 확인한다(DM: 이사가 입력 → 감사가 본다). 없으면 입력 중 표시가
 * 통째로 죽은 상태도 초록이다.
 */
test.describe('업무툴 입력 중 표시 — 멤버에게만', () => {
  async function postSync(
    browser: import('@playwright/test').Browser,
    role: string,
    data: Record<string, unknown>
  ): Promise<{ typing: { userId: string }[] }> {
    const context = await browser.newContext({ storageState: storageStatePath(role) })
    try {
      const res = await context.request.post('/api/board-room/work/sync', { data })
      expect(res.status()).toBe(200)
      return (await res.json()).data
    } finally {
      await context.close()
    }
  }

  test('DM 멤버끼리는 입력 중이 보이고, 비공개 채널의 입력 중은 멤버 아닌 관리자에게 안 보인다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const base = { channels: {}, membershipRev: null }

    // 허용 쪽: 이사가 DM에서 입력 → 같은 DM 멤버인 감사가 본다
    await postSync(browser, 'director', {
      ...base,
      focus: null,
      typing: { channelId: f.workDmChannelId, scope: null },
    })
    const auditorView = await postSync(browser, 'auditor', {
      ...base,
      focus: { channelId: f.workDmChannelId, threadId: null },
      typing: null,
    })
    expect(auditorView.typing.map(t => t.userId)).toContain(f.users.director)

    // 금지 쪽: 감사가 비공개 채널(감사 owner, 관리자는 멤버 아님)에서 입력 → 관리자는 못 본다
    await postSync(browser, 'auditor', {
      ...base,
      focus: null,
      typing: { channelId: f.workPrivateChannelId, scope: null },
    })
    const adminView = await postSync(browser, 'admin', {
      ...base,
      focus: { channelId: f.workPrivateChannelId, threadId: null },
      typing: null,
    })
    expect(adminView.typing).toEqual([])
  })
})

/**
 * 대화 탭·메모·할 일 읽기 경계(2b) — 원본 conversation_tabs_select·conversation_notes_select·tasks_select는 모두
 * can_read_channel이었다. 시드: 비공개 채널(감사 owner, 이사 아님)과 이사–감사 DM에 메모 탭·할 일 탭·할 일이 하나씩.
 * 짝 단정: 같은 주소를 **허용되는 사람이 열면 본문이 보인다**는 것도 함께 본다(경계가 "전원 404"로 퇴화해도 초록이 되지 않게).
 */
test.describe('업무툴 대화 탭·메모·할 일 — 읽기 경계', () => {
  async function open(browser: import('@playwright/test').Browser, role: string, path: string) {
    const context = await browser.newContext({ storageState: storageStatePath(role) })
    const page = await context.newPage()
    const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
    return { context, page, status: res?.status() ?? 0 }
  }

  test('비공개 채널의 메모 탭: 초대받지 않은 이사는 404, owner인 감사는 메모 본문을 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const path = `/board-room/c/${f.workPrivateChannelSlug}/t/${f.workPrivateNoteTabId}`
    const denied = await open(browser, 'director', path)
    const allowed = await open(browser, 'auditor', path)
    try {
      expect(denied.status).toBe(404)
      await expect(denied.page.getByTestId('board-work-tab')).toHaveCount(0)
      await expect(denied.page.getByText('authz-e2e 비공개 메모 본문')).toHaveCount(0)

      expect(allowed.status).toBe(200)
      await expect(allowed.page.getByTestId('board-work-tab')).toBeVisible({ timeout: 15000 })
      await expect(allowed.page.getByText('authz-e2e 비공개 메모 본문').first()).toBeVisible()
    } finally {
      await denied.context.close()
      await allowed.context.close()
    }
  })

  test('비공개 채널의 할 일 탭: 이사는 404, 감사는 할 일을 본다', async ({ browser }) => {
    const f = readFixtures()
    const path = `/board-room/c/${f.workPrivateChannelSlug}/t/${f.workPrivateTasksTabId}`
    const denied = await open(browser, 'director', path)
    const allowed = await open(browser, 'auditor', path)
    try {
      expect(denied.status).toBe(404)
      await expect(denied.page.getByText('authz-e2e 비공개 할 일')).toHaveCount(0)

      expect(allowed.status).toBe(200)
      await expect(allowed.page.getByText('authz-e2e 비공개 할 일').first()).toBeVisible({
        timeout: 15000,
      })
    } finally {
      await denied.context.close()
      await allowed.context.close()
    }
  })

  test('다른 대화의 탭 id를 읽을 수 있는 채널 주소에 붙여도 404다(탭은 그 대화 소속만)', async ({
    browser,
  }) => {
    const f = readFixtures()
    // 이사는 공개 채널을 읽을 수 있다 — 거기에 비공개 채널의 메모 탭 id를 붙인다
    const crossed = await open(
      browser,
      'director',
      `/board-room/c/${f.workPublicChannelSlug}/t/${f.workPrivateNoteTabId}`
    )
    // 짝: 같은 이사가 자기 DM의 메모 탭은 연다
    const own = await open(
      browser,
      'director',
      `/board-room/dm/${f.workDmChannelId}/t/${f.workDmNoteTabId}`
    )
    try {
      expect(crossed.status).toBe(404)
      await expect(crossed.page.getByText('authz-e2e 비공개 메모 본문')).toHaveCount(0)
      expect(own.status).toBe(200)
      await expect(own.page.getByText('authz-e2e DM 메모 본문').first()).toBeVisible({
        timeout: 15000,
      })
    } finally {
      await crossed.context.close()
      await own.context.close()
    }
  })

  test('DM의 메모·할 일 탭: 관리자는 남의 DM이라 404, 당사자인 감사는 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const notePath = `/board-room/dm/${f.workDmChannelId}/t/${f.workDmNoteTabId}`
    const tasksPath = `/board-room/dm/${f.workDmChannelId}/t/${f.workDmTasksTabId}`
    const deniedNote = await open(browser, 'admin', notePath)
    const deniedTasks = await open(browser, 'admin', tasksPath)
    const allowedNote = await open(browser, 'auditor', notePath)
    const allowedTasks = await open(browser, 'auditor', tasksPath)
    try {
      expect(deniedNote.status).toBe(404)
      await expect(deniedNote.page.getByText('authz-e2e DM 메모 본문')).toHaveCount(0)
      expect(deniedTasks.status).toBe(404)
      await expect(deniedTasks.page.getByText('authz-e2e DM 할 일')).toHaveCount(0)

      expect(allowedNote.status).toBe(200)
      await expect(allowedNote.page.getByText('authz-e2e DM 메모 본문').first()).toBeVisible({
        timeout: 15000,
      })
      expect(allowedTasks.status).toBe(200)
      await expect(allowedTasks.page.getByText('authz-e2e DM 할 일').first()).toBeVisible()
    } finally {
      for (const o of [deniedNote, deniedTasks, allowedNote, allowedTasks]) await o.context.close()
    }
  })

  test('할 일 목록(/board-room/tasks): 이사에게는 비공개 채널 할 일이 없고 DM 할 일은 있다, 감사에게는 둘 다 있다', async ({
    browser,
  }) => {
    const director = await open(browser, 'director', '/board-room/tasks?view=all')
    const auditor = await open(browser, 'auditor', '/board-room/tasks?view=all')
    try {
      expect(director.status).toBe(200)
      await expect(director.page.getByTestId('board-work-tasks')).toBeVisible({ timeout: 15000 })
      await expect(director.page.getByText('authz-e2e DM 할 일').first()).toBeVisible()
      await expect(director.page.getByText('authz-e2e 비공개 할 일')).toHaveCount(0)

      expect(auditor.status).toBe(200)
      await expect(auditor.page.getByText('authz-e2e 비공개 할 일').first()).toBeVisible({
        timeout: 15000,
      })
      await expect(auditor.page.getByText('authz-e2e DM 할 일').first()).toBeVisible()
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('관리자는 비공개 채널의 메모 탭을 읽지만(0037) 할 일 목록에 남의 DM 할 일은 없다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const note = await open(
      browser,
      'admin',
      `/board-room/c/${f.workPrivateChannelSlug}/t/${f.workPrivateNoteTabId}`
    )
    const tasks = await open(browser, 'admin', '/board-room/tasks?view=all')
    try {
      expect(note.status).toBe(200)
      await expect(note.page.getByText('authz-e2e 비공개 메모 본문').first()).toBeVisible({
        timeout: 15000,
      })
      // 멤버가 아니라 편집 단추가 없다(쓰기는 대화 멤버만)
      await expect(note.page.getByRole('button', { name: '편집' })).toHaveCount(0)

      expect(tasks.status).toBe(200)
      await expect(tasks.page.getByText('authz-e2e 비공개 할 일').first()).toBeVisible({
        timeout: 15000,
      })
      await expect(tasks.page.getByText('authz-e2e DM 할 일')).toHaveCount(0)
    } finally {
      await note.context.close()
      await tasks.context.close()
    }
  })

  test('일반 조합원은 탭·할 일 화면 모두 /board로 돌아가고, 같은 주소를 감사는 연다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const paths = [
      '/board-room/tasks',
      `/board-room/c/${f.workPublicChannelSlug}/t/${f.workPrivateNoteTabId}`,
      `/board-room/dm/${f.workDmChannelId}/t/${f.workDmNoteTabId}`,
    ]
    const member = await browser.newContext({ storageState: storageStatePath('other') })
    try {
      const page = await member.newPage()
      for (const path of paths) {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/\/board$/, { timeout: 15000 })
        await expect(page.getByTestId('board-work-tab')).toHaveCount(0)
        await expect(page.getByTestId('board-work-tasks')).toHaveCount(0)
      }
    } finally {
      await member.close()
    }
    const allowed = await open(browser, 'auditor', paths[2])
    try {
      expect(allowed.status).toBe(200)
      await expect(allowed.page.getByTestId('board-work-tab')).toBeVisible({ timeout: 15000 })
    } finally {
      await allowed.context.close()
    }
  })

  test('폴링: 비공개 채널의 메모 저장(tabs_rev)은 이사의 sync에 새지 않고 감사에게는 tabsChanged로 온다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const req = { [f.workPrivateChannelId]: 0 }
    const director = await syncAs(browser, 'director', req)
    const auditor = await syncAs(browser, 'auditor', req)
    expect(director.status).toBe(200)
    expect(Object.keys(director.body!.data.changed)).not.toContain(f.workPrivateChannelId)
    expect(auditor.status).toBe(200)
    const change = auditor.body!.data.changed[f.workPrivateChannelId] as unknown as {
      tabsChanged: boolean
    }
    expect(change.tabsChanged).toBe(true)
  })
})

/**
 * 파일(2a) 경계 — 원본 getReadableAttachment: **읽을 수 있는 채널 + 지워지지 않은 메시지**의 첨부만.
 * 시드는 각 채널 메시지에 첨부 행 하나씩을 만들지만 **Blob 객체는 만들지 않는다**(운영 저장소 오염 방지). 이 스위트의
 * 업무툴 저장소 토큰은 빈 값이라(playwright.config.ts `BOARD_WORK_BLOB_READ_WRITE_TOKEN`), 파일 라우트는 권한을
 * **지난 뒤에만** 503(저장소 미설정)을 낸다. 그래서 허용 쪽은 503, 거부 쪽은 404(읽을 수 없음 — 존재를 숨긴다)·
 * 403(이사회 밖)으로 갈린다. 시험 저장소 토큰을 준 실행에서는 허용 쪽이 404(객체 없음)일 수 있어 둘 다 받는다.
 */
const ALLOWED_STORAGE_STATUSES = [503, 404]

async function getAs(
  browser: import('@playwright/test').Browser,
  role: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) })
  try {
    const res = await context.request.get(path, { headers, maxRedirects: 0 })
    return { status: res.status(), body: await res.text(), headers: res.headers() }
  } finally {
    await context.close()
  }
}

async function postAs(
  browser: import('@playwright/test').Browser,
  role: string,
  path: string,
  data: unknown
): Promise<{ status: number; body: string }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) })
  try {
    const res = await context.request.post(path, { data })
    return { status: res.status(), body: await res.text() }
  } finally {
    await context.close()
  }
}

const fileRoutes = (id: string) => [
  `/api/board-room/work/files/${id}`,
  `/api/board-room/work/files/${id}?download=1`,
  `/api/board-room/work/files/${id}?thumb=1`,
  `/api/board-room/work/files/${id}/${encodeURIComponent('이름.pdf')}`,
  `/api/board-room/work/files/${id}/render?view=layout`,
]

test.describe('업무툴 파일 경계 — 다운로드·미리보기·렌더 라우트', () => {
  test('비공개 채널 첨부: 초대받지 않은 이사는 404, owner인 감사와 관리자는 권한을 지난다(503)', async ({
    browser,
  }) => {
    const f = readFixtures()
    for (const path of fileRoutes(f.workPrivateAttachmentId)) {
      const denied = await getAs(browser, 'director', path)
      expect(denied.status, `이사 ${path}`).toBe(404)
      expect(denied.body).not.toContain(f.workPrivateFileName)
      // 렌더(.pdf 는 레이아웃 대상이 아님 → 415 unsupported)도 권한을 지난 뒤의 응답이다 — 허용 쪽 표식으로 함께 받는다
      const allowedStatuses = path.includes('/render') ? [415] : ALLOWED_STORAGE_STATUSES
      const auditor = await getAs(browser, 'auditor', path)
      expect(allowedStatuses, `감사 ${path} → ${auditor.status}`).toContain(auditor.status)
      const admin = await getAs(browser, 'admin', path)
      expect(allowedStatuses, `관리자 ${path} → ${admin.status}`).toContain(admin.status)
    }
  })

  test('DM 첨부: 관리자도 404, 당사자인 이사는 권한을 지난다', async ({ browser }) => {
    const f = readFixtures()
    for (const path of fileRoutes(f.workDmAttachmentId).slice(0, 4)) {
      expect((await getAs(browser, 'admin', path)).status, `관리자 ${path}`).toBe(404)
      expect(ALLOWED_STORAGE_STATUSES).toContain((await getAs(browser, 'director', path)).status)
    }
  })

  test('일반 조합원은 403, 비로그인은 401 — 없는 id 와 잘못된 id 는 이사에게도 404', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const f = readFixtures()
    for (const path of fileRoutes(f.workPublicAttachmentId)) {
      expect((await getAs(browser, 'other', path)).status, path).toBe(403)
    }
    const anon = await playwright.request.newContext({ baseURL })
    try {
      const res = await anon.get(`/api/board-room/work/files/${f.workPublicAttachmentId}`, {
        maxRedirects: 0,
      })
      expect(res.status()).toBe(401)
    } finally {
      await anon.dispose()
    }
    expect(ALLOWED_STORAGE_STATUSES).toContain(
      (await getAs(browser, 'director', `/api/board-room/work/files/${f.workPublicAttachmentId}`))
        .status
    )
    expect(
      (await getAs(browser, 'director', `/api/board-room/work/files/${crypto.randomUUID()}`)).status
    ).toBe(404)
    expect((await getAs(browser, 'director', '/api/board-room/work/files/not-a-uuid')).status).toBe(
      404
    )
  })

  test('Range 가 크기 밖이면 권한을 지난 뒤 416(저장소를 부르지 않는다), 권한이 없으면 여전히 404', async ({
    browser,
  }) => {
    const f = readFixtures()
    const path = `/api/board-room/work/files/${f.workPrivateAttachmentId}`
    const ok = await getAs(browser, 'auditor', path, { Range: 'bytes=999999-' })
    expect(ok.status).toBe(416)
    expect(ok.headers['content-range']).toBe('bytes */1234')
    expect(ok.headers['cache-control']).toContain('no-store')
    const denied = await getAs(browser, 'director', path, { Range: 'bytes=999999-' })
    expect(denied.status).toBe(404)
  })
})

test.describe('업무툴 파일 경계 — 목록 화면', () => {
  test('자료실: 이사에게 비공개 채널·남의 DM 파일은 없고 공개 채널 파일은 보인다, 감사는 비공개 파일을 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    const auditorContext = await browser.newContext({ storageState: storageStatePath('auditor') })
    const adminContext = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const director = await directorContext.newPage()
      await director.goto('/board-room/files', { waitUntil: 'domcontentloaded' })
      await expect(director.getByTestId('board-work-files')).toBeVisible({ timeout: 15000 })
      await expect(director.getByText(f.workPublicFileName).first()).toBeVisible()
      await expect(director.getByText(f.workDmFileName).first()).toBeVisible()
      await expect(director.getByText(f.workPrivateFileName)).toHaveCount(0)
      // 채널을 직접 지정해도 새지 않는다
      await director.goto(`/board-room/files?channel=${f.workPrivateChannelId}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(director.getByTestId('board-work-files')).toBeVisible({ timeout: 15000 })
      await expect(director.getByText(f.workPrivateFileName)).toHaveCount(0)

      const auditor = await auditorContext.newPage()
      await auditor.goto('/board-room/files', { waitUntil: 'domcontentloaded' })
      await expect(auditor.getByText(f.workPrivateFileName).first()).toBeVisible({ timeout: 15000 })

      // 관리자: 비공개 채널 파일은 보이고(0037), 남의 DM 파일은 안 보인다
      const admin = await adminContext.newPage()
      await admin.goto('/board-room/files', { waitUntil: 'domcontentloaded' })
      await expect(admin.getByText(f.workPrivateFileName).first()).toBeVisible({ timeout: 15000 })
      await expect(admin.getByText(f.workDmFileName)).toHaveCount(0)
    } finally {
      await directorContext.close()
      await auditorContext.close()
      await adminContext.close()
    }
  })

  test('채널 파일 탭·DM 공유됨: 읽을 수 없으면 404, 읽을 수 있으면 파일이 보인다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    const auditorContext = await browser.newContext({ storageState: storageStatePath('auditor') })
    const adminContext = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const privatePath = `/board-room/c/${f.workPrivateChannelSlug}/files`
      const denied = await directorContext.newPage()
      expect((await denied.goto(privatePath, { waitUntil: 'domcontentloaded' }))?.status()).toBe(
        404
      )
      await expect(denied.getByText(f.workPrivateFileName)).toHaveCount(0)

      const allowed = await auditorContext.newPage()
      expect((await allowed.goto(privatePath, { waitUntil: 'domcontentloaded' }))?.status()).toBe(
        200
      )
      await expect(allowed.getByText(f.workPrivateFileName).first()).toBeVisible({ timeout: 15000 })

      const dmShared = `/board-room/dm/${f.workDmChannelId}/shared`
      const adminPage = await adminContext.newPage()
      expect((await adminPage.goto(dmShared, { waitUntil: 'domcontentloaded' }))?.status()).toBe(
        404
      )
      await expect(adminPage.getByText(f.workDmFileName)).toHaveCount(0)
      const directorPage = await directorContext.newPage()
      expect((await directorPage.goto(dmShared, { waitUntil: 'domcontentloaded' }))?.status()).toBe(
        200
      )
      await expect(directorPage.getByText(f.workDmFileName).first()).toBeVisible({ timeout: 15000 })
    } finally {
      await directorContext.close()
      await auditorContext.close()
      await adminContext.close()
    }
  })

  test('메시지 첨부: 비공개 채널 화면에서 owner는 첨부를 보고, 공개 채널 화면에서 이사는 첨부를 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const auditorContext = await browser.newContext({ storageState: storageStatePath('auditor') })
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const auditor = await auditorContext.newPage()
      await auditor.goto(`/board-room/c/${f.workPrivateChannelSlug}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(auditor.getByText(f.workPrivateFileName).first()).toBeVisible({ timeout: 15000 })
      const director = await directorContext.newPage()
      await director.goto(`/board-room/c/${f.workPublicChannelSlug}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(director.getByText(f.workPublicFileName).first()).toBeVisible({ timeout: 15000 })
      await expect(director.getByText(f.workPrivateFileName)).toHaveCount(0)
    } finally {
      await auditorContext.close()
      await directorContext.close()
    }
  })
})

test.describe('업무툴 파일 경계 — 업로드 준비·토큰(/api/board-room/work/uploads)', () => {
  const UPLOADS = '/api/board-room/work/uploads'
  const file = { name: 'e2e.pdf', size: 10, mime: 'application/pdf' }

  test('준비: 이사는 글을 쓸 수 없는 비공개 채널에 403, 멤버인 공개 채널은 권한을 지난다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const denied = await postAs(browser, 'director', UPLOADS, {
      type: 'prepare',
      channelId: f.workPrivateChannelId,
      files: [file],
    })
    expect(denied.status).toBe(403)
    // 관리자도 멤버가 아닌 비공개 채널에는 올리지 못한다(읽기만 — 원본 is_channel_member)
    const adminDenied = await postAs(browser, 'admin', UPLOADS, {
      type: 'prepare',
      channelId: f.workPrivateChannelId,
      files: [file],
    })
    expect(adminDenied.status).toBe(403)
    // 허용 쪽: 저장소가 없으면 503(행을 만들지 않는다), 시험 저장소가 있으면 200
    const allowed = await postAs(browser, 'director', UPLOADS, {
      type: 'prepare',
      channelId: f.workPublicChannelId,
      files: [file],
    })
    expect([200, 503]).toContain(allowed.status)
    expect(
      (
        await postAs(browser, 'other', UPLOADS, {
          type: 'prepare',
          channelId: f.workPublicChannelId,
          files: [file],
        })
      ).status
    ).toBe(403)
  })

  test('토큰: 남의 임시 업로드·다른 키로는 받을 수 없고, 내 행·같은 키면 권한을 지난다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const tokenRequest = (pathname: string, uploadId: string) => ({
      type: 'blob.generate-client-token',
      payload: { pathname, multipart: false, clientPayload: uploadId },
    })
    // 이사가 감사의 비공개 채널 임시 업로드로 토큰을 받으려 하면 — 행이 본인 것이 아니라 404
    const foreign = await postAs(
      browser,
      'director',
      UPLOADS,
      tokenRequest(f.workAuditorPendingPath, f.workAuditorPendingId)
    )
    expect(foreign.status).toBe(404)
    expect(foreign.body).not.toContain('clientToken')
    // 자기 행이라도 다른 키(비공개 저장소의 다른 영역)로는 403
    for (const other of ['backups/ggac-prod.sql.gz', f.workAuditorPendingPath]) {
      const res = await postAs(
        browser,
        'director',
        UPLOADS,
        tokenRequest(other, f.workDirectorPendingId)
      )
      expect(res.status, other).toBe(403)
      expect(res.body).not.toContain('clientToken')
    }
    // 허용 쪽: 자기 행·같은 키 → 저장소가 없으면 503, 시험 저장소가 있으면 토큰
    const mine = await postAs(
      browser,
      'director',
      UPLOADS,
      tokenRequest(f.workDirectorPendingPath, f.workDirectorPendingId)
    )
    expect([200, 503]).toContain(mine.status)
    // 감사는 자기 비공개 채널 행으로 권한을 지난다
    const auditor = await postAs(
      browser,
      'auditor',
      UPLOADS,
      tokenRequest(f.workAuditorPendingPath, f.workAuditorPendingId)
    )
    expect([200, 503]).toContain(auditor.status)
    // 일반 조합원은 403
    expect(
      (
        await postAs(
          browser,
          'other',
          UPLOADS,
          tokenRequest(f.workDirectorPendingPath, f.workDirectorPendingId)
        )
      ).status
    ).toBe(403)
  })
})

/**
 * 3단계(문서 버전·앱 안 편집) 경계 — 편집 화면(`/board-room/edit/<id>`)과 문서 편집 라우트(form·blocks·draft·
 * drafts/<uploadId>/{verify,render}·new-drafts/<uploadId>/verify). 원본은 RLS(can_read_channel) + 편집 권한(canEditFile,
 * 채널 멤버)이 막았다. 시드: 비공개 채널(감사 owner, 이사 아님)의 HWP 첨부 · 이사–감사 DM 의 DOCX 첨부(객체는 없다).
 *
 * 허용 쪽 표식: 편집 화면은 200 + 파일 이름이 그려진 머리줄, 라우트는 권한을 지난 뒤 원본 객체를 읽는 단계의
 * 503("원본 파일을 읽지 못했습니다" — 이 스위트에는 객체가 없다) 또는 내 임시 업로드를 읽는 단계의 404 "저장본" 문구.
 * 금지 쪽은 존재를 숨기는 404(일반 문구). 편집기 출처 env(`NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN`)가 없으면 편집 화면은
 * 누구에게나 404 라(기능 숨김) 그때는 화면 쪽 짝 단정을 "둘 다 404"로 바꾼다.
 */
test.describe('업무툴 문서 편집 경계 — 편집 화면·문서 편집 라우트', () => {
  const editorOn = Boolean(process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN)
  const NOT_FOUND_MESSAGE = '파일을 찾을 수 없거나 권한이 없습니다.'

  async function openPage(browser: import('@playwright/test').Browser, role: string, path: string) {
    const context = await browser.newContext({
      storageState: storageStatePath(role),
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()
    const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
    return { context, page, status: res?.status() ?? 0 }
  }

  test('편집 화면: 비공개 채널 HWP 를 이사는 404, owner인 감사는 연다', async ({ browser }) => {
    const f = readFixtures()
    const path = `/board-room/edit/${f.workPrivateHwpAttachmentId}`
    const denied = await openPage(browser, 'director', path)
    const allowed = await openPage(browser, 'auditor', path)
    try {
      expect(denied.status).toBe(404)
      await expect(denied.page.getByText('authz-e2e 비공개 감사의견.hwp')).toHaveCount(0)
      if (editorOn) {
        expect(allowed.status).toBe(200)
        // HWP 편집 플래그가 켜져 있으면 편집 화면 머리줄에, 꺼져 있으면 "편집할 수 없는 형식" 안내가 뜬다 —
        // 어느 쪽이든 권한 판정(listFileVersions — 읽기·편집 권한)을 지난 뒤의 화면이다
        const header = allowed.page.getByRole('heading', { name: /authz-e2e 비공개 감사의견\.hwp/ })
        const denial = allowed.page.getByTestId('board-work-edit-denied')
        await expect(header.or(denial)).toBeVisible({ timeout: 20000 })
        if (await denial.isVisible()) {
          await expect(denial).toContainText('형식')
        }
      } else {
        expect(allowed.status, '편집기 출처 env 가 없으면 기능을 숨긴다').toBe(404)
      }
    } finally {
      await denied.context.close()
      await allowed.context.close()
    }
  })

  test('편집 화면: DM 의 DOCX 는 관리자도 404, 당사자인 감사는 연다', async ({ browser }) => {
    const f = readFixtures()
    const path = `/board-room/edit/${f.workDmDocxAttachmentId}`
    const admin = await openPage(browser, 'admin', path)
    const auditor = await openPage(browser, 'auditor', path)
    try {
      expect(admin.status).toBe(404)
      await expect(admin.page.getByText('authz-e2e DM 초안.docx')).toHaveCount(0)
      if (editorOn) {
        expect(auditor.status).toBe(200)
        await expect(
          auditor.page.getByRole('heading', { name: /authz-e2e DM 초안\.docx/ })
        ).toBeVisible({ timeout: 20000 })
      } else {
        expect(auditor.status).toBe(404)
      }
    } finally {
      await admin.context.close()
      await auditor.context.close()
    }
  })

  test('편집 화면·새 문서: 일반 조합원은 /board 로 돌아간다(같은 주소를 감사는 연다)', async ({
    browser,
  }) => {
    const f = readFixtures()
    for (const path of [
      `/board-room/edit/${f.workPrivateHwpAttachmentId}`,
      `/board-room/edit/new?channel=${f.workPrivateChannelId}&type=docx&name=x`,
    ]) {
      const member = await openPage(browser, 'other', path)
      try {
        await expect(member.page, path).toHaveURL(/\/board$/, { timeout: 15000 })
      } finally {
        await member.context.close()
      }
    }
    // 새 문서: 비공개 채널에 이사(비멤버)는 404, owner인 감사는 편집 화면(env 있을 때)
    const newDoc = `/board-room/edit/new?channel=${f.workPrivateChannelId}&type=docx&name=authz-e2e%20새%20문서`
    const director = await openPage(browser, 'director', newDoc)
    const auditor = await openPage(browser, 'auditor', newDoc)
    try {
      expect(director.status).toBe(404)
      expect(auditor.status).toBe(editorOn ? 200 : 404)
      if (editorOn) {
        await expect(
          auditor.page.getByRole('heading', { name: /authz-e2e 새 문서\.docx/ })
        ).toBeVisible({ timeout: 20000 })
      }
    } finally {
      await director.context.close()
      await auditor.context.close()
    }
  })

  test('문서 편집 라우트(form·blocks·draft): 이사는 404, 감사는 권한을 지난다 — 관리자는 남의 DM 파일에 404', async ({
    browser,
  }) => {
    const f = readFixtures()
    const base = `/api/board-room/work/files/${f.workPrivateHwpAttachmentId}`
    for (const sub of ['form', 'blocks']) {
      const denied = await getAs(browser, 'director', `${base}/${sub}`)
      expect(denied.status, `이사 ${sub}`).toBe(404)
      expect(denied.body).toContain(NOT_FOUND_MESSAGE)
      const allowed = await getAs(browser, 'auditor', `${base}/${sub}`)
      expect(allowed.status, `감사 ${sub} → ${allowed.body}`).toBe(503)
      expect(allowed.body).toContain('원본 파일을 읽지 못했습니다')
      // 관리자는 비공개 채널을 읽지만(0037) 멤버가 아니라 편집 권한이 없다 → 403
      const admin = await getAs(browser, 'admin', `${base}/${sub}`)
      expect(admin.status, `관리자 ${sub}`).toBe(403)
    }
    // 초안: 권한을 지나면 본문 검사(JSON 스키마)에서 400
    const draftDenied = await postAs(browser, 'director', `${base}/draft`, { mode: 'nope' })
    expect(draftDenied.status).toBe(404)
    const draftAllowed = await postAs(browser, 'auditor', `${base}/draft`, { mode: 'nope' })
    expect(draftAllowed.status, draftAllowed.body).toBe(400)

    // DM 의 DOCX: 관리자는 404(DM 은 멤버만), 당사자 이사는 권한을 지나 형식 검사에서 415(HWP·HWPX 만)
    const dmBase = `/api/board-room/work/files/${f.workDmDocxAttachmentId}`
    expect((await getAs(browser, 'admin', `${dmBase}/form`)).status).toBe(404)
    expect((await getAs(browser, 'director', `${dmBase}/form`)).status).toBe(415)
  })

  test('저장본 검증·초안 미리보기(drafts/<uploadId>/…·new-drafts/…): 이사는 404, 감사는 자기 임시 업로드까지 간다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const base = `/api/board-room/work/files/${f.workPrivateHwpAttachmentId}`
    const pending = f.workAuditorPendingId
    const verify = `${base}/drafts/${pending}/verify`
    const denied = await postAs(browser, 'director', verify, {})
    expect(denied.status).toBe(404)
    expect(denied.body).toContain(NOT_FOUND_MESSAGE)
    // 감사: 원본 읽기·편집 권한을 지나 내 임시 업로드(같은 채널)를 찾고, 그 객체가 없어 저장본 문구의 404
    const allowed = await postAs(browser, 'auditor', verify, {})
    expect(allowed.status, allowed.body).toBe(404)
    expect(allowed.body).toContain('저장본')

    // 남의 임시 업로드는 감사에게도 없는 것(이사가 공개 채널에 준비한 것)
    const theirs = await postAs(
      browser,
      'auditor',
      `${base}/drafts/${f.workDirectorPendingId}/verify`,
      {}
    )
    expect(theirs.status).toBe(404)
    expect(theirs.body).not.toContain('저장본')

    // 초안 미리보기: 내 초안이 아니면 404(초안 메타가 없는 임시 업로드도 초안이 아니다)
    for (const role of ['director', 'auditor']) {
      const r = await getAs(browser, role, `${base}/drafts/${pending}/render?view=layout`)
      expect(r.status, role).toBe(404)
    }

    // 새 문서 저장본 검증: 이사는 남의 임시 업로드라 404, 감사는 만들기 권한(비공개 채널 owner)을 지나 저장본 문구의 404
    const newVerify = `/api/board-room/work/files/new-drafts/${pending}/verify`
    const nd = await postAs(browser, 'director', newVerify, {})
    expect(nd.status).toBe(404)
    expect(nd.body).not.toContain('저장본')
    const na = await postAs(browser, 'auditor', newVerify, {})
    expect(na.status, na.body).toBe(404)
    expect(na.body).toContain('저장본')
  })

  test('문서 편집 라우트: 일반 조합원은 403, 비로그인은 401', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const f = readFixtures()
    const base = `/api/board-room/work/files/${f.workPrivateHwpAttachmentId}`
    expect((await getAs(browser, 'other', `${base}/form`)).status).toBe(403)
    expect((await postAs(browser, 'other', `${base}/draft`, {})).status).toBe(403)
    expect(
      (
        await postAs(
          browser,
          'other',
          `/api/board-room/work/files/new-drafts/${f.workAuditorPendingId}/verify`,
          {}
        )
      ).status
    ).toBe(403)
    const anon = await playwright.request.newContext({ baseURL })
    try {
      expect((await anon.get(`${base}/blocks`, { maxRedirects: 0 })).status()).toBe(401)
    } finally {
      await anon.dispose()
    }
  })
})

/**
 * 전체 검색(4단계, 설계 §8-3) — 원본은 RLS가 검색 RPC 결과를 걸렀다. 여기서는 `searchAll`이 읽기 범위를 모든 쿼리의
 * WHERE에 넣는다. 시드는 공개 채널·비공개 채널(감사 owner)·이사–감사 DM에 같은 낱말(authz-e2e)을 메시지·메모·첨부
 * 이름·첨부 본문(work_attachment_texts)으로 깔아 둔다. 페이지 HTML 전체(RSC 데이터 포함)를 보고 "결과에도 스니펫에도
 * 없다"를 단정하고, 같은 요청에서 허용된 사람은 그 내용을 본다(짝). 하이라이트(<mark>)가 검색어를 잘라 놓으므로
 * 검색어가 아닌 조각으로 찾는다.
 */
async function searchHtml(
  browser: import('@playwright/test').Browser,
  role: string,
  q: string
): Promise<{ status: number; url: string; html: string }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) })
  try {
    const res = await context.request.get(`/board-room/search?q=${encodeURIComponent(q)}`)
    return { status: res.status(), url: res.url(), html: await res.text() }
  } finally {
    await context.close()
  }
}

test.describe('업무툴 전체 검색 — 읽기 경계(/board-room/search)', () => {
  test('이사: 초대받지 않은 비공개 채널의 메시지·파일·문서 본문·메모는 결과·스니펫에 없고, 공개 채널과 자기 DM은 있다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const d = await searchHtml(browser, 'director', 'authz-e2e')
    expect(d.status).toBe(200)
    expect(d.html).toContain('data-testid="board-work-search"')
    // 허용 쪽
    expect(d.html).toContain('공개 채널 글')
    expect(d.html).toContain('이사와 감사의 DM')
    expect(d.html).toContain(f.workPublicFileName.replace('authz-e2e ', ''))
    expect(d.html).toContain('공개문서본문')
    expect(d.html).toContain('디엠문서본문')
    expect(d.html).toContain('DM 메모 본문')
    // 금지 쪽 — 메시지·파일명·문서 본문·메모·채널 id·채널 이름(필터 목록 포함)
    expect(d.html).not.toContain('비공개 채널 글')
    expect(d.html).not.toContain(f.workPrivateFileName.replace('authz-e2e ', ''))
    expect(d.html).not.toContain('비공개문서본문')
    expect(d.html).not.toContain('감사 의견 기밀')
    expect(d.html).not.toContain('비공개 메모 본문')
    expect(d.html).not.toContain(f.workPrivateChannelId)
    expect(d.html).not.toContain('authz-e2e 비공개')

    // 비공개 문서 본문만의 낱말로 찾아도 없다 — 같은 낱말을 owner인 감사는 스니펫과 함께 본다
    const dOnly = await searchHtml(browser, 'director', '비공개문서본문')
    expect(dOnly.html).not.toContain('감사 의견 기밀')
    expect(dOnly.html).toContain('검색 결과가 없습니다')
    const a = await searchHtml(browser, 'auditor', '비공개문서본문')
    expect(a.status).toBe(200)
    expect(a.html).toContain('감사 의견 기밀')
  })

  test('관리자: 비공개 채널은 찾지만(0037) 남의 DM 메시지·첨부 본문·메모는 찾지 못한다 — DM 당사자인 감사는 찾는다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const ad = await searchHtml(browser, 'admin', 'authz-e2e')
    expect(ad.status).toBe(200)
    expect(ad.html).toContain('비공개 채널 글')
    expect(ad.html).toContain('감사 의견 기밀')
    expect(ad.html).not.toContain('이사와 감사의 DM')
    expect(ad.html).not.toContain('디엠문서본문')
    expect(ad.html).not.toContain('이사와 감사만')
    expect(ad.html).not.toContain('DM 메모 본문')
    expect(ad.html).not.toContain(f.workDmChannelId)
    expect(ad.html).not.toContain(f.workDmFileName.replace('authz-e2e ', ''))

    const adOnly = await searchHtml(browser, 'admin', '디엠문서본문')
    expect(adOnly.html).not.toContain('이사와 감사만')
    const au = await searchHtml(browser, 'auditor', '디엠문서본문')
    expect(au.html).toContain('이사와 감사만')
  })

  test('채널을 직접 지정해도(?channel=) 읽을 수 없는 채널은 비어 있다', async ({ browser }) => {
    const f = readFixtures()
    const context = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const res = await context.request.get(
        `/board-room/search?q=authz-e2e&channel=${f.workPrivateChannelId}`
      )
      expect(res.status()).toBe(200)
      const html = await res.text()
      expect(html).not.toContain('비공개 채널 글')
      expect(html).not.toContain('감사 의견 기밀')
      expect(html).toContain('검색 결과가 없습니다')
    } finally {
      await context.close()
    }
  })

  test('채널 파일 탭의 문서 본문 검색: 비공개 채널은 이사에게 404, 감사는 본문 결과를 본다', async ({
    browser,
  }) => {
    const f = readFixtures()
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    const auditorContext = await browser.newContext({ storageState: storageStatePath('auditor') })
    try {
      const path = `/board-room/c/${f.workPrivateChannelSlug}/files?q=${encodeURIComponent('비공개문서본문')}`
      const denied = await directorContext.request.get(path)
      expect(denied.status()).toBe(404)
      expect(await denied.text()).not.toContain('감사 의견 기밀')
      const allowed = await auditorContext.request.get(path)
      expect(allowed.status()).toBe(200)
      const html = await allowed.text()
      expect(html).toContain('문서 내용에서 찾음')
      expect(html).toContain('감사 의견 기밀')
    } finally {
      await directorContext.close()
      await auditorContext.close()
    }
  })

  test('일반 조합원은 /board로 돌아가고, 같은 주소를 이사는 연다', async ({ browser }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const member = await memberContext.newPage()
      await member.goto('/board-room/search?q=authz-e2e', { waitUntil: 'domcontentloaded' })
      await expect(member).toHaveURL(/\/board$/, { timeout: 15000 })
      await expect(member.getByText('공개 채널 글')).toHaveCount(0)

      const director = await directorContext.newPage()
      await director.goto('/board-room/search?q=authz-e2e', { waitUntil: 'domcontentloaded' })
      await expect(director.getByTestId('board-work-search')).toBeVisible({ timeout: 15000 })
      await expect(director.getByText('공개 채널 글').first()).toBeVisible()
    } finally {
      await memberContext.close()
      await directorContext.close()
    }
  })
})

/**
 * 본문 추출 크론(`/api/internal/board-work/extract-texts`) — 세션이 아니라 CRON_SECRET Bearer만 연다.
 * 짝: 비밀이 없거나 틀리면 401, 맞으면 200(실제로 한 바퀴 돈다 — 시드 첨부는 Blob 객체가 없어 failed 로 남을 뿐이다).
 */
test.describe('업무툴 본문 추출 크론 — CRON_SECRET', () => {
  test('비밀 없음·틀린 비밀·이사 세션은 401이고, 맞는 비밀이면 200이다', async ({
    browser,
    request,
  }) => {
    const path = '/api/internal/board-work/extract-texts'
    expect((await request.get(path)).status()).toBe(401)
    expect(
      (await request.get(path, { headers: { authorization: 'Bearer wrong-secret' } })).status()
    ).toBe(401)
    expect(
      (
        await request.post(path, {
          headers: { authorization: 'Bearer wrong-secret' },
          data: { ids: [readFixtures().workPrivateAttachmentId] },
        })
      ).status()
    ).toBe(401)
    // 로그인한 이사(관리자 아님)도 세션만으로는 못 연다
    const directorContext = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      expect((await directorContext.request.get(path)).status()).toBe(401)
    } finally {
      await directorContext.close()
    }

    const secret = process.env.E2E_CRON_SECRET
    expect(secret, 'playwright.config.ts 가 E2E_CRON_SECRET 을 심는다').toBeTruthy()
    const ok = await request.get(path, { headers: { authorization: `Bearer ${secret}` } })
    expect(ok.status()).toBe(200)
    const body = (await ok.json()) as { success: boolean; data: { processed: number } }
    expect(body.success).toBe(true)
    expect(typeof body.data.processed).toBe('number')
    // 잘못된 본문은 비밀이 맞아도 400(권한을 지난 뒤의 검증)
    const bad = await request.post(path, {
      headers: { authorization: `Bearer ${secret}` },
      data: { ids: ['not-a-uuid'] },
    })
    expect(bad.status()).toBe(400)
  })
})

/**
 * 5단계 — 웹 푸시 구독 라우트(`/api/board-room/work/push/*`). 원본은 requireStaffRoute + service_role upsert였다.
 * 여기서는 `requireBoardMember()`가 먼저다: 비로그인 401, 일반 조합원 403. 그리고 **남의 endpoint는 409**다 —
 * 그 사람에게 갈 멘션·DM 푸시를 가로채거나 끊지 못하게. 실제 푸시는 나가지 않는다(E2E 서버는 VAPID 키가 비어 있다).
 * endpoint는 허용 목록 호스트(fcm.googleapis.com) 모양의 가짜이고, 이 스펙이 마지막에 지운다.
 */
test.describe('업무툴 웹 푸시 구독 경계(/api/board-room/work/push/*)', () => {
  const PUSH_ROUTES = ['subscribe', 'unsubscribe', 'status'] as const
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }

  async function postAs(
    browser: import('@playwright/test').Browser,
    role: string,
    route: string,
    data: unknown
  ): Promise<{ status: number; body: { data?: { mine?: boolean } } | null }> {
    const context = await browser.newContext({ storageState: storageStatePath(role) })
    try {
      const res = await context.request.post(`/api/board-room/work/push/${route}`, { data })
      const status = res.status()
      return { status, body: status === 200 ? await res.json() : null }
    } finally {
      await context.close()
    }
  }

  test('일반 조합원 403 · 비로그인 401 — 짝: 이사는 같은 요청이 200', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-gate-${crypto.randomUUID()}`
    const anon = await playwright.request.newContext({ baseURL })
    try {
      for (const route of PUSH_ROUTES) {
        const data = route === 'subscribe' ? { endpoint, keys } : { endpoint }
        expect((await postAs(browser, 'other', route, data)).status, `other ${route}`).toBe(403)
        const res = await anon.post(`/api/board-room/work/push/${route}`, {
          data,
          maxRedirects: 0,
        })
        expect(res.status(), `anon ${route}`).toBe(401)
      }
      // 허용 쪽: 관리자가 아닌 이사
      expect((await postAs(browser, 'director', 'subscribe', { endpoint, keys })).status).toBe(200)
      expect((await postAs(browser, 'director', 'status', { endpoint })).body?.data?.mine).toBe(
        true
      )
      expect((await postAs(browser, 'director', 'unsubscribe', { endpoint })).status).toBe(200)
      expect((await postAs(browser, 'director', 'status', { endpoint })).body?.data?.mine).toBe(
        false
      )
    } finally {
      await anon.dispose()
      await postAs(browser, 'director', 'unsubscribe', { endpoint })
    }
  })

  test('다른 사람 endpoint를 등록하면 409, 해지해도 남의 구독은 남는다 — 짝: 주인은 다시 저장 200', async ({
    browser,
  }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-owned-${crypto.randomUUID()}`
    try {
      expect((await postAs(browser, 'director', 'subscribe', { endpoint, keys })).status).toBe(200)
      // 감사가 같은 endpoint를 자기 것으로 등록하려 한다
      expect((await postAs(browser, 'auditor', 'subscribe', { endpoint, keys })).status).toBe(409)
      // 감사에게는 "내 것 아님", 해지 요청은 남의 행을 지우지 않는다
      expect((await postAs(browser, 'auditor', 'status', { endpoint })).body?.data?.mine).toBe(
        false
      )
      expect((await postAs(browser, 'auditor', 'unsubscribe', { endpoint })).status).toBe(200)
      expect((await postAs(browser, 'director', 'status', { endpoint })).body?.data?.mine).toBe(
        true
      )
      // 주인은 같은 endpoint를 다시 저장할 수 있다(하루 두 번 재알림 경로)
      expect((await postAs(browser, 'director', 'subscribe', { endpoint, keys })).status).toBe(200)
    } finally {
      await postAs(browser, 'director', 'unsubscribe', { endpoint })
    }
  })

  test('허용 목록 밖·내부 주소 endpoint는 이사에게도 400', async ({ browser }) => {
    for (const endpoint of [
      'https://127.0.0.1/push',
      'https://evil.example/push',
      'http://fcm.googleapis.com/fcm/send/x',
    ]) {
      expect(
        (await postAs(browser, 'director', 'subscribe', { endpoint, keys })).status,
        endpoint
      ).toBe(400)
    }
  })
})

/**
 * 5단계 — 업무툴 크론(`/api/internal/board-work/*`). Vercel 크론과 같은 `Authorization: Bearer $CRON_SECRET`만 통과한다.
 * E2E 서버의 CRON_SECRET은 로컬 전용 값이다(`e2e/helpers/cron.ts` — `.env.local`의 운영 값을 덮는다).
 * 짝: 맞는 시크릿이면 200(push-cleanup — 90일 넘은 구독만 지우므로 시드에 영향 없음).
 */
test.describe('업무툴 크론 인증(/api/internal/board-work/*)', () => {
  const JOBS = ['mention-digest', 'purge-pending-uploads', 'purge-deleted', 'push-cleanup']

  test('시크릿 없이·틀린 시크릿·이사 세션으로는 401 — 짝: 맞는 시크릿은 200', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const anon = await playwright.request.newContext({ baseURL })
    const director = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      for (const job of JOBS) {
        const path = `/api/internal/board-work/${job}`
        expect((await anon.get(path, { maxRedirects: 0 })).status(), `${job} 없음`).toBe(401)
        expect(
          (
            await anon.get(path, { headers: cronHeaders('wrong-secret'), maxRedirects: 0 })
          ).status(),
          `${job} 틀림`
        ).toBe(401)
        expect(
          (
            await anon.get(path, {
              headers: { Authorization: `Bearer ${E2E_CRON_SECRET}x` },
              maxRedirects: 0,
            })
          ).status(),
          `${job} 접미`
        ).toBe(401)
        expect(
          (await director.request.get(path, { maxRedirects: 0 })).status(),
          `${job} 이사`
        ).toBe(401)
      }
      const ok = await anon.get('/api/internal/board-work/push-cleanup', { headers: cronHeaders() })
      expect(ok.status()).toBe(200)
    } finally {
      await anon.dispose()
      await director.close()
    }
  })
})
