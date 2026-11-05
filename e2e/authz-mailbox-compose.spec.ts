import { randomUUID } from 'node:crypto'

import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, storageStatePath } from './helpers/authState'
import { cronHeaders } from './helpers/cron'
import { expectReachedStorage } from './helpers/storageRoute'

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

/**
 * 이전 실행이 남긴 행을 지운다. E2E DB는 영구 파일이라 매 실행마다 작성 행이 쌓이는데, 심어 둔 픽스처는
 * 첫 실행 시각에 고정돼(ON CONFLICT DO NOTHING) 몇 번 돌리면 목록 첫 페이지(30건) 밖으로 밀려 "목록에 보인다"
 * 단언이 깨진다. 픽스처 id는 남긴다.
 */
async function cleanupPreviousRuns(): Promise<void> {
  const client = db()
  try {
    const keep = [SEEDED_OUTBOUND_ID, SEEDED_OUTBOUND_OTHER_ID]
    const marks = keep.map(() => '?').join(',')
    await client.execute({
      sql: `DELETE FROM outbound_email_attachments WHERE email_id IN
        (SELECT id FROM outbound_emails WHERE subject LIKE 'MAILBOX-E2E-%' AND id NOT IN (${marks}))`,
      args: keep,
    })
    await client.execute({
      sql: `DELETE FROM outbound_emails WHERE subject LIKE 'MAILBOX-E2E-%' AND id NOT IN (${marks})`,
      args: keep,
    })
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
        (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status, body_fetch_status, received_at)
        VALUES (?, ?, 'authz-compose-reply-parent', 'asker@example.invalid', 'asker@example.invalid', '["mailbox@ggac.kr"]', 'MAILBOX-E2E-REPLY-PARENT', 'replied', 'done', ?)
        ON CONFLICT(id) DO NOTHING`,
      args: [REPLY_PARENT_EMAIL_ID, REPLY_PARENT_EMAIL_ID, now],
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
  await cleanupPreviousRuns()
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
      await expectReachedStorage(download, [404])
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
    expect(String(rows[0].sent_by_email), '보낸 사람 이메일은 세션에서 채운다').toContain('@')
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

  test('보낸 편지함 검색은 제목·받는 사람은 찾고 숨은참조는 이사에게도 관리자에게도 찾지 못한다', async ({
    baseURL,
  }) => {
    const tag = `srch${Date.now()}`
    const bcc = `bcc-${tag}@test.local`
    const sent = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({
        idempotency_key: randomUUID(),
        to: JSON.stringify([`to-${tag}@test.local`]),
        bcc: JSON.stringify([bcc]),
        subject: `MAILBOX-E2E-${tag}`,
      }),
    })
    expect(sent.status()).toBe(200)

    const search = async (ctx: APIRequestContext, q: string) => {
      const res = await ctx.get(
        `/api/admin/mailbox/outbound?limit=100&search=${encodeURIComponent(q)}`
      )
      expect(res.status(), q).toBe(200)
      return (await res.json()).data.items as { subject: string }[]
    }

    const director = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      for (const ctx of [admin, director]) {
        expect((await search(ctx, `MAILBOX-E2E-${tag}`)).length).toBe(1)
        expect((await search(ctx, `to-${tag}`)).length).toBe(1)
        // 보안 단언: BCC 주소는 부분이든 전체든 검색되지 않는다 — 찾히면 이사·감사가 BCC를 추측할 수 있다.
        expect(await search(ctx, `bcc-${tag}`), 'BCC 일부').toHaveLength(0)
        expect(await search(ctx, bcc), 'BCC 전체').toHaveLength(0)
      }
      // 와일드카드는 글자일 뿐이다 — `%`만 넣어 전부 나오면 안 된다.
      expect((await search(director, '%')).every(i => /%/.test(i.subject))).toBe(true)
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

test.describe('멈춘 행 확정과 답장 한도', () => {
  const UNKNOWN_ID = '00000000-0000-4000-8000-00000000d0a1'
  const FRESH_SENDING_ID = '00000000-0000-4000-8000-00000000d0a2'
  const OLD_SENDING_ID = '00000000-0000-4000-8000-00000000d0a3'
  const REPLY_QUOTA_SEED_ID = '00000000-0000-4000-8000-00000000d0f2'
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

  async function statusOf(id: string): Promise<string> {
    const r = await exec('SELECT status FROM outbound_emails WHERE id = ?', [id])
    return String(r.rows[0]?.status)
  }

  /** 상태·생성 시각을 지정해 행을 (다시) 심는다. 테스트가 서로의 상태를 바꾸므로 매번 초기화한다. */
  async function plant(id: string, status: string, ageMs: number) {
    const created = Date.now() - ageMs
    await exec('DELETE FROM outbound_emails WHERE id = ?', [id])
    await exec(
      `INSERT INTO outbound_emails
        (id, idempotency_key, to_addresses, recipient_count, subject, body_html, status, created_at, updated_at)
        VALUES (?, ?, '["authz-compose-to@test.local"]', 0, 'MAILBOX-E2E-STUCK', '<p>x</p>', ?, ?, ?)`,
      [id, `authz-stuck-${id}`, status, created, created]
    )
  }

  test('관리자는 unknown을 sent·failed로 확정할 수 있고 한 번 정해지면 다시 못 바꾼다', async () => {
    await plant(UNKNOWN_ID, 'unknown', 60_000)
    const res = await admin.patch(`/api/admin/mailbox/outbound/${UNKNOWN_ID}`, {
      data: { status: 'sent' },
    })
    expect(res.status()).toBe(200)
    expect(await statusOf(UNKNOWN_ID)).toBe('sent')
    // 이미 확정된 행은 바꿀 수 없다 — 두 관리자가 동시에 눌러도 마지막이 이기지 않는다.
    const again = await admin.patch(`/api/admin/mailbox/outbound/${UNKNOWN_ID}`, {
      data: { status: 'failed' },
    })
    expect(again.status()).toBe(409)
    expect(await statusOf(UNKNOWN_ID)).toBe('sent')

    await plant(UNKNOWN_ID, 'unknown', 60_000)
    expect(
      (
        await admin.patch(`/api/admin/mailbox/outbound/${UNKNOWN_ID}`, {
          data: { status: 'failed' },
        })
      ).status()
    ).toBe(200)
    expect(await statusOf(UNKNOWN_ID)).toBe('failed')
  })

  test('방금 만든 sending은 확정할 수 없고, 5분이 지난 sending은 확정할 수 있다', async () => {
    await plant(FRESH_SENDING_ID, 'sending', 5_000)
    const fresh = await admin.patch(`/api/admin/mailbox/outbound/${FRESH_SENDING_ID}`, {
      data: { status: 'failed' },
    })
    expect(fresh.status(), '지금 나가는 중일 수 있다').toBe(409)
    expect(await statusOf(FRESH_SENDING_ID)).toBe('sending')

    await plant(OLD_SENDING_ID, 'sending', 6 * 60_000)
    const old = await admin.patch(`/api/admin/mailbox/outbound/${OLD_SENDING_ID}`, {
      data: { status: 'failed' },
    })
    expect(old.status()).toBe(200)
    expect(await statusOf(OLD_SENDING_ID)).toBe('failed')
  })

  test('잘못된 상태·없는 id·잘못된 id는 400·404이고 행을 바꾸지 않는다', async () => {
    await plant(UNKNOWN_ID, 'unknown', 60_000)
    for (const status of ['unknown', 'sending', 'blocked', 'bogus', '']) {
      const res = await admin.patch(`/api/admin/mailbox/outbound/${UNKNOWN_ID}`, {
        data: { status },
      })
      expect(res.status(), status).toBe(400)
    }
    expect(await statusOf(UNKNOWN_ID)).toBe('unknown')
    expect(
      (
        await admin.patch(`/api/admin/mailbox/outbound/${randomUUID()}`, {
          data: { status: 'sent' },
        })
      ).status()
    ).toBe(404)
    expect(
      (
        await admin.patch('/api/admin/mailbox/outbound/not-a-uuid', { data: { status: 'sent' } })
      ).status()
    ).toBe(400)
  })

  test('비로그인·일반 조합원·이사는 확정할 수 없다', async ({ baseURL, request }) => {
    await plant(UNKNOWN_ID, 'unknown', 60_000)
    const path = `/api/admin/mailbox/outbound/${UNKNOWN_ID}`
    expect((await request.patch(path, { data: { status: 'sent' } })).status()).toBe(401)
    for (const role of ['pending', 'other', 'director'] as const) {
      const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
      try {
        expect((await ctx.patch(path, { data: { status: 'sent' } })).status(), role).toBe(403)
      } finally {
        await ctx.dispose()
      }
    }
    expect(await statusOf(UNKNOWN_ID), '거부됐는데 상태가 바뀌었다').toBe('unknown')
  })

  test('크론은 10분 지난 sending만 unknown으로 옮기고 인증 없이는 거부한다', async ({
    request,
  }) => {
    const STALE_ID = '00000000-0000-4000-8000-00000000d0b1'
    const FRESH_ID = '00000000-0000-4000-8000-00000000d0b2'
    await plant(STALE_ID, 'sending', 30 * 60_000)
    await plant(FRESH_ID, 'sending', 2 * 60_000)
    try {
      expect((await request.post('/api/internal/mailbox/backfill')).status(), '인증 없이').toBe(401)
      expect(await statusOf(STALE_ID)).toBe('sending')

      const res = await request.post('/api/internal/mailbox/backfill', { headers: cronHeaders() })
      expect(res.status()).toBe(200)
      const data = (await res.json()).data
      expect(data.stale_sending_marked_unknown).toBeGreaterThanOrEqual(1)
      // E2E 서버는 운영 배포(VERCEL_ENV=production)가 아니다 — 고아 Blob 정리는 **돌지 않아야** 한다.
      // 이 서버가 운영 비공개 Blob 토큰을 쥐고 있었다면 운영 파일을 로컬 DB와 대조해 지울 수 있었다.
      expect(data.outbound_sweep, 'E2E에서 정리가 돌았다').toBeNull()

      expect(await statusOf(STALE_ID), '오래된 sending → unknown').toBe('unknown')
      // `failed`로 옮기면 안 된다 — 메일이 이미 나갔을 수 있다.
      expect(await statusOf(FRESH_ID), '방금 만든 sending은 그대로').toBe('sending')
    } finally {
      await exec('DELETE FROM outbound_emails WHERE id IN (?, ?)', [STALE_ID, FRESH_ID])
    }
  })

  test('답장도 일일 상한에 걸리면 429이고 발송을 시도하지 않는다', async () => {
    await exec('DELETE FROM outbound_emails WHERE id = ?', [REPLY_QUOTA_SEED_ID])
    await exec(
      `INSERT INTO outbound_emails
        (id, idempotency_key, to_addresses, recipient_count, subject, body_html, status, sent_at, created_at, updated_at)
        VALUES (?, 'authz-compose-reply-quota-seed', '["quota@example.invalid"]', 20, 'quota seed', '<p>x</p>', 'sent', ?, ?, ?)`,
      [REPLY_QUOTA_SEED_ID, Date.now(), Date.now(), Date.now()]
    )
    try {
      const repliesBefore = Number(
        (
          await exec('SELECT count(*) AS n FROM inbound_email_replies WHERE email_id = ?', [
            REPLY_PARENT_EMAIL_ID,
          ])
        ).rows[0].n
      )
      const res = await admin.post(`/api/admin/mailbox/${REPLY_PARENT_EMAIL_ID}/reply`, {
        data: { body_html: '<p>한도 테스트 답장 — 나가면 안 된다</p>' },
      })
      // 한도 검사가 발송보다 앞이다. 검사가 없었다면 발송 단계(키가 비어 있어 500)까지 갔을 것이다.
      expect(res.status()).toBe(429)
      const repliesAfter = Number(
        (
          await exec('SELECT count(*) AS n FROM inbound_email_replies WHERE email_id = ?', [
            REPLY_PARENT_EMAIL_ID,
          ])
        ).rows[0].n
      )
      expect(repliesAfter, '막혔는데 답장 기록이 생겼다').toBe(repliesBefore)
    } finally {
      await exec('DELETE FROM outbound_emails WHERE id = ?', [REPLY_QUOTA_SEED_ID])
    }
  })

  test.afterAll(async () => {
    for (const id of [UNKNOWN_ID, FRESH_SENDING_ID, OLD_SENDING_ID]) {
      await exec('DELETE FROM outbound_emails WHERE id = ?', [id])
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

  test('보낸 편지함에서 검색하면 목록이 걸러진다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByRole('tab', { name: '보낸 편지함' }).click({ timeout: 15000 })
      await expect(page.getByText(SEEDED_SUBJECT).first()).toBeVisible({ timeout: 15000 })

      const box = page.getByRole('textbox', { name: '보낸 메일 검색' })
      await box.fill('존재하지-않는-검색어-zzz')
      await box.press('Enter')
      await expect(page.getByText('검색 결과가 없습니다.')).toBeVisible({ timeout: 15000 })

      await box.fill(SEEDED_SUBJECT)
      await box.press('Enter')
      await expect(page.getByText(SEEDED_SUBJECT).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText('검색 결과가 없습니다.')).toHaveCount(0)
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

/**
 * 답장 품질(PR4) — 받는 사람은 `Reply-To`를, 전체 답장은 원본의 받는 사람·참조를 따르되 우리 주소는 빼고, 원문은
 * 평문만 인용한다. 주소를 전부 `@test.local`로 둬 실제로는 아무것도 나가지 않고(`sendEmail`이 키 확인 전에
 * 건너뛴다), 한도에도 세지 않는다(`recipient_count` 0). 그래서 키 없이 발송 뒤 기록까지 끝까지 탄다.
 */
test.describe('답장 받는 사람·전체 답장·인용', () => {
  // 픽스처를 beforeAll에서 지우고 다시 넣는다 — 워커가 나뉘면 한 워커의 재시드가 다른 워커의 테스트와 겹친다.
  test.describe.configure({ mode: 'serial' })
  const PARENT_ID = '00000000-0000-4000-8000-00000000d0e2'
  const QUOTE_MARKER = 'MAILBOX-E2E-QUOTE <b>원문</b>'
  const OUR_ADDRESS = 'mailbox@ggac.kr'
  let admin: APIRequestContext

  async function exec(sql: string, args: (string | number | null)[] = []) {
    const client = db()
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }

  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    await exec('DELETE FROM inbound_emails WHERE id = ?', [PARENT_ID])
    await exec(
      `INSERT INTO inbound_emails
        (id, thread_id, resend_email_id, message_id, from_address, from_email, to_addresses, cc_addresses,
         received_for, subject, body_text, headers, status, body_fetch_status, received_at)
       VALUES (?, ?, 'authz-reply-quality-parent', '<authz-reply-quality@fixture.local>',
               '문의자 <asker@authz-reply.test.local>', 'asker@authz-reply.test.local', ?, ?, ?,
               'RE: 대관 문의', ?, ?, 'read', 'done', ?)`,
      [
        PARENT_ID,
        PARENT_ID,
        JSON.stringify([OUR_ADDRESS, '동료 <colleague@authz-reply.test.local>']),
        JSON.stringify(['other@authz-reply.test.local', 'asker@authz-reply.test.local']),
        JSON.stringify([OUR_ADDRESS]),
        QUOTE_MARKER,
        JSON.stringify({ 'reply-to': '창구 <helpdesk@authz-reply.test.local>' }),
        Date.now() - 60_000,
      ]
    )
  })

  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [PARENT_ID])
    await admin.dispose()
  })

  test('답장은 Reply-To로 가고 원문 평문을 이스케이프해 인용한다', async () => {
    const res = await admin.post(`/api/admin/mailbox/${PARENT_ID}/reply`, {
      data: { body_html: '<p>답장 본문</p>' },
    })
    expect(res.status()).toBe(200)
    const data = (await res.json()).data
    expect(data.to).toBe('helpdesk@authz-reply.test.local')
    expect(data.cc).toEqual([])
    // 이미 RE:로 시작하면 Re:를 또 붙이지 않는다
    expect(data.subject).toBe('RE: 대관 문의')

    const row = (
      await exec(
        `SELECT to_address, cc_addresses, recipient_count, body_html FROM inbound_email_replies
         WHERE email_id = ? ORDER BY created_at DESC LIMIT 1`,
        [PARENT_ID]
      )
    ).rows[0]
    expect(row.to_address).toBe('helpdesk@authz-reply.test.local')
    expect(row.cc_addresses).toBeNull()
    expect(Number(row.recipient_count)).toBe(0)
    const html = String(row.body_html)
    expect(html).toContain('<blockquote')
    expect(html).toContain('MAILBOX-E2E-QUOTE &lt;b&gt;원문&lt;/b&gt;')
    expect(html).not.toContain('<b>원문</b>')
  })

  test('전체 답장은 원본의 받는 사람·참조를 참조로 넣고 우리 주소·받는 사람은 뺀다', async () => {
    const res = await admin.post(`/api/admin/mailbox/${PARENT_ID}/reply`, {
      data: { body_html: '<p>전체 답장</p>', reply_all: true, include_quote: false },
    })
    expect(res.status()).toBe(200)
    const data = (await res.json()).data
    expect(data.to).toBe('helpdesk@authz-reply.test.local')
    expect(data.cc).toEqual([
      'colleague@authz-reply.test.local',
      'other@authz-reply.test.local',
      'asker@authz-reply.test.local',
    ])
    expect(data.cc).not.toContain(OUR_ADDRESS)

    const row = (
      await exec(
        `SELECT cc_addresses, body_html FROM inbound_email_replies
         WHERE email_id = ? ORDER BY created_at DESC LIMIT 1`,
        [PARENT_ID]
      )
    ).rows[0]
    expect(JSON.parse(String(row.cc_addresses))).toEqual(data.cc)
    expect(String(row.body_html)).not.toContain('<blockquote')

    // 보낸 편지함은 기록한 받는 사람을 보여 주고 참조로도 찾힌다.
    const sent = await admin.get(
      `/api/admin/mailbox/outbound?kind=reply&search=${encodeURIComponent('other@authz-reply')}`
    )
    expect(sent.status()).toBe(200)
    const items = (await sent.json()).data?.items ?? []
    expect(items.some((i: { related_email_id: string }) => i.related_email_id === PARENT_ID)).toBe(
      true
    )
  })

  test('화면의 전체 답장 미리보기는 서버가 보낼 받는 사람과 같다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByText('RE: 대관 문의').first().click()
      await page.getByRole('button', { name: '전체 답장', exact: true }).click()

      const recipients = page.getByTestId('reply-recipients')
      await expect(recipients).toContainText('helpdesk@authz-reply.test.local')
      await expect(recipients).toContainText('(회신 주소)')
      await expect(recipients).toContainText(
        'colleague@authz-reply.test.local, other@authz-reply.test.local, asker@authz-reply.test.local'
      )
      await expect(recipients).not.toContainText(OUR_ADDRESS)
      await expect(page.getByText('원문 인용', { exact: false })).toBeVisible()

      // 전체 답장을 끄면 참조 줄이 사라진다.
      await page.getByLabel(/전체 답장 \(원본의/).uncheck()
      await expect(recipients).not.toContainText('참조:')
    } finally {
      await ctx.close()
    }
  })

  test('이사는 답장·전체 답장을 보낼 수 없다', async ({ playwright, baseURL }) => {
    const director = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const before = Number(
        (
          await exec('SELECT count(*) AS n FROM inbound_email_replies WHERE email_id = ?', [
            PARENT_ID,
          ])
        ).rows[0].n
      )
      const res = await director.post(`/api/admin/mailbox/${PARENT_ID}/reply`, {
        data: { body_html: '<p>x</p>', reply_all: true },
      })
      expect(res.status()).toBe(403)
      const after = Number(
        (
          await exec('SELECT count(*) AS n FROM inbound_email_replies WHERE email_id = ?', [
            PARENT_ID,
          ])
        ).rows[0].n
      )
      expect(after).toBe(before)
    } finally {
      await director.dispose()
    }
  })
})

/**
 * 전달(PR5) — 새 메일 경로에 `forward_of`·`forward_attachment_ids`를 얹는다. 검증(스코프·실행 파일·용량)은 전부
 * `sending` 행보다 앞이라 거부되면 행이 생기지 않는다. E2E 서버에는 비공개 Blob 토큰이 없어 첨부 복사 자체는 못
 * 하므로, 복사 단계의 실패가 "아무것도 안 나가고 행은 failed"로 끝나는지를 본다.
 */
test.describe('전달', () => {
  // 픽스처를 beforeAll에서 지우고 다시 넣는다 — 워커가 나뉘면 한 워커의 재시드가 다른 워커의 테스트와 겹친다.
  test.describe.configure({ mode: 'serial' })
  const SOURCE_ID = '00000000-0000-4000-8000-00000000d0e3'
  const OTHER_ID = '00000000-0000-4000-8000-00000000d0e4'
  const ATT_OK = '00000000-0000-4000-8000-00000000d0c1'
  const ATT_EXE = '00000000-0000-4000-8000-00000000d0c2'
  const ATT_BIG = '00000000-0000-4000-8000-00000000d0c3'
  const ATT_OTHER = '00000000-0000-4000-8000-00000000d0c4'
  let admin: APIRequestContext

  async function exec(sql: string, args: (string | number | null)[] = []) {
    const client = db()
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }

  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    await exec('DELETE FROM inbound_emails WHERE id IN (?, ?)', [SOURCE_ID, OTHER_ID])
    for (const [id, subject] of [
      [SOURCE_ID, '전달할 메일'],
      [OTHER_ID, '다른 메일'],
    ]) {
      await exec(
        `INSERT INTO inbound_emails
          (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, body_text,
           status, body_fetch_status, received_at)
         VALUES (?, ?, ?, 'src@authz-fwd.test.local', 'src@authz-fwd.test.local', '["mailbox@ggac.kr"]',
                 ?, '전달 원문', 'read', 'done', ?)`,
        [id, id, `authz-fwd-${id}`, subject, Date.now() - 60_000]
      )
    }
    const attachments: [string, string, string, number][] = [
      [ATT_OK, SOURCE_ID, 'report.pdf', 1234],
      [ATT_EXE, SOURCE_ID, 'setup.exe', 10],
      [ATT_BIG, SOURCE_ID, 'video.zip', 11_000_000],
      [ATT_OTHER, OTHER_ID, 'secret.pdf', 100],
    ]
    for (const [id, emailId, filename, size] of attachments) {
      await exec(
        `INSERT INTO inbound_email_attachments (id, email_id, filename, content_type, size_bytes, blob_path)
         VALUES (?, ?, ?, 'application/octet-stream', ?, ?)`,
        [id, emailId, filename, size, `mailbox/${emailId}/${id}-${filename}`]
      )
    }
  })

  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id IN (?, ?)', [SOURCE_ID, OTHER_ID])
    await admin.dispose()
  })

  function forwardForm(key: string, ids: string[], forwardOf: string = SOURCE_ID) {
    return composeForm({
      idempotency_key: key,
      subject: 'MAILBOX-E2E-FWD 전달할 메일',
      forward_of: forwardOf,
      forward_attachment_ids: JSON.stringify(ids),
    })
  }

  test('첨부 없는 전달은 나가고, 감사 기록에 어느 메일을 전달했는지 남는다', async () => {
    const key = randomUUID()
    const res = await admin.post('/api/admin/mailbox/outbound', { multipart: forwardForm(key, []) })
    expect(res.status()).toBe(200)
    const [row] = await rowsForKey(key)
    expect(row.status).toBe('sent')
    const activity = (
      await exec(
        `SELECT metadata FROM user_activities WHERE action_type = 'mailbox_email_sent' AND target_id = ?`,
        [String(row.id)]
      )
    ).rows[0]
    const metadata = JSON.parse(String(activity?.metadata ?? '{}'))
    expect(metadata.forward_of).toBe(SOURCE_ID)
    expect(metadata.forwarded_attachment_ids).toEqual([])
  })

  test('다른 메일의 첨부·실행 파일·10MB 초과는 발송 행을 만들기 전에 400이다', async () => {
    for (const [ids, pattern] of [
      [[ATT_OTHER], /이 메일의 것이 아닙니다/],
      [[ATT_OK, ATT_OTHER], /이 메일의 것이 아닙니다/],
      [[ATT_EXE], /전달할 수 없는 파일 형식/],
      [[ATT_BIG], /내려받아 따로 공유/],
    ] as const) {
      const key = randomUUID()
      const res = await admin.post('/api/admin/mailbox/outbound', {
        multipart: forwardForm(key, [...ids]),
      })
      expect(res.status(), ids.join(',')).toBe(400)
      expect((await res.json()).error).toMatch(pattern)
      expect(await rowsForKey(key), '거부됐는데 발송 행이 생겼다').toHaveLength(0)
    }
  })

  test('없는 메일·형식이 틀린 id는 거부한다', async () => {
    const missing = await admin.post('/api/admin/mailbox/outbound', {
      multipart: forwardForm(randomUUID(), [], '00000000-0000-4000-8000-00000000ffff'),
    })
    expect(missing.status()).toBe(404)
    const malformed = await admin.post('/api/admin/mailbox/outbound', {
      multipart: forwardForm(randomUUID(), [], 'not-a-uuid'),
    })
    expect(malformed.status()).toBe(400)
    const badIds = await admin.post('/api/admin/mailbox/outbound', {
      multipart: composeForm({
        subject: 'MAILBOX-E2E-FWD 형식',
        forward_of: SOURCE_ID,
        forward_attachment_ids: '{"a":1}',
      }),
    })
    expect(badIds.status()).toBe(400)
  })

  test('첨부 복사가 실패하면 아무것도 나가지 않고 행은 failed, 첨부 행은 남지 않는다', async () => {
    const key = randomUUID()
    const res = await admin.post('/api/admin/mailbox/outbound', {
      multipart: forwardForm(key, [ATT_OK]),
    })
    // 토큰이 없으면 저장소 단계 500, 시험 토큰이 있으면 객체가 없어 400 — 어느 쪽이든 안 나간다.
    expect([400, 500]).toContain(res.status())
    const [row] = await rowsForKey(key)
    expect(row.status).toBe('failed')
    expect(row.resend_message_id).toBeNull()
    const left = await exec(
      'SELECT count(*) AS n FROM outbound_email_attachments WHERE email_id = ?',
      [String(row.id)]
    )
    expect(Number(left.rows[0].n)).toBe(0)
  })

  test('이사는 전달할 수 없다', async ({ playwright, baseURL }) => {
    const director = await playwright.request.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const key = randomUUID()
      const res = await director.post('/api/admin/mailbox/outbound', {
        multipart: forwardForm(key, [ATT_OK]),
      })
      expect(res.status()).toBe(403)
      expect(await rowsForKey(key)).toHaveLength(0)
    } finally {
      await director.dispose()
    }
  })

  test('화면: 전달 창은 제목·본문을 채우고 원본 첨부를 고르게 하며 10MB 초과를 막는다', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByText('전달할 메일', { exact: true }).first().click()
      await page.getByRole('button', { name: '전달', exact: true }).click()

      await expect(page.getByRole('heading', { name: '메일 전달' })).toBeVisible()
      await expect(page.locator('input[value="Fwd: 전달할 메일"]')).toBeVisible()
      await expect(page.locator('textarea')).toHaveValue(/---------- 전달된 메일 ----------/)
      await expect(page.locator('textarea')).toHaveValue(/전달 원문/)

      const picker = page.getByTestId('forward-attachments')
      await expect(picker.getByLabel(/report\.pdf/)).toBeChecked()
      // 실행 파일은 처음부터 고를 수 없다 — 기본 선택에 들어 있으면 창을 열자마자 오류가 뜬다.
      await expect(picker.getByLabel(/setup\.exe/)).toBeDisabled()
      await expect(picker.getByLabel(/setup\.exe/)).not.toBeChecked()
      await expect(picker).not.toContainText('전달할 수 없는 파일 형식')
      await picker.getByLabel(/video\.zip/).check()
      await expect(picker).toContainText('내려받아 따로 공유')
    } finally {
      await ctx.close()
    }
  })
})
