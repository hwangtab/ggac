import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 기능 스위치 넷이 **실제로 무언가를 끄는지** 증명한다.
 *
 * 소스에 헬퍼 이름이 있는지 보는 정적 검사로는 이 질문에 답할 수 없다 —
 * 이 저장소는 그 방식이 옛 계약을 붙들고 있거나 정상 데이터를 위반으로 세던
 * 일을 여러 번 겪었다. 여기서는 관리자가 화면에서 하는 것과 같은 일을 한다:
 * `system_settings`의 그 행을 끄고, 실제 요청을 보내고, 돌아온 상태를 본다.
 *
 * 각 스펙은 **끈 상태와 켠 상태를 모두** 확인한다. 꺼졌을 때 503만 보면,
 * 라우트가 늘 503을 돌려주는 경우와 구분되지 않는다.
 *
 * 설정 캐시: 앱은 `system_settings`를 5분 캐시하지만 E2E webServer는
 * `SETTINGS_CACHE_TTL_MS=0`으로 뜬다(`playwright.config.ts`) — 여기서 끈 값이
 * 다음 요청에 바로 보인다.
 */

const FEATURE_ROWS = {
  board: {
    key: 'board_features',
    on: {
      enabled: true,
      categories: ['공지', '잡담', '홍보', '건의'],
      allow_anonymous: false,
      moderation_enabled: true,
    },
    off: {
      enabled: false,
      categories: ['공지', '잡담', '홍보', '건의'],
      allow_anonymous: false,
      moderation_enabled: true,
    },
  },
  comments: {
    key: 'comment_features',
    on: { enabled: true, nested_replies: true, max_depth: 3 },
    off: { enabled: false, nested_replies: true, max_depth: 3 },
  },
  artist: {
    key: 'artist_features',
    on: { registration_enabled: true, portfolio_upload: true },
    off: { registration_enabled: false, portfolio_upload: true },
  },
  fileUpload: {
    key: 'file_upload',
    on: { enabled: true, max_size_mb: 50 },
    off: { enabled: false, max_size_mb: 50 },
  },
} as const

type FeatureName = keyof typeof FEATURE_ROWS

/**
 * 스위치를 쓴다. **영향 행 수를 확인한다** — 시드가 행을 만들지 않으면
 * UPDATE는 0행에 적용되고 아무 에러도 나지 않으며, 그 상태에서도 "막히지
 * 않는다" 계열 단정은 그대로 통과한다(유지보수 스펙이 겪은 그 침묵이다).
 */
async function setFeature(feature: FeatureName, enabled: boolean) {
  const spec = FEATURE_ROWS[feature]
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
            WHERE category = 'features' AND setting_key = ?`,
      args: [JSON.stringify(enabled ? spec.on : spec.off), Date.now(), spec.key],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `기능 스위치 설정 실패: system_settings(features/${spec.key}) 행이 ${res.rowsAffected}개 갱신됐다. ` +
          '픽스처 시드(scripts/testing/seed-authz-fixtures.mjs)를 먼저 돌렸는지 확인할 것.'
      )
    }
  } finally {
    client.close()
  }
}

const POST_ID = '00000000-0000-4000-8000-00000000a001'

test.describe('기능 스위치', () => {
  test.use({ storageState: storageStatePath('owner') })

  test.afterEach(async () => {
    for (const name of Object.keys(FEATURE_ROWS) as FeatureName[]) await setFeature(name, true)
  })

  test('게시판을 끄면 새 글이 503, 켜면 통과한다', async ({ request }) => {
    await setFeature('board', false)
    const blocked = await request.post('/api/posts', {
      data: { title: '스위치 확인', content: '<p>x</p>', category: '잡담' },
    })
    expect(blocked.status()).toBe(503)
    expect(await blocked.text()).toContain('게시판')

    await setFeature('board', true)
    const open = await request.post('/api/posts', {
      data: { title: '스위치 확인', content: '<p>x</p>', category: '잡담' },
    })
    // 켜져 있으면 기능 게이트를 지나 본문 검증·저장으로 들어간다.
    expect(open.status()).not.toBe(503)
  })

  test('읽기는 게시판을 꺼도 그대로다', async ({ request }) => {
    await setFeature('board', false)
    // 끈 것은 새 글이지 이미 있는 글이 아니다 — 목록도 본문도 그대로 열려야
    // 한다. 이게 깨지면 "기능을 껐다"가 아니라 "자료를 잃었다"가 된다.
    expect((await request.get('/api/posts')).status()).toBe(200)
    expect((await request.get(`/api/posts/${POST_ID}`)).status()).toBe(200)
  })

  test('댓글을 끄면 새 댓글이 503, 켜면 통과한다', async ({ request }) => {
    await setFeature('comments', false)
    const blocked = await request.post(`/api/posts/${POST_ID}/comments`, {
      data: { content: '스위치 확인' },
    })
    expect(blocked.status()).toBe(503)
    expect(await blocked.text()).toContain('댓글')

    await setFeature('comments', true)
    const open = await request.post(`/api/posts/${POST_ID}/comments`, {
      data: { content: '스위치 확인' },
    })
    expect(open.status()).not.toBe(503)
  })

  test('댓글을 꺼도 달려 있는 댓글은 그대로 읽힌다', async ({ request }) => {
    await setFeature('comments', false)
    expect((await request.get(`/api/posts/${POST_ID}/comments`)).status()).toBe(200)
  })

  test('아티스트 등록을 끄면 수정이 503, 켜면 통과한다', async ({ request }) => {
    await setFeature('artist', false)
    const blocked = await request.patch('/api/mypage/artist', { data: { name: '스위치 확인' } })
    expect(blocked.status()).toBe(503)
    expect(await blocked.text()).toContain('아티스트')

    await setFeature('artist', true)
    const open = await request.patch('/api/mypage/artist', { data: { name: '스위치 확인' } })
    // 켜져 있으면 기능 게이트가 아니라 인가·검증이 답한다(이 계정은 아티스트가
    // 아니므로 403/400이다). 무엇이 오든 503만 아니면 게이트를 지난 것이다.
    expect(open.status()).not.toBe(503)
  })

  test('파일 업로드를 끄면 업로드가 503, 켜면 통과한다', async ({ request }) => {
    await setFeature('fileUpload', false)
    const blocked = await request.post('/api/media/upload', {
      multipart: { bucket: 'attachments' },
    })
    expect(blocked.status()).toBe(503)
    expect(await blocked.text()).toContain('업로드')

    await setFeature('fileUpload', true)
    const open = await request.post('/api/media/upload', {
      multipart: { bucket: 'attachments' },
    })
    // 켜져 있으면 게이트를 지나 "파일이 없다"(400)로 답한다.
    expect(open.status()).toBe(400)
  })

  test('관리자도 같은 스위치에 걸린다', async ({ browser, baseURL }) => {
    // 펀딩 스위치가 관리자 펀딩 라우트까지 막는 것과 같은 규칙이다. 게시판을
    // 껐는데 사무국만 글을 쓸 수 있으면 껐다고 할 수 없다.
    const ctx = await browser.newContext({ baseURL, storageState: storageStatePath('admin') })
    try {
      await setFeature('board', false)
      const res = await ctx.request.post('/api/posts', {
        data: { title: '관리자 스위치 확인', content: '<p>x</p>', category: '공지' },
      })
      expect(res.status()).toBe(503)
    } finally {
      await ctx.close()
    }
  })
})
