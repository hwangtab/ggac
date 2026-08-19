import { test, expect, request as apiRequest } from '@playwright/test'

import { assertLocalSupabase, readFixtures, storageStatePath } from './helpers/authState'

assertLocalSupabase()
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

// 로컬 스택 전용 관리 조작(픽스처 상태 리셋)에 service_role을 직접 쓴다 —
// scripts/testing/seed-authz-fixtures.mjs와 같은 패턴이다. assertLocalSupabase()가
// 이미 로컬이 아닌 호스트를 막으므로 이 헬퍼도 안전하다.
function restHeaders(): Record<string, string> {
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY가 없다. 권한 E2E는 로컬 스택에서만 돌린다.')
  }
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/**
 * 로컬 스택에는 스키마(테이블/RLS)는 시딩돼 있지만 Storage 버킷은 비어 있다
 * (`GET /storage/v1/bucket` → `[]`). 정책 36을 검증하려면 실제 업로드 API를
 * 통과시켜야 하는데, putSupabaseObject(src/lib/storage/supabase.ts)가 요구하는
 * `attachments` 버킷이 없으면 업로드가 500 "Bucket not found"로 막혀 정책까지
 * 도달하지 못한다. 앱 코드나 config.toml을 건드리지 않고, 시드 스크립트와 같은
 * service-role 관리 API 호출로 버킷만 멱등하게 만든다.
 */
async function ensureAttachmentsBucket(): Promise<void> {
  const url = process.env.E2E_SUPABASE_URL
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify({ id: 'attachments', name: 'attachments', public: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    // 이미 있으면 409 Duplicate — 멱등이므로 무시한다.
    if (res.status !== 409 && !body.includes('already exists')) {
      throw new Error(`attachments 버킷 생성 실패: ${res.status} ${body}`)
    }
  }
}

/** notifications.read_at을 NULL로 되돌린다. PATCH 재요청 시 .is('read_at', null) 매치 조건을 재현 가능하게 만든다. */
async function resetNotificationUnread(notificationId: string): Promise<void> {
  const url = process.env.E2E_SUPABASE_URL
  const res = await fetch(`${url}/rest/v1/notifications?id=eq.${notificationId}`, {
    method: 'PATCH',
    headers: restHeaders(),
    body: JSON.stringify({ read_at: null }),
  })
  if (!res.ok) {
    throw new Error(`알림 read_at 리셋 실패: ${res.status} ${await res.text()}`)
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
      await ensureAttachmentsBucket()

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
