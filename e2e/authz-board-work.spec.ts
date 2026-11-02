import { test, expect } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

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
      await expect(
        directorPage.getByRole('heading', { name: '이사회 업무툴', level: 1 })
      ).toBeVisible({
        timeout: 15000,
      })
      await expect(directorPage.getByTestId('board-work-staff')).toContainText('구성원')
      // 업무툴은 전역 내비·이사회실 메뉴 없이 앱 셸만 그린다(ConditionalLayout·board-room/layout).
      await expect(directorPage.getByRole('navigation', { name: '이사회 메뉴' })).toHaveCount(0)
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
