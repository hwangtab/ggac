import { test, expect, request as apiRequest } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

/**
 * 단계 2b-3에서 "살아 있는데 미검증"으로 남긴 8건의 RLS 정책 중 실제로
 * 도달 가능한 엔드포인트가 있는 4건을 덮는다(정책 15/26/29/56은 엔드포인트
 * 자체가 없어 이 스펙에 없다 — task-4-report.md 참고).
 *
 * 단정 규칙은 authz-ownership.spec.ts/authz-personal.spec.ts와 동일하다:
 * RLS는 감추고(404/빈 목록) 앱은 막는다(403/그 사용자 전용 오류). 부정
 * 단정은 상태 코드와 `error` 메시지 조각을 정확히 고정하고, 목록 부정
 * 단정은 반드시 소유자 세션의 긍정 단정과 짝짓는다.
 */

/**
 * notifications.read_at을 NULL로 되돌린다. PATCH 재요청 시 앱이 쓰는
 * `markNotificationRead`(`src/db/queries/notifications.ts`)의
 * `isNull(notifications.readAt)` 매치 조건을 재현 가능하게 만든다.
 *
 * 단계 2c(Task 7)부터 notifications는 Turso 권위다 — `/api/notifications/[id]`
 * PATCH가 더 이상 Supabase를 전혀 읽지 않으므로, 이 리셋도 Supabase가 아니라
 * Turso를 직접 UPDATE해야 실제로 다음 PATCH 요청에 영향을 준다(Supabase
 * notifications를 계속 PATCH하면 조용한 no-op이 되어 "이미 읽음" 상태가
 * 절대 안 풀리고, 그 결과 "남의 알림 PATCH → 404" 단정이 user_id 검사가
 * 아니라 read_at 상태 우연으로 항상 통과하는 거짓 양성이 된다).
 */
async function resetNotificationUnread(notificationId: string): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    await client.execute({
      sql: 'UPDATE notifications SET read_at = NULL WHERE id = ?',
      args: [notificationId],
    })
  } finally {
    client.close()
  }
}

test.describe('알림 읽음 처리는 본인 알림만 (정책 34)', () => {
  test.describe('타인 세션', () => {
    test.use({ storageState: storageStatePath('other') })

    test('남의 알림 읽음 처리는 404 + 찾을 수 없음이다', async ({ request }) => {
      // 실측: PATCH는 .eq('id', id).eq('user_id', user.id).is('read_at', null)로
      // 스코프한 뒤 매치 행이 없으면 앱이 명시적으로 404를 던진다
      // (src/app/api/notifications/[id]/route.ts) — RLS가 감추는 게 아니라
      // 앱이 user_id로 걸러서 막는 것이지만, 응답 모양 자체는 "없다"로 온다.
      //
      // 먼저 read_at을 NULL로 되돌려야 이 단정이 매 실행마다 의미를 가진다.
      // 되돌리지 않으면 이전 실행(본인 세션 테스트)이 이미 읽음 처리해 둔
      // 상태가 남아 .is('read_at', null) 조건 자체가 매치를 실패시키고,
      // user_id 검사가 아예 없어도 이 테스트는 늘 404로 통과해버린다 —
      // 인가 검증이 아니라 상태 우연에 기대는 거짓 양성이 된다.
      await resetNotificationUnread(fixtures.notificationId)

      const res = await request.patch(`/api/notifications/${fixtures.notificationId}`)
      expect(res.status()).toBe(404)
      expect((await res.json()).error).toContain('찾을 수 없거나 권한이 없습니다')
    })
  })

  test.describe('본인 세션', () => {
    test.use({ storageState: storageStatePath('owner') })

    test('본인 알림 읽음 처리는 200이다', async ({ request }) => {
      // 위 타인 세션 테스트는 매치 실패라 read_at을 건드리지 않지만, 이 스펙을
      // 반복 실행하면 이전 실행에서 이미 읽음 처리됐을 수 있다. .is('read_at', null)
      // 조건 때문에 이미 읽은 알림은 본인이 다시 읽어도 404가 난다 — 그래서
      // 매 실행이 결정적이도록 먼저 읽지 않음 상태로 되돌린다.
      await resetNotificationUnread(fixtures.notificationId)

      const res = await request.patch(`/api/notifications/${fixtures.notificationId}`)
      expect(res.status()).toBe(200)
      expect((await res.json()).message).toContain('읽음 처리되었습니다')
    })
  })
})

test.describe('첨부파일 목록 조회는 로그인 없이도 공개다 (정책 36)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('비인증 요청도 게시글 첨부파일 목록을 200으로 본다', async ({ request, baseURL }) => {
    // 준비: 픽스처 글에 식별 가능한 첨부파일이 있는지 먼저 확인하고, 없으면
    // 소유자 세션으로 하나 올린다. 재실행해도 중복 업로드하지 않도록
    // alt_text로 픽스처 첨부파일을 식별한다(멱등).
    const marker = 'authz-fixture-attachment'
    const list = await request.get(`/api/posts/${fixtures.postId}/attachments`)
    expect(list.status()).toBe(200)
    const listBody = await list.json()
    let attachmentId: string | undefined = (listBody.data?.attachments ?? []).find(
      (a: { alt_text?: string }) => a.alt_text === marker
    )?.id

    if (!attachmentId) {
      // 업로드 대상은 Vercel Blob 하나뿐이다(Task 5에서 제공자 분기가 사라졌다).
      // `PUBLIC_BLOB_READ_WRITE_TOKEN`이 없으면 라우트가 업로드를 시작하기 전에
      // 거부하므로(`hasPublicBlobStore()`), 여기서 그 사실을 먼저 명시한다 —
      // 그러지 않으면 "왜 500인지" 알 수 없는 실패로 보인다. 예전 이 자리에
      // 있던 `ensureAttachmentsBucket()`(Supabase Storage 버킷 생성)은
      // 업로드 경로가 Blob으로 옮겨간 순간 아무 효과가 없는 죽은 코드가 됐다.
      expect(
        process.env.PUBLIC_BLOB_READ_WRITE_TOKEN,
        'PUBLIC_BLOB_READ_WRITE_TOKEN이 없으면 정책 36의 업로드 준비 단계를 통과할 수 없다'
      ).toBeTruthy()

      // 1x1 투명 PNG. hasValidFileSignature가 요구하는 PNG 매직 바이트를 포함한다.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      )
      const upload = await request.post(`/api/posts/${fixtures.postId}/attachments`, {
        multipart: {
          file: { name: 'authz-fixture.png', mimeType: 'image/png', buffer: png },
          alt_text: marker,
        },
      })
      expect(upload.status()).toBe(200)
      const uploadBody = await upload.json()
      attachmentId = uploadBody.data?.attachment?.id
      expect(attachmentId).toBeTruthy()
    }

    // 실제 단정: 세션 쿠키가 전혀 없는 별도 컨텍스트(익명)로도 200 + 목록에
    // 그 첨부파일이 보여야 "무조건 공개"(qual=true, roles={anon}) 정책을
    // 검증한 것이다. 로그인된 request 컨텍스트로는 익명 접근을 증명하지 못한다.
    const anonContext = await apiRequest.newContext({ baseURL, storageState: undefined })
    try {
      const anonRes = await anonContext.get(`/api/posts/${fixtures.postId}/attachments`)
      expect(anonRes.status()).toBe(200)
      const anonBody = await anonRes.json()
      const ids = (anonBody.data?.attachments ?? []).map((a: { id: string }) => a.id)
      expect(ids).toContain(attachmentId)
    } finally {
      await anonContext.dispose()
    }
  })
})

test.describe('설정은 본인 것만 보인다 (정책 58)', () => {
  test.describe('본인 세션', () => {
    test.use({ storageState: storageStatePath('owner') })

    test('본인이 저장한 설정 값이 본인 조회에는 보이고 타인 조회에는 없다', async ({
      request,
      baseURL,
    }) => {
      // 식별 가능한 값을 저장한다. get_user_settings는 커스터마이즈하지 않은
      // 키도 기본값과 함께 돌려주므로(있음/없음만으로는 못 가른다), 기본값일
      // 리 없는 고유 문자열로 실제 소유자 값인지를 가른다.
      const marker = `authz-owner-${fixtures.users.owner.slice(0, 8)}`
      const save = await request.post('/api/settings', {
        data: { category: 'interface', setting_key: 'timezone', setting_value: marker },
      })
      expect(save.status()).toBe(200)
      expect((await save.json()).message).toContain('Setting updated successfully')

      const mine = await request.get('/api/settings?category=interface')
      expect(mine.status()).toBe(200)
      const mineBody = await mine.json()
      const mineValues = (mineBody.data?.settings ?? []).map(
        (s: { setting_key: string; setting_value: unknown }) =>
          `${s.setting_key}:${s.setting_value}`
      )
      expect(mineValues).toContain(`timezone:${marker}`)

      const otherContext = await apiRequest.newContext({
        baseURL,
        storageState: storageStatePath('other'),
      })
      try {
        const theirs = await otherContext.get('/api/settings?category=interface')
        expect(theirs.status()).toBe(200)
        const theirsBody = await theirs.json()
        const theirsValues = (theirsBody.data?.settings ?? []).map(
          (s: { setting_key: string; setting_value: unknown }) =>
            `${s.setting_key}:${s.setting_value}`
        )
        expect(theirsValues).not.toContain(`timezone:${marker}`)
      } finally {
        await otherContext.dispose()
      }
    })
  })
})
