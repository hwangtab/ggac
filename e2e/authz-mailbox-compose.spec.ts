import { randomUUID } from 'node:crypto'

import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 메일함 "새 메일 작성"·보낸 편지함 권한 경계 E2E.
 *
 * **이 스펙은 실제 메일을 내보내지 않는다.** 수신자는 전부 `@test.local`이고, E2E 서버는
 * `RESEND_API_KEY`를 비워 두며(playwright.config.ts), `sendEmail`은 `@test.local`만 남으면 키를 보기도
 * 전에 건너뛴다. 스위트가 어떤 이유로 `@test.local` 규칙을 잃어도 키가 없어 `config` 오류로 끝난다 —
 * 두 겹이다. 그리고 `test.local` 전용 메일은 `recipient_count=0`으로 저장되어 일일 한도를 먹지 않는다.
 *
 * 첨부 저장(비공개 Blob 쓰기)은 이 스위트가 덮지 못한다 — 운영 비공개 저장소 오염을 피하려고 토큰을 주지
 * 않는다. 첨부는 **검증이 거부하는 경로**(실행 파일)와 **다운로드 라우트의 인가·스코프**만 본다.
 */

// 보낸 편지함의 "답장" 행이 매달릴 받은 메일 — 이 스펙이 직접 심는다. `authz-mailbox.spec.ts`의 픽스처에 기대면
// 빈 DB에서 파일 실행 순서에 따라 FK 오류가 난다(알파벳 순으로 이 파일이 먼저 돈다).
const REPLY_PARENT_EMAIL_ID = '00000000-0000-4000-8000-00000000d0e1'
// 이 스펙이 심는 보낸 메일 픽스처 — 고정 id, ON CONFLICT로 멱등.
const SEEDED_OUTBOUND_ID = '00000000-0000-4000-8000-00000000d001'
const SEEDED_ATTACHMENT_ID = '00000000-0000-4000-8000-00000000d002'
const SEEDED_OUTBOUND_OTHER_ID = '00000000-0000-4000-8000-00000000d003'
const SEEDED_REPLY_ID = '00000000-0000-4000-8000-00000000d004'
const SEEDED_REPLY_SUBJECT = 'MAILBOX-E2E-SEEDED-REPLY'
const SEEDED_SUBJECT = 'MAILBOX-E2E-SEEDED-COMPOSE'

const TEST_TO = 'authz-compose-to@test.local'
const TEST_BCC = 'authz-compose-bcc@test.local'

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function countOutbound(): Promise<number> {
  const client = db()
  try {
    const r = await client.execute('SELECT count(*) AS n FROM outbound_emails')
    return Number(r.rows[0].n)
  } finally {
    client.close()
  }
}

async function rowsForKey(key: string) {
  const client = db()
  try {
    const r = await client.execute({
      sql: 'SELECT * FROM outbound_emails WHERE idempotency_key = ?',
      args: [key],
    })
    return r.rows
  } finally {
    client.close()
  }
}

async function seedFixtures(): Promise<void> {
  const client = db()
  try {
    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('outbound_emails','outbound_email_attachments')`
    )
    if (tables.rows.length < 2) {
      throw new Error(
        '보낸 메일 표가 없다. 로컬 Turso에 스키마(마이그레이션 0033)를 먼저 밀어 넣을 것.'
      )
    }
    const now = Date.now()
    for (const [id, key] of [
      [SEEDED_OUTBOUND_ID, 'authz-compose-seeded-key-1'],
      [SEEDED_OUTBOUND_OTHER_ID, 'authz-compose-seeded-key-2'],
    ]) {
      await client.execute({
        sql: `INSERT INTO outbound_emails
          (id, idempotency_key, to_addresses, bcc_addresses, recipient_count, subject, body_html, status, sent_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, '<p>MAILBOX-E2E-SEEDED-BODY</p>', 'sent', ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
        args: [
          id,
          key,
          JSON.stringify([TEST_TO]),
          JSON.stringify([TEST_BCC]),
          SEEDED_SUBJECT,
          now,
          now,
          now,
        ],
      })
    }
    // 첨부 행은 있지만 Blob 객체는 없다 — 다운로드는 인가·스코프까지만 증명한다.
    await client.execute({
      sql: `INSERT INTO outbound_email_attachments (id, email_id, filename, content_type, size_bytes, blob_path)
        VALUES (?, ?, 'seeded.pdf', 'application/pdf', 10, ?) ON CONFLICT(id) DO NOTHING`,
      args: [
        SEEDED_ATTACHMENT_ID,
        SEEDED_OUTBOUND_ID,
        `mailbox-sent/${SEEDED_OUTBOUND_ID}/${SEEDED_ATTACHMENT_ID}.pdf`,
      ],
    })
    await client.execute({
      sql: `INSERT INTO inbound_emails
        (id, resend_email_id, from_address, to_addresses, subject, status, body_fetch_status, received_at)
        VALUES (?, 'authz-compose-reply-parent', 'asker@example.invalid', '["mailbox@ggac.kr"]', 'MAILBOX-E2E-REPLY-PARENT', 'replied', 'done', ?)
        ON CONFLICT(id) DO NOTHING`,
      args: [REPLY_PARENT_EMAIL_ID, now],
    })
    // 보낸 편지함의 "답장" 행.
    await client.execute({
      sql: `INSERT INTO inbound_email_replies (id, email_id, subject, body_html) VALUES (?, ?, ?, '<p>seeded reply</p>')
        ON CONFLICT(id) DO NOTHING`,
      args: [SEEDED_REPLY_ID, REPLY_PARENT_EMAIL_ID, SEEDED_REPLY_SUBJECT],
    })
  } finally {
    client.close()
  }
}

function composeForm(
  overrides: Record<string, string> = {},
  files?: { name: string; mimeType: string; buffer: Buffer }[]
) {
  const form: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    idempotency_key: randomUUID(),
    to: JSON.stringify([TEST_TO]),
    cc: '[]',
    bcc: '[]',
    subject: 'MAILBOX-E2E-COMPOSE',
    body_html: '<p>E2E 본문</p>',
    ...overrides,
  }
  if (files?.length) form.attachments = files[0]
  return form
}

test.beforeAll(async () => {
  await seedFixtures()
})

test.describe('새 메일 작성 API 경계', () => {
  const protectedEndpoints = [
    { label: 'POST 발송', method: 'post' as const, path: '/api/admin/mailbox/outbound' },
    { label: 'GET 보낸 편지함', method: 'get' as const, path: '/api/admin/mailbox/outbound' },
    {
      label: 'GET 상세',
      method: 'get' as const,
      path: `/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_ID}`,
    },
    {
      label: 'GET 첨부 다운로드',
      method: 'get' as const,
      path: `/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_ID}/attachments/${SEEDED_ATTACHMENT_ID}/download`,
    },
  ]

  async function call(ctx: APIRequestContext, ep: (typeof protectedEndpoints)[number]) {
    return ep.method === 'post' ? ctx.post(ep.path, { multipart: composeForm() }) : ctx.get(ep.path)
  }

  test('비로그인은 네 엔드포인트 전부 401이고 행이 생기지 않는다', async ({ request }) => {
    const before = await countOutbound()
    for (const ep of protectedEndpoints) {
      expect((await call(request, ep)).status(), `${ep.label} (비로그인)`).toBe(401)
    }
    expect(await countOutbound()).toBe(before)
  })

  for (const role of ['pending', 'other'] as const) {
    test(`${role}은 네 엔드포인트 전부 403이고 행이 생기지 않는다`, async ({ baseURL }) => {
      const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
      try {
        const before = await countOutbound()
        for (const ep of protectedEndpoints) {
          expect((await call(ctx, ep)).status(), `${ep.label} (${role})`).toBe(403)
        }
        expect(await countOutbound(), `거부됐는데 행이 생겼다 (${role})`).toBe(before)
      } finally {
        await ctx.dispose()
      }
    })
  }

  test('이사(director)는 열람은 되고 발송은 403이며 행이 생기지 않는다', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath('director') })
    try {
      const before = await countOutbound()
      const post = await ctx.post('/api/admin/mailbox/outbound', { multipart: composeForm() })
      expect(post.status()).toBe(403)
      expect(await countOutbound()).toBe(before)

      const list = await ctx.get('/api/admin/mailbox/outbound')
      expect(list.status()).toBe(200)
      const body = await list.json()
      expect(body.data.can_manage).toBe(false)
      expect(body.data.quota, '한도 현황은 관리자에게만 준다').toBeNull()
      expect(Array.isArray(body.data.items)).toBe(true)

      expect((await ctx.get(`/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_ID}`)).status()).toBe(
        200
      )

      // 첨부 다운로드: 인가를 통과해 라우트에 닿는다(Blob 객체가 없어 404). 401/403이면 게이트가 막은 것이다.
      const download = await ctx.get(
        `/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_ID}/attachments/${SEEDED_ATTACHMENT_ID}/download`
      )
      expect(download.status()).toBe(404)
    } finally {
      await ctx.dispose()
    }
  })

  test('첨부 다운로드는 다른 메일의 경로에 넣으면 404다 — 스코프 대조', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath('admin') })
    try {
      const res = await ctx.get(
        `/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_OTHER_ID}/attachments/${SEEDED_ATTACHMENT_ID}/download`
      )
      expect(res.status()).toBe(404)
    } finally {
      await ctx.dispose()
    }
  })
})

test.describe('관리자 발송 (수신자 @test.local)', () => {
  let admin: APIRequestContext
  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
  })
  test.afterAll(async () => {
    await admin.dispose()
  })

  test('발송 성공은 sent로 기록되고 메일은 나가지 않으며 한도에 세지 않는다', async () => {
    const key = randomUUID()
    const res = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key, subject: 'MAILBOX-E2E-SUCCESS' }),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('sent')
    expect(body.data.recorded).toBe(true)

    const rows = await rowsForKey(key)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].resend_message_id, '@test.local은 Resend를 부르지 않는다').toBeNull()
    expect(Number(rows[0].recipient_count), '테스트 수신자는 한도에 세지 않는다').toBe(0)
    expect(rows[0].sent_by).toBeTruthy()
  })

  test('같은 키로 다시 보내면 duplicate이고 행은 하나다 — 중복 클릭 방어', async () => {
    const key = randomUUID()
    const first = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key }),
    })
    expect(first.status()).toBe(200)
    const second = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key, subject: '다른 제목으로 다시' }),
    })
    expect(second.status()).toBe(200)
    expect((await second.json()).data.duplicate).toBe(true)
    const rows = await rowsForKey(key)
    expect(rows).toHaveLength(1)
    expect(rows[0].subject, '두 번째 요청이 내용을 덮어쓰면 안 된다').toBe('MAILBOX-E2E-COMPOSE')
  })

  test('검증에 걸린 요청은 400이고 행을 남기지 않는다', async () => {
    const cases: { label: string; form: Record<string, string> }[] = [
      {
        label: '실주소와 테스트 주소 혼합',
        form: { to: JSON.stringify([TEST_TO, 'real@gmail.com']) },
      },
      { label: '잘못된 주소', form: { to: JSON.stringify(['not-an-address']) } },
      { label: '표시이름 형식', form: { to: JSON.stringify(['Name <a@test.local>']) } },
      { label: '받는 사람 없음', form: { to: '[]' } },
      { label: '제목 없음', form: { subject: '   ' } },
      { label: '본문 없음', form: { body_html: '<p> </p>' } },
      {
        label: '수신자 과다',
        form: { to: JSON.stringify(Array.from({ length: 6 }, (_, i) => `u${i}@test.local`)) },
      },
      { label: '요청 키 없음', form: { idempotency_key: 'not-a-uuid' } },
    ]
    for (const c of cases) {
      const key = c.form.idempotency_key ?? randomUUID()
      const res = await admin.post('/api/admin/mailbox/outbound', {
        multipart: composeForm({ ...c.form, idempotency_key: key }),
      })
      expect(res.status(), c.label).toBe(400)
      expect(await rowsForKey(key), `${c.label}: 400인데 행이 남았다`).toHaveLength(0)
    }
  })

  test('실행 파일 첨부는 400이고 행을 남기지 않는다', async () => {
    const key = randomUUID()
    const res = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key }, [
        { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
      ]),
    })
    expect(res.status()).toBe(400)
    expect(await rowsForKey(key)).toHaveLength(0)
  })

  test('숨은참조 주소는 관리자에게만 보이고 이사에게는 개수만 보인다', async ({ baseURL }) => {
    const key = randomUUID()
    const sent = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key, bcc: JSON.stringify([TEST_BCC]) }),
    })
    expect(sent.status()).toBe(200)
    const id = (await sent.json()).data.id

    const asAdmin = await (await admin.get(`/api/admin/mailbox/outbound/${id}`)).json()
    expect(asAdmin.data.email.bcc_addresses).toEqual([TEST_BCC])
    expect(asAdmin.data.email.bcc_count).toBe(1)
    expect(asAdmin.data.email.idempotency_key, '요청 키는 내려보내지 않는다').toBeUndefined()

    const director = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const asDirector = await (await director.get(`/api/admin/mailbox/outbound/${id}`)).json()
      expect(
        asDirector.data.email.bcc_addresses,
        'BCC 주소가 이사에게 새면 안 된다'
      ).toBeUndefined()
      expect(asDirector.data.email.bcc_count).toBe(1)
      expect(JSON.stringify(asDirector)).not.toContain(TEST_BCC)
    } finally {
      await director.dispose()
    }
  })

  test('첨부 목록은 저장소 경로를 내려보내지 않는다', async () => {
    const detail = await (
      await admin.get(`/api/admin/mailbox/outbound/${SEEDED_OUTBOUND_ID}`)
    ).json()
    expect(detail.data.attachments).toHaveLength(1)
    expect(detail.data.attachments[0].filename).toBe('seeded.pdf')
    expect(JSON.stringify(detail)).not.toContain('mailbox-sent/')
  })

  test('보낸 편지함 목록은 새 메일과 답장을 함께 주고 kind로 거른다', async () => {
    const all = await (await admin.get('/api/admin/mailbox/outbound?limit=100')).json()
    const subjects = all.data.items.map((i: { subject: string }) => i.subject)
    expect(subjects).toContain(SEEDED_SUBJECT)
    expect(subjects).toContain(SEEDED_REPLY_SUBJECT)
    expect(all.data.can_manage).toBe(true)
    expect(all.data.compose_enabled).toBe(true)
    expect(all.data.quota).toMatchObject({ used: expect.any(Number), limit: expect.any(Number) })

    const replies = await (
      await admin.get('/api/admin/mailbox/outbound?kind=reply&limit=100')
    ).json()
    expect(replies.data.items.every((i: { kind: string }) => i.kind === 'reply')).toBe(true)
    const composed = await (
      await admin.get('/api/admin/mailbox/outbound?kind=compose&limit=100')
    ).json()
    expect(composed.data.items.every((i: { kind: string }) => i.kind === 'compose')).toBe(true)
  })

  test('존재하지 않는 id·잘못된 id는 404·400이다', async () => {
    expect((await admin.get(`/api/admin/mailbox/outbound/${randomUUID()}`)).status()).toBe(404)
    expect((await admin.get('/api/admin/mailbox/outbound/not-a-uuid')).status()).toBe(400)
  })
})

test.describe('한도·발송 실패 경로', () => {
  // 실제 주소로 가는 요청이다. E2E 서버는 RESEND_API_KEY가 비어 있어 어떤 경우에도 메일이 나가지 않는다 —
  // 그래도 `.invalid` 도메인(절대 라우팅되지 않는다)을 써서, 서버 설정이 달라져도 실수로 나갈 곳이 없게 한다.
  const REAL_TO = 'authz-nobody@example.invalid'
  const QUOTA_SEED_ID = '00000000-0000-4000-8000-00000000d0f1'
  let admin: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
  })
  test.afterAll(async () => {
    await admin.dispose()
  })

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = db()
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }

  test('키가 없어 발송이 안 되면 failed로 남고 같은 키로는 다시 보낼 수 없다', async () => {
    const key = randomUUID()
    const res = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key, to: JSON.stringify([REAL_TO]) }),
    })
    expect(res.status(), '발송이 실패하면 5xx다').toBeGreaterThanOrEqual(500)
    const rows = await rowsForKey(key)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(Number(rows[0].recipient_count)).toBe(1)
    expect(rows[0].resend_message_id).toBeNull()

    // 같은 키로 다시 보내도 새로 나가지 않는다 — 실패한 키는 재사용할 수 없다.
    const again = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({ idempotency_key: key, to: JSON.stringify([REAL_TO]) }),
    })
    expect(again.status()).toBe(409)
    expect(await rowsForKey(key)).toHaveLength(1)
  })

  test('일일 상한을 넘기면 429이고 blocked로 남으며 발송을 시도하지 않는다', async () => {
    await exec('DELETE FROM outbound_emails WHERE id = ?', [QUOTA_SEED_ID])
    // 상한(기본 20)을 채우는 행 — 이미 나간 메일처럼 센다.
    await exec(
      `INSERT INTO outbound_emails
        (id, idempotency_key, to_addresses, recipient_count, subject, body_html, status, sent_at, created_at, updated_at)
        VALUES (?, 'authz-compose-quota-seed', '["quota@example.invalid"]', 20, 'quota seed', '<p>x</p>', 'sent', ?, ?, ?)`,
      [QUOTA_SEED_ID, Date.now(), Date.now(), Date.now()]
    )
    try {
      const key = randomUUID()
      const res = await admin.post('/api/admin/mailbox/outbound', {
        multipart: composeForm({ idempotency_key: key, to: JSON.stringify([REAL_TO]) }),
      })
      expect(res.status()).toBe(429)
      const rows = await rowsForKey(key)
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('blocked')
      // 발송을 시도했다면 키가 비어 failed로 끝났을 것이다 — blocked는 그 앞에서 멈췄다는 증거다.
      expect(rows[0].error).toContain('일일 상한')

      // 테스트 수신자는 한도에 걸리지 않는다 — E2E가 업무 한도를 막으면 안 된다.
      const testOnly = await admin.post('/api/admin/mailbox/outbound', {
        multipart: composeForm({ idempotency_key: randomUUID() }),
      })
      expect(testOnly.status()).toBe(200)
    } finally {
      // 한도를 채운 행이 다른 실행에 남으면 안 된다.
      await exec('DELETE FROM outbound_emails WHERE id = ?', [QUOTA_SEED_ID])
      await exec(
        `DELETE FROM outbound_emails WHERE to_addresses = '["authz-nobody@example.invalid"]'`
      )
    }
  })
})

test.describe('화면', () => {
  test('관리자는 보낸 편지함 탭과 새 메일 버튼을 보고, 작성해서 보낼 수 있다', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('tab', { name: '보낸 편지함' })).toBeVisible({ timeout: 15000 })
      const composeButton = page.getByRole('button', { name: '새 메일' })
      await expect(composeButton).toBeVisible({ timeout: 15000 })

      await composeButton.click()
      const dialog = page.getByRole('dialog', { name: '새 메일 작성' })
      await expect(dialog).toBeVisible()

      const subject = `MAILBOX-E2E-UI-${Date.now()}`
      await dialog.getByPlaceholder('name@example.com').fill('authz-compose-ui@test.local')
      await dialog.getByPlaceholder('name@example.com').press('Enter')
      await expect(dialog.getByText('authz-compose-ui@test.local')).toBeVisible()
      await dialog.locator('input[type="text"]').nth(1).fill(subject)
      await dialog.getByPlaceholder('내용을 입력하세요.').fill('첫 줄\n둘째 줄')

      // 확인 단계를 건너뛰는 길이 없다 — "다음"을 눌러야 보내기 버튼이 나온다.
      await expect(dialog.getByRole('button', { name: /명에게 보내기/ })).toHaveCount(0)
      await dialog.getByRole('button', { name: '다음' }).click()
      await expect(dialog.getByText('보내기 전에 확인해 주세요')).toBeVisible()
      await expect(dialog.getByText('외부')).toBeVisible()
      await dialog.getByRole('button', { name: '1명에게 보내기' }).click()
      await expect(dialog.getByText('메일을 보냈습니다.')).toBeVisible({ timeout: 15000 })
      await dialog.getByText('닫기', { exact: true }).click()

      await page.getByRole('tab', { name: '보낸 편지함' }).click()
      await expect(page.getByRole('heading', { name: '보낸 편지함' })).toBeVisible()
      const row = page.getByText(subject).first()
      await expect(row).toBeVisible({ timeout: 15000 })
      await row.click()
      await expect(
        page.frameLocator('iframe[title="보낸 메일 본문"]').getByText('둘째 줄')
      ).toBeVisible({ timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })

  test('쓰던 내용이 있으면 바깥을 눌러도 확인 없이 닫히지 않는다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      const dialogs: string[] = []
      let accept = false
      page.on('dialog', d => {
        dialogs.push(d.message())
        void (accept ? d.accept() : d.dismiss())
      })
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '새 메일' }).click({ timeout: 15000 })
      const dialog = page.getByRole('dialog', { name: '새 메일 작성' })
      await dialog.getByPlaceholder('내용을 입력하세요.').fill('쓰던 내용')

      await dialog.getByRole('button', { name: '닫기' }).click()
      expect(dialogs).toHaveLength(1)
      await expect(dialog, '취소하면 모달이 남아 있어야 한다').toBeVisible()
      await expect(dialog.getByPlaceholder('내용을 입력하세요.')).toHaveValue('쓰던 내용')

      accept = true
      await dialog.getByRole('button', { name: '닫기' }).click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('이사는 보낸 편지함 탭은 보지만 새 메일 버튼은 없다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('tab', { name: '보낸 편지함' })).toBeVisible({ timeout: 15000 })
      // 목록 응답(can_manage=false)이 도착한 뒤에도 버튼이 없어야 한다.
      await page.getByRole('tab', { name: '보낸 편지함' }).click()
      await expect(page.getByText(SEEDED_SUBJECT).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByRole('button', { name: '새 메일' })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
