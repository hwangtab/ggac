import { test, expect, request as apiRequest } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

/**
 * 펀딩 인가 경계.
 *
 * ## 기능 스위치를 이 스펙만 켜 둔 상태에서 돈다
 *
 * `PATCH`/`PUT`/`POST` 계열 펀딩 쓰기 라우트(마이페이지 캠페인 수정·리워드
 * 저장·상태 전이, 관리자 상태 전이)는 `isFundingEnabled()`가 꺼져 있으면
 * 인가 판정에 닿기도 전에 503 `펀딩을 준비 중입니다.`를 던진다
 * (`src/lib/funding/settings.ts`, `src/app/api/mypage/funding/campaigns/[id]/
 * {route,rewards/route,transition/route}.ts`, `src/app/api/admin/funding/
 * campaigns/[id]/transition/route.ts`). 스위치가 꺼진 채로 돌면 아래 쓰기
 * 경계 단정이 전부 인가와 무관한 503으로 가려져 "막았다"와 "아직 준비 중이라
 * 원래 막혀 있었다"를 구분할 수 없다 — 그래서 `scripts/testing/
 * seed-authz-fixtures.mjs`가 **로컬 테스트 DB에서만** 이 스위치를 켠다.
 * 운영 `system_settings`에는 이 행 자체가 아직 없고(2026-09-23 확인),
 * 그 빠진 행을 채우는 `scripts/turso/seed-funding-settings.mjs`는
 * `enabled: false`로 심는다 — 운영 값은 이 스펙과 무관하게 항상 꺼짐에서
 * 시작한다. 읽기 라우트(캠페인 상세 조회, 관리자 캠페인 목록)는 이 스위치를
 * 보지 않으므로 스위치 상태와 무관하게 항상 인가만으로 결과가 갈린다.
 *
 * ## 캠페인을 둘 쓰는 이유
 *
 * `owner`의 초안(draft) 캠페인 하나로 "본인은 제출할 수 있다"까지 증명하면
 * 그 순간 캠페인이 submitted로 넘어간다. 관리자 심사 경계는 시작 상태가
 * submitted여야 하므로, 같은 캠페인을 재사용하면 두 describe 블록의 순서에
 * 스위트가 종속된다. 그래서 심사용 캠페인을 별도로 심고, 각 describe가
 * afterAll에서 자신이 쓴 캠페인만 시드 상태로 되돌린다.
 */

async function readCampaignRow(id: string) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `SELECT title, summary, goal_amount, status, submitted_at, review_note, owner_user_id
              FROM funding_campaigns WHERE id = ?`,
      args: [id],
    })
    return res.rows[0] ?? null
  } finally {
    client.close()
  }
}

async function readRewardRow(id: string) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `SELECT title, amount, total_quantity, requires_shipping
              FROM funding_rewards WHERE id = ?`,
      args: [id],
    })
    return res.rows[0] ?? null
  } finally {
    client.close()
  }
}

/** 초안 캠페인을 시드가 심은 원래 상태(draft, 원래 소개글)로 되돌린다. */
async function resetDraftCampaign(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `UPDATE funding_campaigns
               SET status = 'draft', submitted_at = NULL, review_note = NULL,
                   title = ?, summary = ?
             WHERE id = ?`,
      args: [
        'authz 픽스처 펀딩(초안)',
        '권한 경계 테스트용 초안 캠페인',
        fixtures.fundingDraftCampaignId,
      ],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `펀딩 초안 캠페인 초기화 실패: ${res.rowsAffected}개 행이 갱신됐다(1이어야 한다). ` +
          'seed-authz-fixtures.mjs를 먼저 돌렸는지 확인할 것.'
      )
    }
  } finally {
    client.close()
  }
}

/** 심사 캠페인을 시드가 심은 원래 상태(submitted, 반려 메모 없음)로 되돌린다. */
async function resetReviewCampaign(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `UPDATE funding_campaigns
               SET status = 'submitted', submitted_at = ?, review_note = NULL
             WHERE id = ?`,
      args: [new Date('2026-09-01T00:00:00.000Z').getTime(), fixtures.fundingReviewCampaignId],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `펀딩 심사 캠페인 초기화 실패: ${res.rowsAffected}개 행이 갱신됐다(1이어야 한다). ` +
          'seed-authz-fixtures.mjs를 먼저 돌렸는지 확인할 것.'
      )
    }
  } finally {
    client.close()
  }
}

const NONEXISTENT_CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000ff'

/**
 * `ApiError.toNextResponse()`(`src/utils/apiWrapper.ts:86`)는 모든 응답에
 * `meta.timestamp = new Date().toISOString()`를 싣는다 — 요청마다 새로
 * 찍히는 값이라 두 번의 분리된 요청은 이 필드만은 항상 다르다(실측: 41ms
 * 차이). 이 필드를 그대로 두고 `toEqual`을 걸면 두 응답이 인가 관점에서
 * 완전히 동일해도 항상 실패한다 — "본문이 다르다"가 아니라 "비교 방법이
 * 시간을 담은 필드까지 요구했다"는 뜻이다. 그래서 값 자체가 아니라 "둘 다
 * 유효한 타임스탬프 문자열을 담고 있다"는 형태만 확인하고, 실제 동등성
 * 비교에서는 같은 고정값으로 맞춘 뒤 `toEqual`을 건다 — 부분 문자열 검사로
 * 물러서지 않고 나머지 전체(상태 코드·`success`·`error`·`meta`의 나머지
 * 키)는 여전히 글자 단위로 요구한다.
 */
function normalizeVolatileMeta(body: Record<string, unknown>): Record<string, unknown> {
  const meta = body.meta as Record<string, unknown> | undefined
  expect(typeof meta?.timestamp).toBe('string')
  expect(Number.isNaN(Date.parse(meta!.timestamp as string))).toBe(false)
  return { ...body, meta: { ...meta, timestamp: '<normalized>' } }
}

test.describe('펀딩 — 마이페이지 캠페인 경계 (초안 캠페인)', () => {
  test.afterAll(async () => {
    await resetDraftCampaign()
  })

  test('캠페인 조회 — 소유자가 아니면 존재하지 않는 캠페인과 구분되지 않는다', async ({
    baseURL,
  }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      // 금지 쪽: 남의(owner의) 캠페인. 404여야 한다 — canManageCampaign이
      // 거부하면 라우트는 "권한 없음"이 아니라 "찾을 수 없음"으로 답한다
      // (src/app/api/mypage/funding/campaigns/[id]/route.ts:37-39).
      const deniedReal = await otherContext.get(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`
      )
      expect(deniedReal.status()).toBe(404)
      const deniedRealBody = await deniedReal.json()
      expect(deniedRealBody.error).toContain('찾을 수 없습니다')

      // 존재하지 않는 캠페인도 같은 경로를 탄다 — 이 사설한 답이
      // 실제로 존재하는지 여부와 무관하다는 프라이버시 성질을 직접 단정한다.
      // "같은 상태 코드"만으로는 부족하다 — 몸도 글자 단위로 같아야
      // "남의 캠페인이 존재한다"는 사실이 메시지 차이로 새지 않는다.
      const deniedMissing = await otherContext.get(
        `/api/mypage/funding/campaigns/${NONEXISTENT_CAMPAIGN_ID}`
      )
      expect(deniedMissing.status()).toBe(404)
      const deniedMissingBody = await deniedMissing.json()
      // `meta.timestamp`만 정규화하고 나머지는 그대로 견준다 — 아래 참고.
      expect(normalizeVolatileMeta(deniedMissingBody)).toEqual(
        normalizeVolatileMeta(deniedRealBody)
      )

      // 허용 쪽: 소유자는 같은 경로에서 실제로 캠페인을 받는다 — 이 단정이
      // 없으면 게이트가 "전부 막기"로 퇴화해도(캠페인 조회가 통째로 죽어도)
      // 위 두 부정 단정은 여전히 초록불이다.
      const allowed = await ownerContext.get(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`
      )
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      expect(allowedBody.success).toBe(true)
      expect(allowedBody.data?.campaign?.id).toBe(fixtures.fundingDraftCampaignId)
      expect(allowedBody.data?.campaign?.status).toBe('draft')
    } finally {
      await otherContext.dispose()
      await ownerContext.dispose()
    }
  })

  test('캠페인 수정 — 소유자가 아니면 404이고 필드는 그대로다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      const denied = await otherContext.patch(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`,
        { data: { summary: '가로챈 소개' } }
      )
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toContain('찾을 수 없습니다')

      // 짝: 404를 돌려주면서 실제로는 써버리는 모양을 상태 코드만으로는
      // 구분할 수 없다 — DB를 직접 읽어 확인한다.
      const afterDenied = await readCampaignRow(fixtures.fundingDraftCampaignId)
      expect(afterDenied?.summary).toBe('권한 경계 테스트용 초안 캠페인')

      // 허용 쪽: 소유자는 초안 상태에서 자유롭게 수정한다(editScope('draft') === 'all').
      const allowed = await ownerContext.patch(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`,
        { data: { summary: 'authz 픽스처 펀딩 — 소유자 수정 확인' } }
      )
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      expect(allowedBody.data?.campaign?.summary).toBe('authz 픽스처 펀딩 — 소유자 수정 확인')

      const afterAllowed = await readCampaignRow(fixtures.fundingDraftCampaignId)
      expect(afterAllowed?.summary).toBe('authz 픽스처 펀딩 — 소유자 수정 확인')
    } finally {
      await otherContext.dispose()
      await ownerContext.dispose()
    }
  })

  test('리워드 저장 — 소유자가 아니면 404이고 리워드는 그대로다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      const denied = await otherContext.put(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/rewards`,
        {
          data: {
            rewards: [
              {
                id: fixtures.fundingDraftRewardId,
                title: '해킹된 리워드',
                amount: 999999,
                total_quantity: null,
                requires_shipping: false,
                sort_order: 0,
              },
            ],
          },
        }
      )
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toContain('찾을 수 없습니다')

      const afterDenied = await readRewardRow(fixtures.fundingDraftRewardId)
      expect(afterDenied?.title).toBe('얼리버드')
      expect(Number(afterDenied?.amount)).toBe(10000)

      // 허용 쪽: 소유자가 같은 내용을 그대로 저장한다(멱등 — 재실행에서도
      // 리워드가 원래 값으로 남는다). 목적은 "저장이 가능하다"는 것이지 값을
      // 바꾸는 것이 아니다.
      const allowed = await ownerContext.put(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/rewards`,
        {
          data: {
            rewards: [
              {
                id: fixtures.fundingDraftRewardId,
                title: '얼리버드',
                description: '권한 경계 테스트용 리워드',
                amount: 10000,
                total_quantity: null,
                requires_shipping: false,
                sort_order: 0,
              },
            ],
          },
        }
      )
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      expect(allowedBody.data?.rewards).toHaveLength(1)
      expect(allowedBody.data?.rewards?.[0]?.title).toBe('얼리버드')

      const afterAllowed = await readRewardRow(fixtures.fundingDraftRewardId)
      expect(afterAllowed?.title).toBe('얼리버드')
      expect(Number(afterAllowed?.amount)).toBe(10000)
    } finally {
      await otherContext.dispose()
      await ownerContext.dispose()
    }
  })

  test('상태 전이 — 소유자가 아니면 404이고 상태는 그대로다. 소유자는 심사에 제출할 수 있다', async ({
    baseURL,
  }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      // 금지 쪽: actorFor('submit')는 owner_or_admin이라 그 자체로는 막히지
      // 않는다 — 관문은 그다음 canManageCampaign이고, 실패하면 역시
      // "찾을 수 없음"으로 답한다(다른 사람 캠페인의 존재를 403으로 흘리지 않는다).
      const denied = await otherContext.post(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/transition`,
        { data: { action: 'submit' } }
      )
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toContain('찾을 수 없습니다')

      const afterDenied = await readCampaignRow(fixtures.fundingDraftCampaignId)
      expect(afterDenied?.status).toBe('draft')

      // 허용 쪽: 소유자는 자기 초안을 심사에 제출한다. 픽스처 캠페인에 리워드가
      // 하나 있어야 이 전이가 통과한다(checkActionPreconditions — 리워드 없이
      // 제출하면 400이다).
      const allowed = await ownerContext.post(
        `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/transition`,
        { data: { action: 'submit' } }
      )
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      expect(allowedBody.data?.campaign?.status).toBe('submitted')

      const afterAllowed = await readCampaignRow(fixtures.fundingDraftCampaignId)
      expect(afterAllowed?.status).toBe('submitted')
      expect(afterAllowed?.submitted_at).not.toBeNull()
    } finally {
      await otherContext.dispose()
      await ownerContext.dispose()
    }
  })
})

test.describe('펀딩 — 관리자 심사 경계 (심사 대기 캠페인)', () => {
  test.afterAll(async () => {
    await resetReviewCampaign()
  })

  test('캠페인 심사 목록은 관리자만 볼 수 있다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const denied = await otherContext.get('/api/admin/funding/campaigns')
      expect(denied.status()).toBe(403)
      expect((await denied.json()).error).toContain('관리자 권한이 필요합니다')

      // 허용 쪽: 관리자는 목록에서 실제로 심사 대기 캠페인을 받는다 — 이 단정이
      // 없으면 게이트가 "전부 막기"로 퇴화해도(관리자 화면이 통째로 죽어도)
      // 위 부정 단정만으로는 잡히지 않는다.
      const allowed = await adminContext.get('/api/admin/funding/campaigns')
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      const ids = (allowedBody.data?.campaigns as Array<{ id: string }>).map(c => c.id)
      expect(ids).toContain(fixtures.fundingReviewCampaignId)
    } finally {
      await otherContext.dispose()
      await adminContext.dispose()
    }
  })

  test('캠페인 심사 전이는 관리자만 할 수 있고, 거부되면 상태가 그대로다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const denied = await otherContext.post(
        `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/transition`,
        { data: { action: 'reject', reviewNote: '조합원이 반려를 시도한다' } }
      )
      expect(denied.status()).toBe(403)
      expect((await denied.json()).error).toContain('관리자 권한이 필요합니다')

      const afterDenied = await readCampaignRow(fixtures.fundingReviewCampaignId)
      expect(afterDenied?.status).toBe('submitted')
      expect(afterDenied?.review_note).toBeNull()

      // 허용 쪽: 관리자는 실제로 반려할 수 있다(승인은 slug 발급 등 부수효과가
      // 커서, 반려로 "쓰기가 통과한다"는 같은 성질을 더 적은 부작용으로 증명한다).
      const allowed = await adminContext.post(
        `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/transition`,
        { data: { action: 'reject', reviewNote: 'authz 픽스처 반려 사유' } }
      )
      expect(allowed.status()).toBe(200)
      const allowedBody = await allowed.json()
      expect(allowedBody.data?.campaign?.status).toBe('draft')

      const afterAllowed = await readCampaignRow(fixtures.fundingReviewCampaignId)
      expect(afterAllowed?.status).toBe('draft')
      expect(afterAllowed?.review_note).toBe('authz 픽스처 반려 사유')
    } finally {
      await otherContext.dispose()
      await adminContext.dispose()
    }
  })
})

/**
 * **비인증 경계.** 위 경계들은 전부 로그인 세션이 있는 두 계정을 대조하지만,
 * 세션이 아예 없는 요청이 404/503처럼 다른 코드로 새지 않고 정확히 401로
 * 막히는지는 따로 확인해야 한다 — `isFundingEnabled()` 검사가 인증 검사보다
 * 앞에 있는 라우트(PATCH·PUT·전이 계열)에서는 특히, 스위치가 꺼져 있으면
 * 비인증 요청이 401 대신 503을 받아 "인증도 확인 안 하고 막았다"는 착시를
 * 준다 — 이 스펙은 스위치를 켜 둔 상태로 돌므로 그 착시 없이 401을 직접 본다.
 */
test.describe('펀딩 — 비인증 요청', () => {
  test('마이페이지·관리자 펀딩 라우트는 전부 401이다', async ({ baseURL }) => {
    const anonContext = await apiRequest.newContext({ baseURL })
    try {
      const requests: Array<[string, () => Promise<{ status(): number }>]> = [
        [
          'GET /api/mypage/funding/campaigns/[id]',
          () => anonContext.get(`/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`),
        ],
        [
          'PATCH /api/mypage/funding/campaigns/[id]',
          () =>
            anonContext.patch(`/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}`, {
              data: { summary: '비인증 시도' },
            }),
        ],
        [
          'PUT /api/mypage/funding/campaigns/[id]/rewards',
          () =>
            anonContext.put(
              `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/rewards`,
              { data: { rewards: [] } }
            ),
        ],
        [
          'POST /api/mypage/funding/campaigns/[id]/transition',
          () =>
            anonContext.post(
              `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/transition`,
              { data: { action: 'submit' } }
            ),
        ],
        ['GET /api/admin/funding/campaigns', () => anonContext.get('/api/admin/funding/campaigns')],
        [
          'POST /api/admin/funding/campaigns/[id]/transition',
          () =>
            anonContext.post(
              `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/transition`,
              { data: { action: 'reject', reviewNote: '비인증 시도' } }
            ),
        ],
      ]

      for (const [label, run] of requests) {
        const res = await run()
        expect(res.status(), label).toBe(401)
      }
    } finally {
      await anonContext.dispose()
    }
  })
})
