import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'
import { cronHeaders } from './helpers/cron'
import { expectReachedStorage } from './helpers/storageRoute'

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
 * 확인한다. 같은 이유로 스코프 대조(브리프 B, 메일 A/B 교차 테스트) 역시
 * "라우트에 닿는가"만 증명하고 스코프 검사 자체가 실제로 걸러내는지는
 * 증명하지 못한다 — 해당 테스트 옆 주석 참고.
 *
 * **단계 5(이사·감사 열람 확대) 추가분.** 첨부 다운로드 기록
 * (`user_activities.action_type='attachment_downloaded'`) 테스트는
 * `test.skip`이다 — 기록은 스트리밍 직전에만 남는데 이 스위트는 운영 Blob
 * 오염을 피하려고 실제 Blob 객체를 만들지 않아 다운로드가 늘 404로 끝난다.
 * 그래서 기록이 남는 성공 경로를 이 스위트로는 증명할 수 없다. 감사
 * (is_auditor) 역할의 storageState 픽스처도 `authz.setup.ts`에 없어 별도
 * 검증을 못 한다 — director 검증이 `requireBoardMember()`의 같은 분기를
 * 타므로 사실상 커버한다(아래 '관리자 메일함 API 경계' describe 설명 참고).
 */

const EMAIL_PENDING_ID = '00000000-0000-4000-8000-00000000c001'
const EMAIL_DONE_ID = '00000000-0000-4000-8000-00000000c002'
const ATTACHMENT_ID = '00000000-0000-4000-8000-00000000c003'
// 스코프 대조 픽스처(브리프 B) — 메일 A(EMAIL_DONE_ID)의 첨부를 메일
// B(EMAIL_SCOPE_OTHER_ID)의 경로에 넣으면 404여야 한다.
const EMAIL_SCOPE_OTHER_ID = '00000000-0000-4000-8000-00000000c004'
/** EMAIL_DONE 대화에 이어진 메일 — 대화 묶기(0038). 발신자 필터의 집계를 흔들지 않게 다른 사람이 보냈다. */
const EMAIL_THREAD_FOLLOW_ID = '00000000-0000-4000-8000-00000000c005'
const THREAD_FOLLOW_SUBJECT = 'MAILBOX-E2E-THREAD-FOLLOW-UP'

// 목록/펼침 화면에서 실제로 이 마커를 찾아 "그려졌다"를 확인한다 —
// 요소 존재가 아니라 텍스트 가시성을 본다.
const BODY_MARKER = 'MAILBOX-E2E-BODY-MARKER-9f3c1a'
// 관리자 화면 레이아웃이 긴 제목에 깨지지 않는지 보는 픽스처. truncate 클래스가
// 있어도 DOM에는 전체 문자열이 그대로 들어가므로 getByText로 앞부분을 찾을 수 있다.
const LONG_SUBJECT_PREFIX = 'MAILBOX-E2E-LONG-TITLE-'
const LONG_SUBJECT = LONG_SUBJECT_PREFIX + 'A'.repeat(220)
const PENDING_SUBJECT = 'MAILBOX-E2E-PENDING-BADGE-FIXTURE'
const SENDER_DONE_EMAIL = 'sender-done@example.com'
const SENDER_DONE_NAME = '발신자 필터 픽스처'

/**
 * 마이그레이션 0020(`src/db/migrations/0020_mailbox.sql`)이 로컬 Turso에
 * 적용되지 않았으면 아래 INSERT들이 "no such table: inbound_emails" 같은
 * raw SQL 에러로 죽고, 그 에러가 `beforeAll`에서 나므로 이 파일의 17개
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
  const columns = await client.execute({ sql: `PRAGMA table_info(inbound_emails)` })
  if (!columns.rows.some(row => row.name === 'thread_id')) {
    throw new Error(
      '`inbound_emails.thread_id`가 없다. 로컬 Turso에 마이그레이션 0038을 먼저 적용할 것 ' +
        '(`src/db/migrations/0038_mailbox_threads.sql`, 절차는 scripts/turso/README.md).'
    )
  }
  if (!columns.rows.some(row => row.name === 'from_email')) {
    throw new Error(
      '`inbound_emails.from_email`이 없다. 로컬 Turso에 마이그레이션 0037을 먼저 적용할 것 ' +
        '(`src/db/migrations/0037_mailbox_sender.sql`, 절차는 scripts/turso/README.md).'
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
      from_email: 'sender-pending@example.com',
      from_name: null,
      thread_id: EMAIL_PENDING_ID,
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
      // 표시 이름이 붙은 원문 — 발신자 필터가 원문이 아니라 정규화한 주소(from_email)로 거르는지 본다.
      from_address: `"${SENDER_DONE_NAME}" <${SENDER_DONE_EMAIL.toUpperCase()}>`,
      from_email: SENDER_DONE_EMAIL,
      from_name: SENDER_DONE_NAME,
      thread_id: EMAIL_DONE_ID,
      to_addresses: JSON.stringify(['mailbox@ggac.kr']),
      subject: LONG_SUBJECT,
      body_html: `<p>${BODY_MARKER}</p>`,
      status: 'unread',
      body_fetch_status: 'done',
      received_at: now - 30_000,
    }

    const scopeOtherEmail = {
      id: EMAIL_SCOPE_OTHER_ID,
      resend_email_id: 'authz-mailbox-scope-other-fixture',
      message_id: '<authz-mailbox-scope-other@fixture.local>',
      from_address: 'sender-scope-other@example.com',
      from_email: 'sender-scope-other@example.com',
      from_name: null,
      thread_id: EMAIL_SCOPE_OTHER_ID,
      to_addresses: JSON.stringify(['mailbox@ggac.kr']),
      subject: 'MAILBOX-E2E-SCOPE-OTHER-FIXTURE',
      body_html: null,
      status: 'unread',
      body_fetch_status: 'done',
      received_at: now - 20_000,
    }

    const threadFollowEmail = {
      id: EMAIL_THREAD_FOLLOW_ID,
      resend_email_id: 'authz-mailbox-thread-follow-fixture',
      message_id: '<authz-mailbox-thread-follow@fixture.local>',
      from_address: 'sender-thread@example.com',
      from_email: 'sender-thread@example.com',
      from_name: null,
      thread_id: EMAIL_DONE_ID,
      to_addresses: JSON.stringify(['mailbox@ggac.kr']),
      subject: THREAD_FOLLOW_SUBJECT,
      body_html: null,
      status: 'unread',
      body_fetch_status: 'done',
      received_at: now - 10_000,
    }

    for (const email of [pendingEmail, doneEmail, scopeOtherEmail, threadFollowEmail]) {
      await client.execute({
        sql: `INSERT INTO inbound_emails
                (id, resend_email_id, message_id, from_address, from_email, from_name, thread_id,
                 to_addresses, subject, body_html, status, body_fetch_status, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                resend_email_id = excluded.resend_email_id,
                message_id = excluded.message_id,
                from_address = excluded.from_address,
                from_email = excluded.from_email,
                from_name = excluded.from_name,
                thread_id = excluded.thread_id,
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
          email.from_email,
          email.from_name,
          email.thread_id,
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
 * 역할별 API 경계.
 *
 * 브리프의 새 정책(단계 5 이사·감사 열람 확대): 비로그인은 전부 401,
 * pending·other(일반 조합원)는 전부 403 — 그대로. director(이사)는 목록·
 * 상세·첨부 다운로드가 열리고(`requireBoardMember()`가 이사·감사·관리자를
 * 통과시킨다) PATCH·답장은 여전히 403이다(관리자만). 감사(is_auditor)
 * 역할의 storageState 픽스처는 `authz.setup.ts`에 없어 이 스위트에서
 * 별도로 검증하지 못한다 — `requireBoardMember()`가 이사와 감사를 같은
 * 분기로 통과시키므로(둘 다 `canAccessBoardRoom`) director 검증이
 * 감사 경로도 사실상 커버한다.
 *
 * 비로그인은 `request` 기본 픽스처를 그대로 쓴다 — 이 프로젝트(`authz`)는
 * 전역 storageState를 쓰지 않으므로 익명이다(`authz-boundaries.spec.ts`와
 * 같은 전제).
 */
test.describe('관리자 메일함 API 경계', () => {
  const DENIED_ROLES = ['pending', 'other'] as const

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
      path: `/api/admin/mailbox/${EMAIL_DONE_ID}/attachments/${ATTACHMENT_ID}/download`,
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
      // director 쪽은 false만 단언돼 있었다 — can_manage가 "항상 false"로
      // 퇴화해도 그 테스트만으로는 안 잡힌다. 관리자 쪽에 true 단언을 더한다.
      expect(listBody.data?.can_manage).toBe(true)

      const detail = await adminCtx.get(`/api/admin/mailbox/${EMAIL_DONE_ID}`)
      expect(detail.status()).toBe(200)
      const detailBody = await detail.json()
      expect(detailBody.success).toBe(true)
      expect(detailBody.data?.email?.id).toBe(EMAIL_DONE_ID)
      expect(Array.isArray(detailBody.data?.attachments)).toBe(true)
      expect(detailBody.data?.can_manage).toBe(true)

      // 다운로드: 실제 Blob 객체가 없어 성공 응답(200 + 헤더)까지는 못 간다
      // (운영 Blob 오염을 피하려고 만들지 않았다 — 파일 상단 주석 참고).
      // 여기서 증명하는 것은 **인가만**이다 — 200(있었다면)과 404(첨부를 못
      // 찾음)만 허용한다. 500은 일부러 배제했다: `requireAdmin()`이 프로필
      // 조회 실패로 던지는 코드도 500이라(`src/lib/server/adminAuth.ts`),
      // 500을 통과시키면 라우트가 통째로 망가져도 이 테스트가 초록불이
      // 된다 — "게이트를 통과한다"는 제목의 테스트가 게이트 실패를 가리게
      // 된다는 뜻이라 배제했다.
      const download = await adminCtx.get(
        `/api/admin/mailbox/${EMAIL_DONE_ID}/attachments/${ATTACHMENT_ID}/download`
      )
      await expectReachedStorage(download)
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
   * 이사(director)는 목록·상세·첨부 다운로드를 열람하지만 답장·상태 변경은
   * 여전히 관리자만 — 단계 5 브리프의 핵심 정책. `requireBoardMember()`가
   * 이사·감사·관리자를 통과시키되 `isAdmin`은 `isApprovedActiveAdmin()`에서만
   * true가 되므로, PATCH·reply 라우트(auth: 'admin' 그대로)는 이사에게 여전히
   * 403이다.
   */
  test('director는 목록·상세·다운로드를 보되 PATCH·답장은 403이다', async ({ baseURL }) => {
    const directorCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const list = await directorCtx.get('/api/admin/mailbox')
      expect(list.status()).toBe(200)
      const listBody = await list.json()
      expect(listBody.success).toBe(true)
      expect(listBody.data?.can_manage).toBe(false)

      const detail = await directorCtx.get(`/api/admin/mailbox/${EMAIL_DONE_ID}`)
      expect(detail.status()).toBe(200)
      const detailBody = await detail.json()
      expect(detailBody.success).toBe(true)
      expect(detailBody.data?.can_manage).toBe(false)

      // 다운로드: 관리자 테스트와 같은 이유로 200 또는 404만 허용한다(Blob 없음).
      const download = await directorCtx.get(
        `/api/admin/mailbox/${EMAIL_DONE_ID}/attachments/${ATTACHMENT_ID}/download`
      )
      await expectReachedStorage(download)

      const patch = await directorCtx.patch(`/api/admin/mailbox/${EMAIL_DONE_ID}`, {
        data: { status: 'read', expected_status: 'unread' },
      })
      expect(patch.status()).toBe(403)
      expect(await readEmailStatus(EMAIL_DONE_ID)).toBe('unread')

      const reply = await directorCtx.post(`/api/admin/mailbox/${EMAIL_DONE_ID}/reply`, {
        data: { body_html: '<p>이사는 답장을 보낼 수 없어야 한다</p>' },
      })
      expect(reply.status()).toBe(403)
    } finally {
      await directorCtx.dispose()
    }
  })

  /**
   * 발신자 필터(0037). 이사도 쓰는 읽기 기능이라 director로 본다. 원문은 대문자·표시 이름이 붙어 있지만
   * 필터는 정규화한 주소로 완전 일치해야 하고, 앞쪽이 같은 다른 주소(`er-done@…`)는 걸리지 않아야 한다.
   */
  test('발신자·도메인 필터는 정규화한 주소로 거르고 잘못된 값은 400이다', async ({ baseURL }) => {
    const directorCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const idsOf = async (query: string) => {
        const res = await directorCtx.get(`/api/admin/mailbox?limit=100&${query}`)
        expect(res.status()).toBe(200)
        const body = await res.json()
        return (body.data?.emails ?? []).map((e: { id: string }) => e.id) as string[]
      }

      const byName = await idsOf(
        `from=${encodeURIComponent(`${SENDER_DONE_NAME} <${SENDER_DONE_EMAIL.toUpperCase()}>`)}`
      )
      expect(byName).toEqual([EMAIL_DONE_ID])
      expect(await idsOf(`from=${encodeURIComponent('er-done@example.com')}`)).toEqual([])

      const byDomain = await idsOf('domain=%40EXAMPLE.com')
      for (const id of [EMAIL_PENDING_ID, EMAIL_DONE_ID, EMAIL_SCOPE_OTHER_ID]) {
        expect(byDomain).toContain(id)
      }
      expect(await idsOf('domain=ample.com')).not.toContain(EMAIL_DONE_ID)

      expect((await directorCtx.get('/api/admin/mailbox?domain=a%25.org')).status()).toBe(400)
      expect((await directorCtx.get('/api/admin/mailbox?from=%3C%3E')).status()).toBe(400)
    } finally {
      await directorCtx.dispose()
    }
  })

  /**
   * 상세 검색(첨부·기간). 픽스처의 첨부는 `content_id`가 없는 PDF라 "진짜 첨부"로 센다.
   */
  test('첨부·기간 필터가 걸리고 없는 날짜는 400이다', async ({ baseURL }) => {
    const directorCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const res = await directorCtx.get('/api/admin/mailbox?limit=100&has=attachment')
      expect(res.status()).toBe(200)
      const emails = (await res.json()).data?.emails ?? []
      const ids = emails.map((e: { id: string }) => e.id)
      expect(ids).toContain(EMAIL_DONE_ID)
      expect(ids).not.toContain(EMAIL_PENDING_ID)
      expect(emails.find((e: { id: string }) => e.id === EMAIL_DONE_ID)?.attachment_count).toBe(1)

      // 픽스처는 방금 받은 메일이다 — 먼 과거로 끝나는 기간에는 없다.
      const past = await directorCtx.get('/api/admin/mailbox?limit=100&before=2020-01-01')
      expect(past.status()).toBe(200)
      expect(
        ((await past.json()).data?.emails ?? []).map((e: { id: string }) => e.id)
      ).not.toContain(EMAIL_DONE_ID)

      for (const query of [
        'after=2026-02-31',
        'before=2026-1-1',
        'has=image',
        'after=2026-03-02&before=2026-03-01',
      ]) {
        expect((await directorCtx.get(`/api/admin/mailbox?${query}`)).status(), query).toBe(400)
      }
    } finally {
      await directorCtx.dispose()
    }
  })

  /**
   * 발신자 카드의 회원 매칭은 메일함 열람 범위(이사·감사·관리자)에 내려간다(2026-11-05 결정). 명부의
   * 일부이므로 **배지 칸(이름·가입 상태·활성)만** 실려야 한다 — 회원 id·연락처가 섞이면 실패한다.
   */
  test('발신자 카드: 이사·관리자 모두 집계와 배지 칸만 받는다', async ({ baseURL, request }) => {
    const url = `/api/admin/mailbox/sender?email=${encodeURIComponent(SENDER_DONE_EMAIL)}`
    expect((await request.get(url)).status()).toBe(401)

    const otherCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const directorCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      expect((await otherCtx.get(url)).status()).toBe(403)

      const director = await directorCtx.get(url)
      expect(director.status()).toBe(200)
      const directorData = (await director.json()).data
      expect(directorData.sender.email).toBe(SENDER_DONE_EMAIL)
      expect(directorData.sender.name).toBe(SENDER_DONE_NAME)
      expect(directorData.sender.inbound_count).toBeGreaterThanOrEqual(1)
      expect(directorData.member).toBeNull()

      const admin = await adminCtx.get(url)
      expect(admin.status()).toBe(200)
      expect((await admin.json()).data.member).toBeNull()

      // 회원 주소로 물으면 이사도 매칭을 받는다 — 배지 칸 말고는 내려가지 않는다.
      const adminId = readFixtures().users.admin
      const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
      const profile = await client
        .execute({
          sql: 'SELECT email, display_name FROM member_profiles WHERE id = ?',
          args: [adminId],
        })
        .then(res => res.rows[0])
        .finally(() => client.close())
      const memberUrl = `/api/admin/mailbox/sender?email=${encodeURIComponent(String(profile?.email ?? ''))}`
      for (const ctx of [directorCtx, adminCtx]) {
        const member = (await (await ctx.get(memberUrl)).json()).data?.member
        expect(member?.display_name).toBe(String(profile?.display_name))
        expect(Object.keys(member).sort()).toEqual(
          ['display_name', 'is_active', 'registration_status'].sort()
        )
      }

      expect((await directorCtx.get('/api/admin/mailbox/sender?email=%3C%3E')).status()).toBe(400)
    } finally {
      await Promise.all([otherCtx.dispose(), directorCtx.dispose(), adminCtx.dispose()])
    }
  })

  /**
   * 대화 묶기(0038). 상세의 `thread`는 같은 대화의 메일만 머리글로 싣는다 — 다른 대화의 메일이 섞이면 이사가
   * 열어 본 적 없는 메일의 발신자·제목이 엉뚱한 상세에 뜬다. 본문은 싣지 않는다.
   */
  test('상세의 대화 목록은 같은 대화의 메일만, 본문 없이 싣는다', async ({ baseURL }) => {
    const directorCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })
    try {
      const done = (await (await directorCtx.get(`/api/admin/mailbox/${EMAIL_DONE_ID}`)).json())
        .data
      const inboundIds = done.thread
        .filter((item: { kind: string }) => item.kind === 'inbound')
        .map((item: { id: string }) => item.id)
      expect(inboundIds).toEqual([EMAIL_DONE_ID, EMAIL_THREAD_FOLLOW_ID])
      for (const item of done.thread) {
        expect(item).not.toHaveProperty('body_html')
        expect(item).not.toHaveProperty('body_text')
      }

      const other = (
        await (await directorCtx.get(`/api/admin/mailbox/${EMAIL_SCOPE_OTHER_ID}`)).json()
      ).data
      expect(other.thread.map((item: { id: string }) => item.id)).toEqual([EMAIL_SCOPE_OTHER_ID])

      const list = (await (await directorCtx.get('/api/admin/mailbox?limit=100')).json()).data
      const counts = Object.fromEntries(
        list.emails.map((e: { id: string; thread_count: number }) => [e.id, e.thread_count])
      )
      expect(counts[EMAIL_DONE_ID]).toBe(2)
      expect(counts[EMAIL_THREAD_FOLLOW_ID]).toBe(2)
      expect(counts[EMAIL_SCOPE_OTHER_ID]).toBe(1)
    } finally {
      await directorCtx.dispose()
    }
  })

  /**
   * 스코프 대조(브리프 B) — 이번 변경의 핵심 보안 수정. 메일
   * A(EMAIL_DONE_ID)의 첨부 id를 메일 B(EMAIL_SCOPE_OTHER_ID)의 경로에
   * 넣으면, 첨부는 실재하지만 그 메일의 것이 아니므로 404여야 한다. 관리자
   * 권한으로 시도해도 스코프 자체가 막아야 한다 — 인가만 통과하면 다른
   * 메일의 첨부에 닿을 수 있다면 이사·감사로 열람자가 늘어난 지금 실질적인
   * 구멍이 된다.
   *
   * **한계**: 이 스위트는 실제 Blob을 만들지 않으므로(운영 오염 방지)
   * 스코프 거부와 객체 부재가 같은 404다. 스코프 검사(라우트의
   * `attachment.email_id !== emailId` 대조)를 통째로 지워도 이 테스트는
   * 여전히 초록이다 — `getPrivateObject`가 어차피 찾지 못해 404를 주기
   * 때문이다. 스코프 검사 자체가 실제로 걸러내는지는 실제 Blob이 있는
   * 환경(전환 4단계)에서 사람이 확인한다.
   */
  test('메일 A의 첨부 id를 메일 B 경로에 넣으면 404다', async ({ baseURL }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const res = await adminCtx.get(
        `/api/admin/mailbox/${EMAIL_SCOPE_OTHER_ID}/attachments/${ATTACHMENT_ID}/download`
      )
      expect(res.status()).toBe(404)
    } finally {
      await adminCtx.dispose()
    }
  })

  /**
   * 옛 첨부 다운로드 경로(`/api/admin/mailbox/attachments/[id]/download`)는
   * 삭제됐다 — 라우트 파일 자체가 없으므로 Next.js가 404를 준다.
   */
  test('옛 첨부 다운로드 경로는 404다', async ({ baseURL }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const res = await adminCtx.get(`/api/admin/mailbox/attachments/${ATTACHMENT_ID}/download`)
      expect(res.status()).toBe(404)
    } finally {
      await adminCtx.dispose()
    }
  })

  /**
   * 첨부 다운로드 기록(브리프 C) — 이사가 다운로드에 성공하면
   * `user_activities`에 `action_type='attachment_downloaded'` 행이 남아야
   * 한다. 기록은 스트리밍 직전이므로, 실제 Blob 객체가 없어 404가 나는 이
   * 스위트의 픽스처 조건에서는 스트리밍까지 가지 못해 기록도 남지 않는다
   * (`src/app/api/admin/mailbox/[id]/attachments/[attachmentId]/download/route.ts`
   * 참고 — 기록은 `getPrivateObject`가 객체를 돌려준 뒤에 실행된다). 그래서
   * 이 테스트는 실제 Blob이 있어야 검증 가능하고, 운영 Blob을 건드리지
   * 않기 위해 여기서는 만들지 않는다(브리프 E 지시). 스킵하되 이유를 남긴다.
   */
  test.skip('이사가 첨부 다운로드에 성공하면 user_activities에 기록이 남는다 (실제 Blob 필요 — 스킵)', async () => {
    // 실제 Blob 객체가 있는 환경에서만 의미 있는 테스트라 본문은 비워 둔다.
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
   * `/board-room/mailbox`는 `/admin/mailbox`와 다른 게이트를 탄다 —
   * `src/middleware/auth.ts`의 `isBoardRoomRecordPage`가 `/board-room` +
   * `/board-room/meetings`만 조합원에게 열고 `/board-room/mailbox`는
   * 포함하지 않아, 승인된 일반 조합원(`other`)도 이사회 게이트
   * (`isBoardRoom`)에 걸려 `/board`로 리다이렉트된다.
   */
  test('일반 조합원은 /board-room/mailbox에서 /board로 리다이렉트된다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('other') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/board$/, { timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })

  /**
   * 허용 쪽 + 화면 시각 검증 3종. 로컬 미들웨어 제약으로 이제까지 브라우저로
   * 한 번도 확인되지 않았던 화면이다.
   *
   *   1. 관리자가 들어가 목록 행이 실제로 보인다.
   *   2. 행을 펼치면 본문 iframe이 있고, **그 frame 안에서** 본문
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
      // 셀렉터를 `sandbox` 값이 아니라 제목으로 잡는다. 전에는
      // `iframe[sandbox=""]`였는데, 화면이 팝업만 허용하도록 sandbox에 값을
      // 더하면서(`allow-popups allow-popups-to-escape-sandbox`) 이 단정이 조용히
      // 빗나갔다 — 그 뒤로 이 테스트는 늘 빨간불이었고, 아래 CSP 회귀 단정은
      // 한 번도 실행되지 않았다. 제목은 접근성 이름이라 sandbox 플래그가 바뀌어도
      // 따라 흔들리지 않는다.
      const iframeLocator = page.locator('iframe[title="메일 본문"]')
      await expect(iframeLocator).toBeVisible({ timeout: 15000 })
      const bodyFrame = page.frameLocator('iframe[title="메일 본문"]')
      await expect(bodyFrame.getByText(BODY_MARKER)).toBeVisible({ timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })

  /**
   * 이사회 메일함 화면(`/board-room/mailbox`, 브리프 D) — 미들웨어가
   * `/admin`을 관리자에게만 열어서 이사는 위 `/admin/mailbox` 리다이렉트
   * 테스트대로 여전히 들어가지 못한다. 그래서 이사회 영역에 같은 본체를
   * 공유하는 새 경로를 두었다. 여기서는 director가 그 경로에 들어가 목록
   * 행이 실제로 보이는지, 그리고 행을 펼쳤을 때 답장·상태 변경 버튼이
   * 렌더 트리에 아예 없는지(`canManage`가 false면 숨기는 게 아니라 안
   * 그린다 — `MailboxView.tsx`) 확인한다. API의 `can_manage:false`는
   * 별도 테스트로 증명돼 있지만, 화면이 그 값을 실제로 반영해 버튼을
   * 그리지 않는지는 여기서만 증명된다.
   */
  test('director는 /board-room/mailbox에 들어가 메일함 행을 본다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/board-room\/mailbox$/, { timeout: 15000 })

      const doneRow = page.getByText(LONG_SUBJECT_PREFIX, { exact: false }).first()
      await expect(doneRow).toBeVisible({ timeout: 15000 })

      // 행을 펼쳐 답장·상태 변경 버튼이 렌더 트리에 없는지 확인한다.
      await doneRow.click()
      await expect(page.getByRole('button', { name: '답장', exact: true })).toHaveCount(0)
      await expect(page.getByText('상태 변경:')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('상세의 대화 목록에서 같은 대화의 다른 메일로 넘어간다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })

      await page.getByText(LONG_SUBJECT_PREFIX, { exact: false }).first().click()
      const summary = page.getByText('이 대화의 메일 2통')
      await expect(summary).toBeVisible({ timeout: 15000 })
      await summary.click()
      // 목록 행의 보낸 사람 링크에도 같은 주소가 보이므로 대화 목록(<details>) 안으로 좁힌다.
      await summary
        .locator('xpath=..')
        .getByRole('button', { name: /sender-thread@example\.com/ })
        .click()
      await expect(page.getByRole('heading', { name: THREAD_FOLLOW_SUBJECT })).toBeVisible({
        timeout: 15000,
      })
    } finally {
      await ctx.close()
    }
  })

  test('목록에서 보낸 사람을 누르면 그 사람 메일만 남고 칩을 지우면 풀린다', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })

      await page.getByRole('button', { name: SENDER_DONE_NAME, exact: true }).first().click()
      await expect(page).toHaveURL(/[?&]from=sender-done%40example\.com/, { timeout: 15000 })
      await expect(page.getByLabel('보낸 사람 필터 해제')).toBeVisible()
      const card = page.getByTestId('sender-card')
      await expect(card).toContainText(SENDER_DONE_EMAIL)
      await expect(card).toContainText('받은 메일 1통')
      // 이사 화면에도 회원 매칭 줄이 있다(픽스처 발신자는 회원이 아니다).
      await expect(card).toContainText('가입한 회원 주소가 아닙니다')
      await expect(page.getByText(LONG_SUBJECT_PREFIX, { exact: false }).first()).toBeVisible()
      await expect(page.getByText(PENDING_SUBJECT)).toHaveCount(0)

      await page.getByLabel('보낸 사람 필터 해제').click()
      await expect(page).not.toHaveURL(/[?&]from=/)
      await expect(page.getByText(PENDING_SUBJECT).first()).toBeVisible({ timeout: 15000 })
    } finally {
      await ctx.close()
    }
  })
})

/**
 * 일괄 처리 — `PATCH /api/admin/mailbox`. 메일마다 기대 상태를 받아 단건 PATCH와 같은 낙관적 동시성을 지킨다.
 * 다른 테스트의 픽스처 상태를 흔들지 않게 이 묶음만의 메일을 심고, 재시드가 겹치지 않게 직렬로 돈다.
 */
test.describe('메일함 일괄 처리', () => {
  test.describe.configure({ mode: 'serial' })
  const BULK_IDS = [
    '00000000-0000-4000-8000-00000000c010',
    '00000000-0000-4000-8000-00000000c011',
    '00000000-0000-4000-8000-00000000c012',
  ]
  const BULK_SUBJECT = 'MAILBOX-E2E-BULK'

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }

  async function resetBulkFixtures() {
    const now = Date.now()
    for (const [i, id] of BULK_IDS.entries()) {
      await exec(
        `INSERT INTO inbound_emails
          (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
           body_fetch_status, received_at)
         VALUES (?, ?, ?, 'bulk@example.com', 'bulk@example.com', '["mailbox@ggac.kr"]', ?, 'unread', 'done', ?)
         ON CONFLICT(id) DO UPDATE SET status = 'unread', received_at = excluded.received_at`,
        [id, id, `authz-mailbox-bulk-${i}`, `${BULK_SUBJECT}-${i}`, now - i * 1000]
      )
    }
  }

  async function statusOf(id: string): Promise<string> {
    return String(
      (await exec('SELECT status FROM inbound_emails WHERE id = ?', [id])).rows[0]?.status
    )
  }

  test.beforeEach(resetBulkFixtures)
  test.afterAll(async () => {
    await exec(`DELETE FROM inbound_emails WHERE id IN (?, ?, ?)`, BULK_IDS)
  })

  test('관리자는 여러 통을 한 번에 바꾸고, 먼저 바뀐 메일은 conflict로 남는다', async ({
    baseURL,
  }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      // 다른 관리자가 세 번째 메일을 먼저 스팸으로 옮겼다
      await exec(`UPDATE inbound_emails SET status = 'spam' WHERE id = ?`, [BULK_IDS[2]])
      const res = await adminCtx.patch('/api/admin/mailbox', {
        data: {
          status: 'archived',
          items: BULK_IDS.map(id => ({ id, expected_status: 'unread' })),
        },
      })
      expect(res.status()).toBe(200)
      const data = (await res.json()).data
      expect(data.updated).toEqual([BULK_IDS[0], BULK_IDS[1]])
      expect(data.conflict).toEqual([BULK_IDS[2]])
      expect(await statusOf(BULK_IDS[0])).toBe('archived')
      expect(await statusOf(BULK_IDS[2])).toBe('spam')
    } finally {
      await adminCtx.dispose()
    }
  })

  test('잘못된 요청은 아무것도 바꾸지 않고 400이다', async ({ baseURL }) => {
    const adminCtx = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const valid = { id: BULK_IDS[0], expected_status: 'unread' }
      const bad = [
        { status: 'deleted', items: [valid] },
        { status: 'read', items: [] },
        { status: 'read', items: [valid, { id: 'not-a-uuid', expected_status: 'unread' }] },
        { status: 'read', items: [valid, { id: BULK_IDS[1], expected_status: 'nope' }] },
        {
          status: 'read',
          items: Array.from({ length: 101 }, () => valid),
        },
      ]
      for (const data of bad) {
        expect((await adminCtx.patch('/api/admin/mailbox', { data })).status()).toBe(400)
      }
      expect(await statusOf(BULK_IDS[0])).toBe('unread')
    } finally {
      await adminCtx.dispose()
    }
  })

  test('이사·일반 조합원은 일괄 변경이 막히고 행은 그대로다', async ({ baseURL, request }) => {
    const data = { status: 'archived', items: [{ id: BULK_IDS[0], expected_status: 'unread' }] }
    expect((await request.patch('/api/admin/mailbox', { data })).status()).toBe(401)
    for (const role of ['director', 'other']) {
      const ctx = await apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
      try {
        expect((await ctx.patch('/api/admin/mailbox', { data })).status(), role).toBe(403)
      } finally {
        await ctx.dispose()
      }
    }
    expect(await statusOf(BULK_IDS[0])).toBe('unread')
  })

  test('화면: 관리자는 골라서 보관하고, 이사 화면에는 체크박스가 없다', async ({ browser }) => {
    const adminCtx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await adminCtx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByLabel(`${BULK_SUBJECT}-0 선택`).check({ timeout: 15000 })
      await page.getByLabel(`${BULK_SUBJECT}-1 선택`).check()
      const toolbar = page.getByTestId('bulk-toolbar')
      await expect(toolbar).toContainText('2개 선택')
      await toolbar.getByRole('button', { name: '보관', exact: true }).click()
      await expect(toolbar).toContainText('전체 선택')
      await expect.poll(() => statusOf(BULK_IDS[0])).toBe('archived')
      await expect.poll(() => statusOf(BULK_IDS[1])).toBe('archived')
      expect(await statusOf(BULK_IDS[2])).toBe('unread')
    } finally {
      await adminCtx.close()
    }

    const directorCtx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await directorCtx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`${BULK_SUBJECT}-0`).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
      await expect(page.getByLabel(`${BULK_SUBJECT}-0 선택`)).toHaveCount(0)
    } finally {
      await directorCtx.close()
    }
  })
})

/**
 * 내부 메모 — 쓰기는 이사·감사·관리자 전원(2026-11-05 결정), 고치기는 쓴 사람만, 지우기는 쓴 사람과 관리자.
 * 메모가 경로의 메일 것인지도 대조한다(다른 메일의 메모 id를 섞으면 404). 이 묶음만의 메일을 쓰고 직렬로 돈다.
 */
test.describe('메일함 내부 메모', () => {
  test.describe.configure({ mode: 'serial' })
  const NOTE_EMAIL_ID = '00000000-0000-4000-8000-00000000c020'
  const NOTE_SUBJECT = 'MAILBOX-E2E-NOTES'

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }

  async function ctxFor(baseURL: string | undefined, role: string) {
    return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
  }

  test.beforeAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [NOTE_EMAIL_ID])
    await exec(
      `INSERT INTO inbound_emails
        (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
         body_fetch_status, received_at)
       VALUES (?, ?, 'authz-mailbox-notes', 'notes@example.com', 'notes@example.com', '["mailbox@ggac.kr"]',
               ?, 'read', 'done', ?)`,
      [NOTE_EMAIL_ID, NOTE_EMAIL_ID, NOTE_SUBJECT, Date.now()]
    )
  })
  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [NOTE_EMAIL_ID])
  })

  const notesUrl = `/api/admin/mailbox/${NOTE_EMAIL_ID}/notes`

  test('비로그인 401, 일반 조합원·승인 대기는 403이고 메모가 생기지 않는다', async ({
    baseURL,
    request,
  }) => {
    expect((await request.post(notesUrl, { data: { body: 'x' } })).status()).toBe(401)
    for (const role of ['other', 'pending']) {
      const ctx = await ctxFor(baseURL, role)
      try {
        expect((await ctx.post(notesUrl, { data: { body: 'x' } })).status(), role).toBe(403)
      } finally {
        await ctx.dispose()
      }
    }
    const n = await exec('SELECT count(*) AS n FROM inbound_email_notes WHERE email_id = ?', [
      NOTE_EMAIL_ID,
    ])
    expect(Number(n.rows[0].n)).toBe(0)
  })

  test('이사·감사·관리자가 쓰고, 고치기는 쓴 사람만, 지우기는 쓴 사람과 관리자만 된다', async ({
    baseURL,
  }) => {
    const director = await ctxFor(baseURL, 'director')
    const auditor = await ctxFor(baseURL, 'auditor')
    const admin = await ctxFor(baseURL, 'admin')
    try {
      // 쓰기 — 셋 다 된다. 빈 값·2001자는 400.
      const made = await director.post(notesUrl, { data: { body: '  이사 메모  ' } })
      expect(made.status()).toBe(201)
      const directorNote = (await made.json()).data.note
      expect(directorNote.body).toBe('이사 메모')
      const auditorNote = (
        await (await auditor.post(notesUrl, { data: { body: '감사 메모' } })).json()
      ).data.note
      expect((await admin.post(notesUrl, { data: { body: '관리자 메모' } })).status()).toBe(201)
      expect((await director.post(notesUrl, { data: { body: '   ' } })).status()).toBe(400)
      expect((await director.post(notesUrl, { data: { body: 'x'.repeat(2001) } })).status()).toBe(
        400
      )

      // 상세에 쓴 사람 이름과 함께 나온다.
      const detail = (await (await auditor.get(`/api/admin/mailbox/${NOTE_EMAIL_ID}`)).json()).data
      expect(detail.notes.map((n: { body: string }) => n.body)).toEqual([
        '이사 메모',
        '감사 메모',
        '관리자 메모',
      ])
      expect(detail.notes[0].author_name).toBeTruthy()

      const noteUrl = (id: string, emailId = NOTE_EMAIL_ID) =>
        `/api/admin/mailbox/${emailId}/notes/${id}`

      // 고치기 — 쓴 사람만. 관리자도 남의 메모 내용은 못 바꾼다.
      expect(
        (await auditor.patch(noteUrl(directorNote.id), { data: { body: '감사가 고침' } })).status()
      ).toBe(403)
      expect(
        (await admin.patch(noteUrl(directorNote.id), { data: { body: '관리자가 고침' } })).status()
      ).toBe(403)
      const edited = await director.patch(noteUrl(directorNote.id), {
        data: { body: '이사가 고침' },
      })
      expect(edited.status()).toBe(200)
      expect((await edited.json()).data.note.body).toBe('이사가 고침')

      // 다른 메일의 경로에 이 메모 id를 넣으면 404 — 스코프 대조.
      expect(
        (
          await director.patch(noteUrl(directorNote.id, EMAIL_DONE_ID), { data: { body: 'x' } })
        ).status()
      ).toBe(404)
      expect((await admin.delete(noteUrl(directorNote.id, EMAIL_DONE_ID))).status()).toBe(404)

      // 지우기 — 쓴 사람과 관리자. 다른 이사·감사는 못 지운다.
      expect((await auditor.delete(noteUrl(directorNote.id))).status()).toBe(403)
      expect((await director.delete(noteUrl(auditorNote.id))).status()).toBe(403)
      expect((await admin.delete(noteUrl(directorNote.id))).status()).toBe(200)
      expect((await auditor.delete(noteUrl(auditorNote.id))).status()).toBe(200)

      const after = (await (await admin.get(`/api/admin/mailbox/${NOTE_EMAIL_ID}`)).json()).data
      expect(after.notes.map((n: { body: string }) => n.body)).toEqual(['관리자 메모'])
    } finally {
      await Promise.all([director.dispose(), auditor.dispose(), admin.dispose()])
    }
  })

  test('화면: 이사가 메모를 남기면 목록에 메모 수가 보인다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByText(NOTE_SUBJECT, { exact: true }).first().click({ timeout: 15000 })
      const panel = page.getByTestId('mail-notes')
      await panel.locator('summary').click()
      await panel.getByLabel('새 메모').fill('화면에서 남긴 메모 <b>굵게</b>')
      await panel.getByRole('button', { name: '메모 남기기' }).click()
      // 텍스트로 그린다 — 태그가 해석되지 않고 글자로 보인다.
      await expect(panel).toContainText('화면에서 남긴 메모 <b>굵게</b>')
      await expect(panel.locator('b')).toHaveCount(0)
      await expect(panel.getByRole('button', { name: '고치기' })).toHaveCount(1)
      await expect(page.getByText(/^메모 \d+$/).first()).toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})

/**
 * 담당자 지정 — 지정·해제는 관리자만, 후보는 지금 이사·감사·관리자인 사람만. 낙관적 동시성(기대한 담당자). 푸시는
 * E2E 서버에 VAPID 키가 없어 no-op이라 링크(`?mail=<id>`)로 메일이 바로 열리는지만 본다.
 */
test.describe('메일함 담당자', () => {
  test.describe.configure({ mode: 'serial' })
  const ASSIGN_EMAIL_ID = '00000000-0000-4000-8000-00000000c030'
  const ASSIGN_SUBJECT = 'MAILBOX-E2E-ASSIGNEE'
  const assignUrl = `/api/admin/mailbox/${ASSIGN_EMAIL_ID}/assignee`

  async function exec(sql: string, args: (string | number | null)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }
  async function assignedTo(): Promise<string | null> {
    const row = (
      await exec('SELECT assigned_to FROM inbound_emails WHERE id = ?', [ASSIGN_EMAIL_ID])
    ).rows[0]
    return (row?.assigned_to as string | null) ?? null
  }
  async function ctxFor(baseURL: string | undefined, role: string) {
    return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
  }

  test.beforeAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [ASSIGN_EMAIL_ID])
    await exec(
      `INSERT INTO inbound_emails
        (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
         body_fetch_status, received_at)
       VALUES (?, ?, 'authz-mailbox-assignee', 'assign@example.com', 'assign@example.com',
               '["mailbox@ggac.kr"]', ?, 'read', 'done', ?)`,
      [ASSIGN_EMAIL_ID, ASSIGN_EMAIL_ID, ASSIGN_SUBJECT, Date.now()]
    )
  })
  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [ASSIGN_EMAIL_ID])
  })

  test('지정은 관리자만 — 비로그인 401, 이사·일반 조합원 403이고 값이 그대로다', async ({
    baseURL,
    request,
  }) => {
    const users = readFixtures().users
    const data = { assignee_id: users.director, expected_assignee_id: null }
    expect((await request.patch(assignUrl, { data })).status()).toBe(401)
    for (const role of ['director', 'auditor', 'other']) {
      const ctx = await ctxFor(baseURL, role)
      try {
        expect((await ctx.patch(assignUrl, { data })).status(), role).toBe(403)
        expect((await ctx.get('/api/admin/mailbox/assignees')).status(), role).toBe(403)
      } finally {
        await ctx.dispose()
      }
    }
    expect(await assignedTo()).toBeNull()
  })

  test('후보는 지금 이사·감사·관리자뿐이고, 그 밖의 사람은 지정할 수 없다', async ({ baseURL }) => {
    const users = readFixtures().users
    const admin = await ctxFor(baseURL, 'admin')
    try {
      const options = (await (await admin.get('/api/admin/mailbox/assignees')).json()).data
        .assignees as { id: string }[]
      const ids = options.map(o => o.id)
      for (const role of ['admin', 'director', 'auditor'] as const) {
        expect(ids, role).toContain(users[role])
      }
      for (const role of ['other', 'pending'] as const) {
        expect(ids, role).not.toContain(users[role])
      }

      for (const assignee of [users.other, users.pending, 'not-a-uuid']) {
        const res = await admin.patch(assignUrl, {
          data: { assignee_id: assignee, expected_assignee_id: null },
        })
        expect(res.status(), String(assignee)).toBe(400)
      }
      expect(await assignedTo()).toBeNull()
    } finally {
      await admin.dispose()
    }
  })

  test('관리자가 지정하고, 옛 기대값으로 다시 오면 409, "내 담당"은 지정받은 사람에게만 보인다', async ({
    baseURL,
  }) => {
    const users = readFixtures().users
    const admin = await ctxFor(baseURL, 'admin')
    const director = await ctxFor(baseURL, 'director')
    const auditor = await ctxFor(baseURL, 'auditor')
    try {
      const res = await admin.patch(assignUrl, {
        data: { assignee_id: users.director, expected_assignee_id: null },
      })
      expect(res.status()).toBe(200)
      const data = (await res.json()).data
      expect(data.assigned_to).toBe(users.director)
      expect(data.assignee_name).toBeTruthy()

      const stale = await admin.patch(assignUrl, {
        data: { assignee_id: users.auditor, expected_assignee_id: null },
      })
      expect(stale.status()).toBe(409)
      expect(await assignedTo()).toBe(users.director)

      const mineIds = async (ctx: APIRequestContext) =>
        (
          (await (await ctx.get('/api/admin/mailbox?assignee=me&limit=100')).json()).data
            .emails as {
            id: string
          }[]
        ).map(e => e.id)
      expect(await mineIds(director)).toContain(ASSIGN_EMAIL_ID)
      expect(await mineIds(auditor)).not.toContain(ASSIGN_EMAIL_ID)
      expect((await director.get('/api/admin/mailbox?assignee=someone')).status()).toBe(400)

      const detail = (await (await auditor.get(`/api/admin/mailbox/${ASSIGN_EMAIL_ID}`)).json())
        .data.email
      expect(detail.assigned_to).toBe(users.director)
      expect(detail.assignee_name).toBe(data.assignee_name)
    } finally {
      await Promise.all([admin.dispose(), director.dispose(), auditor.dispose()])
    }
  })

  test('화면: 푸시 링크(?mail=)로 들어오면 그 메일이 열리고 주소에서 지워진다, 관리자는 목록에서 담당자를 바꾼다', async ({
    browser,
  }) => {
    const users = readFixtures().users
    const directorCtx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await directorCtx.newPage()
      await page.goto(`/board-room/mailbox?mail=${ASSIGN_EMAIL_ID}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByRole('heading', { name: ASSIGN_SUBJECT })).toBeVisible({
        timeout: 15000,
      })
      await expect(page).not.toHaveURL(/[?&]mail=/)
      await expect(page.getByTestId('mail-assignee')).toContainText('담당:')
      // 이사 화면에는 지정 도구가 없다
      await expect(page.getByLabel('담당자 지정')).toHaveCount(0)
    } finally {
      await directorCtx.close()
    }

    const adminCtx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await adminCtx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByText(ASSIGN_SUBJECT, { exact: true }).first().click({ timeout: 15000 })
      await page.getByLabel('담당자 지정').selectOption(users.auditor)
      await expect.poll(assignedTo).toBe(users.auditor)
    } finally {
      await adminCtx.close()
    }
  })
})

/**
 * 라벨 — 만들기·고치기·지우기·붙이기는 관리자만, 보기·거르기는 이사·감사·관리자. 이 묶음만의 메일과 이름이
 * `MAILBOX-E2E-LABEL-`로 시작하는 라벨을 쓰고, 끝나면 지운다. 직렬로 돈다.
 */
test.describe('메일함 라벨', () => {
  test.describe.configure({ mode: 'serial' })
  const LABEL_EMAIL_IDS = [
    '00000000-0000-4000-8000-00000000c040',
    '00000000-0000-4000-8000-00000000c041',
  ]
  const LABEL_SUBJECT = 'MAILBOX-E2E-LABELED'
  const PREFIX = 'MAILBOX-E2E-LABEL-'

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }
  async function ctxFor(baseURL: string | undefined, role: string) {
    return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
  }
  async function cleanup() {
    await exec(`DELETE FROM mail_labels WHERE name LIKE '${PREFIX}%'`)
    await exec(`DELETE FROM inbound_emails WHERE id IN (?, ?)`, LABEL_EMAIL_IDS)
  }

  test.beforeAll(async () => {
    await cleanup()
    for (const [i, id] of LABEL_EMAIL_IDS.entries()) {
      await exec(
        `INSERT INTO inbound_emails
          (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
           body_fetch_status, received_at)
         VALUES (?, ?, ?, 'labels@example.com', 'labels@example.com', '["mailbox@ggac.kr"]', ?, 'read',
                 'done', ?)`,
        [id, id, `authz-mailbox-label-${i}`, `${LABEL_SUBJECT}-${i}`, Date.now() - i * 1000]
      )
    }
  })
  test.afterAll(cleanup)

  test('보기는 이사·감사·관리자, 쓰기는 관리자만 — 이사·일반 조합원의 쓰기는 403이고 아무것도 안 생긴다', async ({
    baseURL,
    request,
  }) => {
    expect((await request.get('/api/admin/mailbox/labels')).status()).toBe(401)
    const other = await ctxFor(baseURL, 'other')
    const director = await ctxFor(baseURL, 'director')
    const admin = await ctxFor(baseURL, 'admin')
    try {
      expect((await other.get('/api/admin/mailbox/labels')).status()).toBe(403)
      expect((await director.get('/api/admin/mailbox/labels')).status()).toBe(200)

      expect(
        (
          await director.post('/api/admin/mailbox/labels', { data: { name: `${PREFIX}이사` } })
        ).status()
      ).toBe(403)
      const made = await admin.post('/api/admin/mailbox/labels', {
        data: { name: `${PREFIX}권한`, color: 'green' },
      })
      expect(made.status()).toBe(201)
      const labelId = (await made.json()).data.label.id
      for (const [method, url, data] of [
        ['patch', `/api/admin/mailbox/labels/${labelId}`, { name: `${PREFIX}바꿈` }],
        ['delete', `/api/admin/mailbox/labels/${labelId}`, undefined],
        [
          'post',
          `/api/admin/mailbox/labels/${labelId}/emails`,
          { email_ids: [LABEL_EMAIL_IDS[0]], action: 'add' },
        ],
      ] as const) {
        const res = await director[method](url, data ? { data } : undefined)
        expect(res.status(), `${method} ${url}`).toBe(403)
      }
      const left = await exec(`SELECT count(*) AS n FROM mail_labels WHERE name LIKE '${PREFIX}%'`)
      expect(Number(left.rows[0].n)).toBe(1)
      const links = await exec(
        'SELECT count(*) AS n FROM inbound_email_labels WHERE label_id = ?',
        [labelId]
      )
      expect(Number(links.rows[0].n)).toBe(0)
    } finally {
      await Promise.all([other.dispose(), director.dispose(), admin.dispose()])
    }
  })

  test('잘못된 이름·색·같은 이름(대소문자 무시)은 거부한다', async ({ baseURL }) => {
    const admin = await ctxFor(baseURL, 'admin')
    try {
      const post = (data: object) => admin.post('/api/admin/mailbox/labels', { data })
      expect((await post({ name: `${PREFIX}Case`, color: 'blue' })).status()).toBe(201)
      expect((await post({ name: `${PREFIX}case`.toUpperCase() })).status()).toBe(409)
      expect((await post({ name: '   ' })).status()).toBe(400)
      expect((await post({ name: `${PREFIX}${'x'.repeat(30)}` })).status()).toBe(400)
      expect((await post({ name: `${PREFIX}색`, color: '#ff0000' })).status()).toBe(400)
    } finally {
      await admin.dispose()
    }
  })

  test('관리자가 붙이면 이사도 목록·상세에서 보고 라벨로 거른다, 지우면 메일은 남는다', async ({
    baseURL,
  }) => {
    const admin = await ctxFor(baseURL, 'admin')
    const director = await ctxFor(baseURL, 'director')
    try {
      const label = (
        await (
          await admin.post('/api/admin/mailbox/labels', {
            data: { name: `${PREFIX}총회`, color: 'purple' },
          })
        ).json()
      ).data.label
      const add = await admin.post(`/api/admin/mailbox/labels/${label.id}/emails`, {
        data: {
          email_ids: [...LABEL_EMAIL_IDS, '00000000-0000-4000-8000-00000000ffff'],
          action: 'add',
        },
      })
      expect(add.status()).toBe(200)
      const added = (await add.json()).data
      expect(new Set(added.changed)).toEqual(new Set(LABEL_EMAIL_IDS))
      expect(added.missing).toEqual(['00000000-0000-4000-8000-00000000ffff'])

      const filtered = (
        await (await director.get(`/api/admin/mailbox?label=${label.id}&limit=100`)).json()
      ).data.emails as { id: string; labels: { id: string }[] }[]
      expect(new Set(filtered.map(e => e.id))).toEqual(new Set(LABEL_EMAIL_IDS))
      expect(filtered[0].labels.map(l => l.id)).toContain(label.id)
      const detail = (await (await director.get(`/api/admin/mailbox/${LABEL_EMAIL_IDS[0]}`)).json())
        .data.email
      expect(detail.labels.map((l: { name: string }) => l.name)).toContain(`${PREFIX}총회`)
      expect((await director.get('/api/admin/mailbox?label=not-a-uuid')).status()).toBe(400)

      const remove = await admin.post(`/api/admin/mailbox/labels/${label.id}/emails`, {
        data: { email_ids: [LABEL_EMAIL_IDS[1]], action: 'remove' },
      })
      expect((await remove.json()).data.changed).toEqual([LABEL_EMAIL_IDS[1]])

      expect((await admin.delete(`/api/admin/mailbox/labels/${label.id}`)).status()).toBe(200)
      const still = await exec(
        'SELECT count(*) AS n FROM inbound_emails WHERE id IN (?, ?)',
        LABEL_EMAIL_IDS
      )
      expect(Number(still.rows[0].n)).toBe(2)
    } finally {
      await Promise.all([admin.dispose(), director.dispose()])
    }
  })

  test('화면: 관리자는 라벨을 만들어 골라 붙이고, 이사는 보고 거르지만 관리 도구는 없다', async ({
    browser,
  }) => {
    const name = `${PREFIX}화면`
    const adminCtx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await adminCtx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '라벨 관리' }).click({ timeout: 15000 })
      const dialog = page.getByRole('dialog', { name: '라벨 관리' })
      await dialog.getByLabel('새 라벨 이름').fill(name)
      await dialog.getByRole('button', { name: '만들기' }).click()
      await expect(dialog.getByLabel(`${name} 이름`)).toBeVisible()
      await dialog.getByRole('button', { name: '닫기' }).click()

      await page.getByLabel(`${LABEL_SUBJECT}-0 선택`).check()
      const option = page.getByLabel('고른 메일에 라벨 붙이기')
      await option.selectOption({ label: name })
      await expect
        .poll(async () =>
          Number(
            (
              await exec(
                `SELECT count(*) AS n FROM inbound_email_labels l JOIN mail_labels m ON m.id = l.label_id
                 WHERE m.name = ? AND l.email_id = ?`,
                [name, LABEL_EMAIL_IDS[0]]
              )
            ).rows[0].n
          )
        )
        .toBe(1)
    } finally {
      await adminCtx.close()
    }

    const directorCtx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await directorCtx.newPage()
      await page.goto('/board-room/mailbox', { waitUntil: 'domcontentloaded' })
      const filters = page.getByTestId('label-filters')
      await filters.getByRole('button', { name: new RegExp(name) }).click({ timeout: 15000 })
      await expect(page.getByText(`${LABEL_SUBJECT}-0`).first()).toBeVisible()
      await expect(page.getByText(`${LABEL_SUBJECT}-1`)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '라벨 관리' })).toHaveCount(0)
      await page.getByText(`${LABEL_SUBJECT}-0`).first().click()
      await expect(page.getByTestId('mail-labels')).toContainText(name)
      await expect(page.getByText('라벨 바꾸기')).toHaveCount(0)
    } finally {
      await directorCtx.close()
    }
  })
})

/**
 * 발신자 규칙 — 관리자만 만들고 지운다. 받는 즉시 적용은 서명된 웹훅이 필요해 E2E로는 못 부르므로 단위 테스트
 * (mailboxSenderRules.test.mjs)가 맡고, 여기서는 권한·검증·공용 도메인 확인·"기존 메일에도 적용"과 화면을 본다.
 */
test.describe('메일함 발신자 규칙', () => {
  test.describe.configure({ mode: 'serial' })
  const RULE_FROM = 'rules-e2e@promo-e2e.example'
  const RULE_IDS = ['00000000-0000-4000-8000-00000000c050', '00000000-0000-4000-8000-00000000c051']
  const RULE_SUBJECT = 'MAILBOX-E2E-RULES'

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }
  async function ctxFor(baseURL: string | undefined, role: string) {
    return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
  }
  async function statusOf(id: string) {
    return String(
      (await exec('SELECT status FROM inbound_emails WHERE id = ?', [id])).rows[0]?.status
    )
  }
  async function cleanup() {
    await exec(
      `DELETE FROM mail_sender_rules WHERE match_value IN ('${RULE_FROM}', 'promo-e2e.example', 'gmail.com')`
    )
    await exec('DELETE FROM inbound_emails WHERE id IN (?, ?)', RULE_IDS)
  }

  test.beforeAll(async () => {
    await cleanup()
    // 하나는 안 읽음, 하나는 답장함 — "기존 메일에도 적용"은 안 읽음·읽음만 옮겨야 한다.
    for (const [i, id] of RULE_IDS.entries()) {
      await exec(
        `INSERT INTO inbound_emails
          (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
           body_fetch_status, received_at)
         VALUES (?, ?, ?, ?, ?, '["mailbox@ggac.kr"]', ?, ?, 'done', ?)`,
        [
          id,
          id,
          `authz-mailbox-rules-${i}`,
          `광고 <${RULE_FROM}>`,
          RULE_FROM,
          `${RULE_SUBJECT}-${i}`,
          i === 0 ? 'unread' : 'replied',
          Date.now() - i * 1000,
        ]
      )
    }
  })
  test.afterAll(cleanup)

  test('규칙은 관리자만 — 비로그인 401, 이사·감사 403이고 아무것도 안 생긴다', async ({
    baseURL,
    request,
  }) => {
    const data = { match_type: 'address', match_value: RULE_FROM, action: 'spam' }
    expect((await request.get('/api/admin/mailbox/rules')).status()).toBe(401)
    for (const role of ['director', 'auditor']) {
      const ctx = await ctxFor(baseURL, role)
      try {
        expect((await ctx.get('/api/admin/mailbox/rules')).status(), role).toBe(403)
        expect((await ctx.post('/api/admin/mailbox/rules', { data })).status(), role).toBe(403)
        expect(
          (
            await ctx.get(
              `/api/admin/mailbox/rules/preview?match_type=address&match_value=${RULE_FROM}`
            )
          ).status(),
          role
        ).toBe(403)
      } finally {
        await ctx.dispose()
      }
    }
    const n = await exec(`SELECT count(*) AS n FROM mail_sender_rules WHERE match_value = ?`, [
      RULE_FROM,
    ])
    expect(Number(n.rows[0].n)).toBe(0)
  })

  test('기존 메일에도 적용하면 안 읽음만 스팸으로 가고 답장한 메일은 그대로, 같은 규칙은 409', async ({
    baseURL,
  }) => {
    const admin = await ctxFor(baseURL, 'admin')
    try {
      const preview = (
        await (
          await admin.get(
            `/api/admin/mailbox/rules/preview?match_type=address&match_value=${RULE_FROM}`
          )
        ).json()
      ).data
      expect(preview.matching_count).toBe(2)
      expect(preview.public_domain).toBe(false)

      const data = {
        match_type: 'address',
        match_value: `광고 <${RULE_FROM.toUpperCase()}>`,
        action: 'spam',
        apply_existing: true,
      }
      const made = await admin.post('/api/admin/mailbox/rules', { data })
      expect(made.status()).toBe(201)
      expect((await made.json()).data.applied_existing).toBe(1)
      expect(await statusOf(RULE_IDS[0])).toBe('spam')
      expect(await statusOf(RULE_IDS[1])).toBe('replied')

      expect((await admin.post('/api/admin/mailbox/rules', { data })).status()).toBe(409)
      const listed = (await (await admin.get('/api/admin/mailbox/rules')).json()).data.rules as {
        match_value: string
        action: string
      }[]
      expect(listed.some(r => r.match_value === RULE_FROM && r.action === 'spam')).toBe(true)
    } finally {
      await admin.dispose()
    }
  })

  test('공용 메일 도메인은 한 번 더 확인해야 하고, 잘못된 조건·라벨 없는 라벨 규칙은 400', async ({
    baseURL,
  }) => {
    const admin = await ctxFor(baseURL, 'admin')
    try {
      const post = (data: object) => admin.post('/api/admin/mailbox/rules', { data })
      const refused = await post({
        match_type: 'domain',
        match_value: 'Gmail.com',
        action: 'archive',
      })
      expect(refused.status()).toBe(400)
      expect((await refused.json()).error).toMatch(/여러 사람이 쓰는 메일 서비스/)
      expect(
        (
          await post({
            match_type: 'domain',
            match_value: 'gmail.com',
            action: 'archive',
            confirm_public_domain: true,
          })
        ).status()
      ).toBe(201)

      for (const data of [
        { match_type: 'address', match_value: 'not-an-address', action: 'spam' },
        { match_type: 'domain', match_value: 'localhost', action: 'spam' },
        { match_type: 'regex', match_value: '.*', action: 'spam' },
        { match_type: 'domain', match_value: 'promo-e2e.example', action: 'delete' },
        { match_type: 'domain', match_value: 'promo-e2e.example', action: 'label' },
      ]) {
        expect((await post(data)).status(), JSON.stringify(data)).toBe(400)
      }
    } finally {
      await admin.dispose()
    }
  })

  test('지우기는 관리자만, 이미 처리된 메일은 그대로 둔다', async ({ baseURL }) => {
    const admin = await ctxFor(baseURL, 'admin')
    const director = await ctxFor(baseURL, 'director')
    try {
      const rule = (
        (await (await admin.get('/api/admin/mailbox/rules')).json()).data.rules as {
          id: string
          match_value: string
        }[]
      ).find(r => r.match_value === RULE_FROM)!
      expect((await director.delete(`/api/admin/mailbox/rules/${rule.id}`)).status()).toBe(403)
      expect((await admin.delete(`/api/admin/mailbox/rules/${rule.id}`)).status()).toBe(200)
      expect((await admin.delete(`/api/admin/mailbox/rules/${rule.id}`)).status()).toBe(404)
      expect(await statusOf(RULE_IDS[0])).toBe('spam')
    } finally {
      await Promise.all([admin.dispose(), director.dispose()])
    }
  })

  test('화면: 관리자는 발신자 카드에서 규칙 창을 열어 미리보기를 보고 만든다, 이사에게는 도구가 없다', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await adminCtx.newPage()
      await page.goto(`/admin/mailbox?from=${encodeURIComponent(RULE_FROM)}`, {
        waitUntil: 'domcontentloaded',
      })
      await page
        .getByTestId('sender-card')
        .getByRole('button', { name: '규칙 만들기' })
        .click({ timeout: 15000 })
      const dialog = page.getByRole('dialog', { name: '발신자 규칙' })
      await expect(dialog.getByLabel('조건 값')).toHaveValue(RULE_FROM)
      await expect(dialog.getByTestId('rule-preview-count')).toContainText('맞는 메일 2통')
      await dialog.getByLabel('동작').selectOption('archive')
      await dialog.getByRole('button', { name: '규칙 만들기' }).click()
      await expect(dialog.getByTestId('rule-list')).toContainText(RULE_FROM)
      await expect(dialog).toContainText('기존 메일 0통에 적용했습니다')
    } finally {
      await adminCtx.close()
    }

    const directorCtx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await directorCtx.newPage()
      await page.goto(`/board-room/mailbox?from=${encodeURIComponent(RULE_FROM)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByTestId('sender-card')).toBeVisible({ timeout: 15000 })
      await expect(page.getByRole('button', { name: '규칙 만들기' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '발신자 규칙' })).toHaveCount(0)
    } finally {
      await directorCtx.close()
    }
  })
})

/**
 * 다시 알림 — 걸기·풀기는 관리자만. 걸면 기본 목록에서 빠지고 "다시 알림" 보기·검색에는 나온다. 시각이 지나면
 * 메일함 크론이 안 읽음으로 되돌린다(푸시는 VAPID 키가 없어 no-op). 직렬로 돈다.
 */
test.describe('메일함 다시 알림', () => {
  test.describe.configure({ mode: 'serial' })
  const SNOOZE_ID = '00000000-0000-4000-8000-00000000c060'
  const SNOOZE_SUBJECT = 'MAILBOX-E2E-SNOOZE'
  const snoozeUrl = `/api/admin/mailbox/${SNOOZE_ID}/snooze`
  const inTwoDays = () => new Date(Date.now() + 2 * 86400e3).toISOString()

  async function exec(sql: string, args: (string | number | null)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }
  async function row() {
    return (
      await exec('SELECT status, snoozed_until FROM inbound_emails WHERE id = ?', [SNOOZE_ID])
    ).rows[0]
  }
  async function ctxFor(baseURL: string | undefined, role: string) {
    return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
  }
  async function listedIds(ctx: APIRequestContext, query: string) {
    const json = await (await ctx.get(`/api/admin/mailbox?limit=100&${query}`)).json()
    return (json.data.emails as { id: string }[]).map(e => e.id)
  }

  test.beforeAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [SNOOZE_ID])
    await exec(
      `INSERT INTO inbound_emails
        (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
         body_fetch_status, received_at)
       VALUES (?, ?, 'authz-mailbox-snooze', 'snooze@example.com', 'snooze@example.com',
               '["mailbox@ggac.kr"]', ?, 'read', 'done', ?)`,
      [SNOOZE_ID, SNOOZE_ID, SNOOZE_SUBJECT, Date.now()]
    )
  })
  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id = ?', [SNOOZE_ID])
  })

  test('걸기는 관리자만 — 비로그인 401, 이사 403이고 값이 그대로다', async ({
    baseURL,
    request,
  }) => {
    expect((await request.patch(snoozeUrl, { data: { until: inTwoDays() } })).status()).toBe(401)
    const director = await ctxFor(baseURL, 'director')
    try {
      expect((await director.patch(snoozeUrl, { data: { until: inTwoDays() } })).status()).toBe(403)
    } finally {
      await director.dispose()
    }
    expect((await row()).snoozed_until).toBeNull()
  })

  test('시각은 30분 뒤 ~ 1년 안 — 지난 시각·너무 이른 시각·형식 오류는 400', async ({
    baseURL,
  }) => {
    const admin = await ctxFor(baseURL, 'admin')
    try {
      for (const until of [
        new Date(Date.now() - 60e3).toISOString(),
        new Date(Date.now() + 5 * 60e3).toISOString(),
        new Date(Date.now() + 400 * 86400e3).toISOString(),
        'tomorrow',
      ]) {
        expect((await admin.patch(snoozeUrl, { data: { until } })).status(), until).toBe(400)
      }
      expect((await row()).snoozed_until).toBeNull()
    } finally {
      await admin.dispose()
    }
  })

  test('걸면 기본 목록에서 빠지고 "다시 알림" 보기·검색에는 나온다, 크론이 시각이 지난 것을 깨운다', async ({
    baseURL,
    request,
  }) => {
    const admin = await ctxFor(baseURL, 'admin')
    const director = await ctxFor(baseURL, 'director')
    try {
      expect((await admin.patch(snoozeUrl, { data: { until: inTwoDays() } })).status()).toBe(200)
      expect(await listedIds(director, '')).not.toContain(SNOOZE_ID)
      expect(await listedIds(director, 'snoozed=only')).toContain(SNOOZE_ID)
      expect(await listedIds(director, `search=${SNOOZE_SUBJECT}`)).toContain(SNOOZE_ID)
      expect((await director.get('/api/admin/mailbox?snoozed=all')).status()).toBe(400)

      // 시각이 지난 것으로 당겨 놓고 크론을 돌린다
      await exec('UPDATE inbound_emails SET snoozed_until = ? WHERE id = ?', [
        Date.now() - 60e3,
        SNOOZE_ID,
      ])
      const cron = await request.post('/api/internal/mailbox/backfill', { headers: cronHeaders() })
      expect(cron.status()).toBe(200)
      expect((await cron.json()).data.snooze_woken).toBeGreaterThanOrEqual(1)
      const woken = await row()
      expect(woken.status).toBe('unread')
      expect(woken.snoozed_until).toBeNull()
      expect(await listedIds(director, '')).toContain(SNOOZE_ID)
    } finally {
      await Promise.all([admin.dispose(), director.dispose()])
    }
  })

  test('화면: 관리자가 "내일 아침 9시"로 걸면 목록에서 빠지고, "다시 알림" 보기에서 풀 수 있다', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await page.goto('/admin/mailbox', { waitUntil: 'domcontentloaded' })
      await page.getByText(SNOOZE_SUBJECT, { exact: true }).first().click({ timeout: 15000 })
      await page.getByLabel('다시 알림 걸기').selectOption({ label: '내일 아침 9시' })
      await expect.poll(async () => (await row()).snoozed_until).not.toBeNull()
      // 목록 행(관리자 화면은 행마다 "제목 선택" 체크박스가 있다)에서 빠진다. 상세는 열린 채로 남는다.
      await expect(page.getByLabel(`${SNOOZE_SUBJECT} 선택`)).toHaveCount(0)

      await page.getByRole('button', { name: '다시 알림', exact: true }).click()
      await page.getByText(SNOOZE_SUBJECT, { exact: true }).first().click({ timeout: 15000 })
      await page.getByTestId('mail-snooze').getByRole('button', { name: '풀기' }).click()
      await expect.poll(async () => (await row()).snoozed_until).toBeNull()
    } finally {
      await ctx.close()
    }
  })
})

/**
 * 키보드 단축키 — 판정은 단위 테스트(mailboxShortcuts.test.mjs)가 보고, 여기서는 화면에 실제로 이어지는지 본다.
 * 다른 묶음의 메일이 목록 순서를 흔들지 않게 이 묶음의 메일만 검색해 놓고 누른다. 직렬로 돈다.
 */
test.describe('메일함 키보드 단축키', () => {
  test.describe.configure({ mode: 'serial' })
  const KEY_IDS = ['00000000-0000-4000-8000-00000000c070', '00000000-0000-4000-8000-00000000c071']
  const KEY_SUBJECT = 'MAILBOX-E2E-KEYS'

  async function exec(sql: string, args: (string | number)[] = []) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      return await client.execute({ sql, args })
    } finally {
      client.close()
    }
  }
  async function statusOf(id: string) {
    return String(
      (await exec('SELECT status FROM inbound_emails WHERE id = ?', [id])).rows[0]?.status
    )
  }

  test.beforeAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id IN (?, ?)', KEY_IDS)
    for (const [i, id] of KEY_IDS.entries()) {
      await exec(
        `INSERT INTO inbound_emails
          (id, thread_id, resend_email_id, from_address, from_email, to_addresses, subject, status,
           body_fetch_status, received_at)
         VALUES (?, ?, ?, 'keys@example.com', 'keys@example.com', '["mailbox@ggac.kr"]', ?, 'read', 'done', ?)`,
        [id, id, `authz-mailbox-keys-${i}`, `${KEY_SUBJECT}-${i}`, Date.now() - i * 1000]
      )
    }
  })
  test.afterAll(async () => {
    await exec('DELETE FROM inbound_emails WHERE id IN (?, ?)', KEY_IDS)
  })

  async function openFiltered(page: import('@playwright/test').Page, path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const search = page.getByPlaceholder('제목 또는 보낸 사람 검색')
    await search.fill(KEY_SUBJECT)
    await search.press('Enter')
    await expect(page.getByText(`${KEY_SUBJECT}-1`).first()).toBeVisible({ timeout: 15000 })
    // 검색창에서 초점을 빼야 단축키가 먹는다(글을 쓰는 중에는 동작하지 않는다).
    await search.blur()
  }

  test('이사: j/k로 오가고 Esc로 닫고 /로 검색창, ?로 도움말 — 관리자 키는 먹지 않는다', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('director') })
    try {
      const page = await ctx.newPage()
      await openFiltered(page, '/board-room/mailbox')

      await page.keyboard.press('j')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-0` })).toBeVisible()
      await page.keyboard.press('j')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-1` })).toBeVisible()
      await page.keyboard.press('k')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-0` })).toBeVisible()

      await page.keyboard.press('e')
      expect(await statusOf(KEY_IDS[0])).toBe('read')

      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-0` })).toHaveCount(0)

      await page.keyboard.press('?')
      const help = page.getByRole('dialog', { name: '키보드 단축키' })
      await expect(help).toContainText('다음 · 이전 메일')
      await expect(help).not.toContainText('보관')
      await page.keyboard.press('Escape')
      await expect(help).toHaveCount(0)

      await page.keyboard.press('/')
      await expect(page.getByPlaceholder('제목 또는 보낸 사람 검색')).toBeFocused()
      // 검색창에 쓰는 중이면 j가 글자로 들어가고 메일을 열지 않는다.
      await page.keyboard.type('j')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-0` })).toHaveCount(0)

      // 보낸 편지함에는 목록 단축키가 없지만 도움말은 열린다.
      await page.getByRole('tab', { name: '보낸 편지함' }).click()
      await expect(page.getByPlaceholder('제목 또는 보낸 사람 검색')).toHaveCount(0)
      await page.keyboard.press('?')
      await expect(page.getByRole('dialog', { name: '키보드 단축키' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: '키보드 단축키' })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('관리자: x로 고르고 e로 보관한다', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('admin') })
    try {
      const page = await ctx.newPage()
      await openFiltered(page, '/admin/mailbox')
      await page.keyboard.press('j')
      await expect(page.getByRole('heading', { name: `${KEY_SUBJECT}-0` })).toBeVisible()
      await page.keyboard.press('x')
      await expect(page.getByLabel(`${KEY_SUBJECT}-0 선택`)).toBeChecked()
      await page.keyboard.press('e')
      await expect.poll(() => statusOf(KEY_IDS[0])).toBe('archived')
      expect(await statusOf(KEY_IDS[1])).toBe('read')
    } finally {
      await ctx.close()
    }
  })
})
