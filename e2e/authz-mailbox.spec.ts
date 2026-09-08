import { test, expect, request as apiRequest } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 관리자 메일함(Task 9~13) 권한 경계 E2E.
 *
 * 이 저장소의 정적 가드는 "이 문자열이 이 파일에 있는가"만 본다 — 도달
 * 가능성·실행 순서·데이터 흐름을 보지 않는다. 적대 감사(2026-08-27)에서
 * 우회 15가지 중 11가지가 가드를 통과했고, E2E만이 관리자 게이트 무력화를
 * 실제로 잡았다. 이 스펙은 앞선 태스크들의 리뷰가 "E2E만 잡을 수 있다"고
 * 명시적으로 넘긴 공백 셋(웹훅 서명 게이트·첨부 다운로드 배선·관리자 화면
 * 시각 검증)을 포함한다.
 *
 * 픽스처는 `scripts/testing/seed-authz-fixtures.mjs`를 건드리지 않고 이
 * 파일 안에서 직접 심는다(고정 id, `ON CONFLICT`로 멱등) — 관리자 계정 등
 * 공유 계정 픽스처는 그 스크립트가 이미 만들어 두므로 여기서는 메일함
 * 표(`inbound_emails`/`inbound_email_attachments`)만 추가한다. 기존
 * 스위트가 이 표를 전혀 건드리지 않으므로 공유 스크립트를 바꿔 회귀를
 * 만들 위험을 지지 않는 편이 안전하다.
 *
 * **첨부 다운로드의 "배선"은 이 스위트가 덮지 못한다.** 실제 Blob 객체를
 * 만들지 않으므로(운영 Blob 오염 방지) `isSafeMailboxAttachmentPath`가
 * 실제로 경로를 거부하는지, 응답 헤더(`content-disposition`·`cache-control`)가
 * 맞는지는 여기서 증명되지 않는다 — 봉쇄 판정이 거부할 때와 첨부를 못
 * 찾을 때가 둘 다 같은 404("첨부를 찾을 수 없습니다")라 응답만으로는
 * 구분되지 않는다. 이 스위트가 증명하는 것은 **인가**(관리자만 그 라우트에
 * 닿는다)뿐이다. 배선 자체는 실제 메일이 오가는 전환 절차(4단계) 검증에서
 * 확인한다.
 */

const EMAIL_PENDING_ID = '00000000-0000-4000-8000-00000000c001'
const EMAIL_DONE_ID = '00000000-0000-4000-8000-00000000c002'
const ATTACHMENT_ID = '00000000-0000-4000-8000-00000000c003'

// 목록/펼침 화면에서 실제로 이 마커를 찾아 "그려졌다"를 확인한다 —
// 요소 존재가 아니라 텍스트 가시성을 본다.
const BODY_MARKER = 'MAILBOX-E2E-BODY-MARKER-9f3c1a'
// 관리자 화면 레이아웃이 긴 제목에 깨지지 않는지 보는 픽스처. truncate 클래스가
// 있어도 DOM에는 전체 문자열이 그대로 들어가므로 getByText로 앞부분을 찾을 수 있다.
const LONG_SUBJECT_PREFIX = 'MAILBOX-E2E-LONG-TITLE-'
const LONG_SUBJECT = LONG_SUBJECT_PREFIX + 'A'.repeat(220)
const PENDING_SUBJECT = 'MAILBOX-E2E-PENDING-BADGE-FIXTURE'

/**
 * 마이그레이션 0020(`src/db/migrations/0020_mailbox.sql`)이 로컬 Turso에
 * 적용되지 않았으면 아래 INSERT들이 "no such table: inbound_emails" 같은
 * raw SQL 에러로 죽고, 그 에러가 `beforeAll`에서 나므로 이 파일의 11개
 * 테스트가 전부 알아보기 힘든 메시지와 함께 한꺼번에 실패한다. 먼저 표
 * 존재를 확인해 원인을 바로 알 수 있는 메시지로 막는다.
 */
async function assertMailboxSchemaApplied(client: ReturnType<typeof createClient>): Promise<void> {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inbound_emails', 'inbound_email_attachments')`,
  })
  if (result.rows.length < 2) {
    throw new Error(
      '메일함 표(inbound_emails/inbound_email_attachments)가 없다. ' +
        '로컬 Turso에 마이그레이션 0020을 먼저 적용할 것 ' +
        '(`src/db/migrations/0020_mailbox.sql`, 절차는 scripts/turso/README.md).'
    )
  }
}

async function seedMailboxFixtures(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    await assertMailboxSchemaApplied(client)
    const now = Date.now()

    const pendingEmail = {
      id: EMAIL_PENDING_ID,
      resend_email_id: 'authz-mailbox-pending-fixture',
      message_id: '<authz-mailbox-pending@fixture.local>',
      from_address: 'sender-pending@example.com',
      to_addresses: JSON.stringify(['mailbox@ggac.kr']),
      subject: PENDING_SUBJECT,
      body_html: null,
      status: 'unread',
      body_fetch_status: 'pending',
      received_at: now - 60_000,
    }
    const doneEmail = {
      id: EMAIL_DONE_ID,
      resend_email_id: 'authz-mailbox-done-fixture',
      message_id: '<authz-mailbox-done@fixture.local>',
      from_address: 'sender-done@example.com',
      to_addresses: JSON.stringify(['mailbox@ggac.kr']),
      subject: LONG_SUBJECT,
      body_html: `<p>${BODY_MARKER}</p>`,
      status: 'unread',
      body_fetch_status: 'done',
      received_at: now - 30_000,
    }

    for (const email of [pendingEmail, doneEmail]) {
      await client.execute({
        sql: `INSERT INTO inbound_emails
                (id, resend_email_id, message_id, from_address, to_addresses,
                 subject, body_html, status, body_fetch_status, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                resend_email_id = excluded.resend_email_id,
                message_id = excluded.message_id,
                from_address = excluded.from_address,
                to_addresses = excluded.to_addresses,
                subject = excluded.subject,
                body_html = excluded.body_html,
                status = excluded.status,
                body_fetch_status = excluded.body_fetch_status,
                received_at = excluded.received_at`,
        args: [
          email.id,
          email.resend_email_id,
          email.message_id,
          email.from_address,
          email.to_addresses,
          email.subject,
          email.body_html,
          email.status,
          email.body_fetch_status,
          email.received_at,
        ],
      })
    }

    // 첨부의 blob_path는 형식상 안전하지만(mailbox/<emailId>/<attachmentId>.pdf)
    // 실제 Blob 객체는 없다 — 운영 Blob에 파일을 만들지 않기 위해서다. 그래서
    // 다운로드 성공 경로(헤더 단언)까지는 못 가고, 인가 경로만 검증한다
    // (아래 '첨부 다운로드' 스위트의 주석 참고).
    const blobPath = `mailbox/${EMAIL_DONE_ID}/${ATTACHMENT_ID}.pdf`
    await client.execute({
      sql: `INSERT INTO inbound_email_attachments
              (id, email_id, filename, content_type, size_bytes, blob_path)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              email_id = excluded.email_id,
              filename = excluded.filename,
              content_type = excluded.content_type,
              size_bytes = excluded.size_bytes,
              blob_path = excluded.blob_path`,
      args: [ATTACHMENT_ID, EMAIL_DONE_ID, '픽스처-첨부.pdf', 'application/pdf', 1234, blobPath],
    })
  } finally {
    client.close()
  }
}

test.beforeAll(async () => {
  await seedMailboxFixtures()
})

/** PATCH 403 뒤 실제로 행이 안 바뀌었는지 읽는다 — 상태 코드만으로는
 * "거부하면서 쓰기는 이미 해버리는" 모양을 구분할 수 없다
 * (`authz-roles.spec.ts` 파일 상단 규칙과 동일). */
async function readEmailStatus(id: string): Promise<string | null> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: 'SELECT status FROM inbound_emails WHERE id = ?',
      args: [id],
    })
    return (res.rows[0]?.status as string) ?? null
  } finally {
    client.close()
  }
}

/**
 * 역할별 API 경계. 브리프가 요구하는 표: 4역할(비로그인/승인 대기/일반 승인
 * 회원/이사) × 5엔드포인트가 전부 401 또는 403이어야 한다.
 *
 * `pending`·`other`·`director` 세 storageState는 인증은 됐지만
 * `isApprovedActiveAdmin()`을 통과하지 못해 403이다(관리자 게이트는 승인
 * 여부가 아니라 `is_admin` 자체를 본다 — pending도 예외가 아니다). 비로그인은
 * `request` 기본 픽스처를 그대로 쓴다 — 이 프로젝트(`authz`)는 전역
 * storageState를 쓰지 않으므로 익명이다(`authz-boundaries.spec.ts`와 같은
 * 전제).
 */
test.describe('관리자 메일함 API 경계', () => {
  const DENIED_ROLES = ['pending', 'other', 'director'] as const

  const endpoints: Array<{
    label: string
    method: 'get' | 'patch' | 'post'
    path: string
    data?: Record<string, unknown>
  }> = [
    { label: 'GET 목록', method: 'get', path: '/api/admin/mailbox' },
    { label: 'GET 상세', method: 'get', path: `/api/admin/mailbox/${EMAIL_DONE_ID}` },
    {
      label: 'PATCH 상태변경',
      method: 'patch',
      path: `/api/admin/mailbox/${EMAIL_DONE_ID}`,
      data: { status: 'read', expected_status: 'unread' },
    },
    {
      label: 'POST 답장',
      // 관리자로도 이 엔드포인트는 절대 성공시키지 않는다 — 실제로 메일이
      // 나간다. 여기서는 비관리자가 막히는지만 본다.
      method: 'post',
      path: `/api/admin/mailbox/${EMAIL_DONE_ID}/reply`,
      data: { body_html: '<p>테스트 답장 — 절대 나가면 안 된다</p>' },
    },
    {
      label: 'GET 첨부 다운로드',
      method: 'get',
      path: `/api/admin/mailbox/attachments/${ATTACHMENT_ID}/download`,
    },
  ]

  test('비로그인은 다섯 엔드포인트 전부 401이다', async ({ request }) => {
    for (const ep of endpoints) {
      const res = await request[ep.method](ep.path, ep.data ? { data: ep.data } : undefined)
      expect(res.status(), `${ep.label} (비로그인)`).toBe(401)
    }
    // 상태 코드만으로는 부족하다 — PATCH가 401을 돌려주면서 실제로는 상태를
    // 바꿔 버리는 모양을 구분하지 못한다.
    expect(await readEmailStatus(EMAIL_DONE_ID)).toBe('unread')
  })

  for (const role of DENIED_ROLES) {
    test(`${role}은 다섯 엔드포인트 전부 403이다`, async ({ baseURL }) => {
      const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
      try {
        for (const ep of endpoints) {
          const res = await ctx[ep.method](ep.path, ep.data ? { data: ep.data } : undefined)
          expect(res.status(), `${ep.label} (${role})`).toBe(403)
        }
        // 짝: 403을 돌려주면서 PATCH 쓰기는 이미 해버렸을 수도 있다 — 상태
        // 코드만으로는 구분되지 않으므로 행을 직접 읽는다.
        expect(
          await readEmailStatus(EMAIL_DONE_ID),
          `PATCH가 거부됐는데도 상태가 바뀌었다 (${role})`
        ).toBe('unread')
      } finally {
        await ctx.dispose()
      }
    })
  }

  /**
   * 허용 쪽 — 짝 단정. 금지 쪽만 보면 게이트가 "전부 막기"로 퇴화해도(관리자
   * 화면이 통째로 죽어도) 초록불이다. 목록·상세는 defineApiRoute의
   * `auth:'admin'` 경로, 다운로드는 `requireAdmin()`을 직접 부르는 별도
   * 핸들러라 — 둘 다 관리자에게는 통과함을 각각 증명해야 한다.
   *
   * PATCH·POST reply 중 reply는 실제 메일을 내보내므로 관리자로 성공시키지
   * 않는다. PATCH는 아래 별도 테스트에서 관리자 성공 짝을 확인한다.
   */
  test('관리자는 목록·상세·다운로드에서 게이트를 통과한다', async ({ baseURL }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const list = await adminCtx.get('/api/admin/mailbox')
      expect(list.status()).toBe(200)
      const listBody = await list.json()
      expect(listBody.success).toBe(true)
      expect(Array.isArray(listBody.data?.emails)).toBe(true)
      expect(listBody.data.emails.some((e: { id: string }) => e.id === EMAIL_DONE_ID)).toBe(true)

      const detail = await adminCtx.get(`/api/admin/mailbox/${EMAIL_DONE_ID}`)
      expect(detail.status()).toBe(200)
      const detailBody = await detail.json()
      expect(detailBody.success).toBe(true)
      expect(detailBody.data?.email?.id).toBe(EMAIL_DONE_ID)
      expect(Array.isArray(detailBody.data?.attachments)).toBe(true)

      // 다운로드: 실제 Blob 객체가 없어 성공 응답(200 + 헤더)까지는 못 간다
      // (운영 Blob 오염을 피하려고 만들지 않았다 — 파일 상단 주석 참고).
      // 여기서 증명하는 것은 **인가만**이다 — 200(있었다면)과 404(첨부를 못
      // 찾음)만 허용한다. 500은 일부러 배제했다: `requireAdmin()`이 프로필
      // 조회 실패로 던지는 코드도 500이라(`src/lib/server/adminAuth.ts`),
      // 500을 통과시키면 라우트가 통째로 망가져도 이 테스트가 초록불이
      // 된다 — "게이트를 통과한다"는 제목의 테스트가 게이트 실패를 가리게
      // 된다는 뜻이라 배제했다.
      const download = await adminCtx.get(
        `/api/admin/mailbox/attachments/${ATTACHMENT_ID}/download`
      )
      expect([200, 404]).toContain(download.status())
      if (download.status() === 200) {
        // 실제 Blob 객체가 있었다면(로컬 사설 스토어 등) 헤더까지 단언한다.
        // 이번 스위트가 만드는 픽스처로는 이 분기가 실행되지 않는다 — 배선
        // (경로 봉쇄·헤더)은 이 스위트가 덮지 못한다는 파일 상단 주석 참고.
        expect(download.headers()['content-disposition']).toContain('attachment')
        expect(download.headers()['cache-control']).toContain('no-store')
      }
    } finally {
      await adminCtx.dispose()
    }
  })

  /**
   * PATCH의 관리자 성공 짝. 위 403 루프는 "막힌다"만 증명한다 — 관리자만
   * PATCH에서 막히는 회귀(예: 이 라우트에만 잘못된 조건이 추가되는 경우)는
   * 짝이 없으면 잡히지 않는다. 답장 발송과 달리 낙관적 동시성 필드까지
   * 명시해서 보내는 상태 변경은 되돌릴 수 있고, 다음 실행의
   * `seedMailboxFixtures()`가 `ON CONFLICT DO UPDATE`로 다시 'unread'로
   * 되돌린다(고정 픽스처라 안전하다 — 답장처럼 외부로 나가는 부수효과가
   * 없다).
   */
  test('관리자는 PATCH로 상태를 바꿀 수 있다', async ({ baseURL }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const res = await adminCtx.patch(`/api/admin/mailbox/${EMAIL_PENDING_ID}`, {
        data: { status: 'read', expected_status: 'unread' },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data?.status).toBe('read')
      expect(await readEmailStatus(EMAIL_PENDING_ID)).toBe('read')
    } finally {
      await adminCtx.dispose()
    }
  })
})

/**
 * 웹훅 서명 게이트 — 앞선 태스크 리뷰가 "자동 테스트가 하나도 없다"고 남긴
 * 공백. 서명 헤더 없이 치면 401이어야 한다(가장 값싸고 중요한 확인). 실제
 * Resend 서명을 요구하는 "서명이 맞는" 경로는 이 스위트 범위 밖이다.
 */
test.describe('Resend Inbound 웹훅', () => {
  test('서명 헤더 없이 POST하면 401이다', async ({ request }) => {
    const res = await request.post('/api/inbound/resend', {
      data: { type: 'email.received', data: { email_id: 'authz-e2e-should-be-rejected' } },
    })
    expect(res.status()).toBe(401)
  })
})

/**
 * 페이지 레벨 인가(미들웨어). API 경계와 목적은 같지만 게이트가 다르다 —
 * `/admin/mailbox`는 `/admin` 하위라 `src/middleware/auth.ts`의 `/admin` +
 * `!isAdmin` 분기가 유일한 서버측 게이트다(화면 자체는 `'use client'`).
 *
 * 리다이렉트 목적지는 역할마다 다르다(미들웨어 실제 동작, `authz-roles.spec.ts`의
 * 같은 계열 테스트와 동일한 전제):
 *   - 비로그인 → `/login` (보호 페이지 게이트)
 *   - 승인 대기 → `/register/pending` (승인 상태 게이트가 관리자 게이트보다 먼저다)
 *   - 승인된 일반 회원·이사(비관리자) → `/board` (승인은 통과했지만 `is_admin`이 아니다)
 */
test.describe('관리자 메일함 페이지 인가', () => {
  test('비로그인은 /login으로 리다이렉트된다', async ({ browser }) => {
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })

  test('승인 대기 회원은 /register/pending으로 리다이렉트된다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('pending') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/register\/pending$/, { timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })

  for (const role of ['other', 'director'] as const) {
    test(`${role}은 /board로 리다이렉트된다`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: storageStatePath(role) })
      try {
        const page = await ctx.newPage()
        await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/\/board$/, { timeout: 15000 })
      } finally {
        await ctx.close()
      }
    })
  }

  /**
   * 허용 쪽 + 화면 시각 검증 3종. 로컬 미들웨어 제약으로 이제까지 브라우저로
   * 한 번도 확인되지 않았던 화면이다.
   *
   *   1. 관리자가 들어가 목록 행이 실제로 보인다.
   *   2. 행을 펼치면 `iframe[sandbox=""]`이 있고, **그 frame 안에서** 본문
   *      마커 텍스트가 실제로 보인다 — CSP가 srcdoc 프레임을 막으면 이 마커가
   *      안 보이므로, 이것이 CSP 회귀를 잡는 유일한 방법이다.
   *   3. `body_fetch_status='pending'`인 행에 "본문 받는 중" 배지가 보인다.
   *   4. 긴 제목이 페이지에 가로 스크롤을 만들지 않는다.
   */
  test('관리자는 화면에 들어가 메일함을 본다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/admin\/mailbox$/, { timeout: 15000 })
      await expect(page.getByRole('heading', { name: '메일함', level: 1 })).toBeVisible({
        timeout: 15000,
      })

      // 1. 목록 행이 보인다 — 픽스처 두 건을 각각 찾는다.
      const doneRow = page.getByText(LONG_SUBJECT_PREFIX, { exact: false }).first()
      await expect(doneRow).toBeVisible({ timeout: 15000 })
      const pendingRow = page.getByText(PENDING_SUBJECT, { exact: false }).first()
      await expect(pendingRow).toBeVisible()

      // 3. "본문 받는 중" 배지 — pending 행에만 있다.
      const pendingContainer = page.locator('div', { has: pendingRow }).last()
      await expect(pendingContainer.getByText('본문 받는 중')).toBeVisible()

      // 4. 긴 제목이 가로 스크롤을 만들지 않는다.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(2)

      // 2. 행을 펼쳐 iframe 안의 본문 마커를 실제로 본다.
      await doneRow.click()
      const iframeLocator = page.locator('iframe[sandbox=""]')
      await expect(iframeLocator).toBeVisible({ timeout: 15000 })
      const bodyFrame = page.frameLocator('iframe[sandbox=""]')
      await expect(bodyFrame.getByText(BODY_MARKER)).toBeVisible({ timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })
})
