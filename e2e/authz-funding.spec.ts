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
      // slug·approved_at까지 되돌린다 — 이 캠페인은 승인까지 가는 테스트가
      // 있고(「승인은 심사한 판에만 찍힌다」), 승인은 둘 다 새로 쓴다.
      sql: `UPDATE funding_campaigns
               SET status = 'submitted', submitted_at = ?, review_note = NULL,
                   slug = 'authz-e2e-funding-review', approved_at = NULL
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

  /**
   * 정산 라우트 셋도 같은 게이트(`requireAdmin()`) 뒤에 있다. 비인증 401은
   * 아래 비인증 경계가 보지만, **로그인한 평조합원이 403인지**는 그것과 다른
   * 질문이다 — 2026-08 적대 감사가 파고든 모양이 바로 공유 헬퍼 안의 한 줄
   * 변경이었고, 정적 가드는 그것을 놓쳤고 E2E가 잡았다.
   *
   * 셋을 다 부르는 이유: 하나만 보면 나머지 둘에 게이트를 빼먹어도 초록불이다.
   * 읽기(GET)까지 포함한다 — 금액과 사무국 메모가 실려 나가는 응답이다.
   */
  test('정산 내역은 관리자만 읽고 쓸 수 있다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    const url = `/api/admin/funding/campaigns/${fixtures.fundingSettleCampaignId}/settlement`
    try {
      const denied: Array<
        [string, { status(): number; json(): Promise<Record<string, unknown>> }]
      > = [
        ['GET', await otherContext.get(url)],
        ['POST', await otherContext.post(url, { data: { pg_fee_amount: 0 } })],
        ['PATCH', await otherContext.patch(url, { data: { action: 'mark_paid' } })],
      ]
      for (const [method, res] of denied) {
        expect(res.status(), `${method} 거부 코드`).toBe(403)
        expect((await res.json()).error).toContain('관리자 권한이 필요합니다')
      }

      // 짝: 게이트가 "전부 막기"로 퇴화해도 위 부정 단정만으로는 잡히지 않는다.
      // 관리자는 실제로 읽을 수 있어야 하고, 그 응답에는 원장에서 방금 센 근거가
      // 들어 있어야 한다.
      const allowed = await adminContext.get(url)
      expect(allowed.status()).toBe(200)
      expect((await allowed.json()).data?.current_basis?.net_amount).toEqual(expect.any(Number))
    } finally {
      await otherContext.dispose()
      await adminContext.dispose()
    }
  })

  /**
   * **사무국 구제 수단 — 이행 되돌리기와 대리 환불.**
   *
   * 둘 다 `requireAdmin()` 하나에 걸려 있고, 그 한 줄이 지켜야 하는 것이 크다.
   * 되돌리기는 이미 부친 물건에 대해 **자동 환불을 다시 여는** 동작이고
   * (개설자가 혼자 하지 못하게 막아 둔 바로 그 일이다), 환불은 **남의 결제를
   * 돌려주는** 동작이다. 개설자가 자기 캠페인이라도 이 라우트로 들어오면 안
   * 된다 — 그래서 `other`(승인된 평조합원)로 두드려 403을 직접 본다.
   *
   * 짝: 게이트가 "전부 막기"로 퇴화하면 위 부정 단정만으로는 잡히지 않는다.
   * 관리자는 조회를 실제로 할 수 있어야 하고, 쓰기도 인가가 아니라 **본문
   * 검증**에서 걸려야 한다(여기서 실제로 되돌리지는 않는다 — 픽스처 상태를
   * 움직이면 다른 스펙이 따라 흔들린다).
   */
  test('이행 되돌리기와 사무국 대리 환불은 관리자만 할 수 있다', async ({ baseURL }) => {
    const otherContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    const fulfillmentUrl = `/api/admin/funding/campaigns/${fixtures.fundingActiveCampaignId}/fulfillment`
    const refundUrl = `/api/admin/funding/pledges/${fixtures.fundingMemberPledgeId}/refund`
    const reversalBody = {
      to: 'none',
      kind: 'wrong_row',
      reason: '평조합원이 되돌리기를 시도합니다',
      pledge_ids: [fixtures.fundingMemberPledgeId],
    }
    try {
      const denied: Array<
        [string, { status(): number; json(): Promise<Record<string, unknown>> }]
      > = [
        ['GET 이행 현황', await otherContext.get(fulfillmentUrl)],
        ['POST 되돌리기', await otherContext.post(fulfillmentUrl, { data: reversalBody })],
        [
          'POST 대리 환불',
          await otherContext.post(refundUrl, { data: { reason: '평조합원이 환불을 시도합니다' } }),
        ],
      ]
      for (const [label, res] of denied) {
        expect(res.status(), `${label} 거부 코드`).toBe(403)
        expect((await res.json()).error).toContain('관리자 권한이 필요합니다')
      }

      // 짝 ①: 관리자는 이행 현황을 읽는다.
      const read = await adminContext.get(fulfillmentUrl)
      expect(read.status()).toBe(200)
      const body = await read.json()
      expect(body.data?.counts?.none).toEqual(expect.any(Number))
      expect(Array.isArray(body.data?.pledges)).toBe(true)

      // 짝 ②: 관리자의 쓰기는 인가가 아니라 본문 검증에서 갈린다. 사유를
      // 빼고 보내면 400이고, 아무 후원도 움직이지 않는다.
      const missingReason = await adminContext.post(fulfillmentUrl, {
        data: { to: 'none', kind: 'wrong_row', pledge_ids: [fixtures.fundingMemberPledgeId] },
      })
      expect(missingReason.status()).toBe(400)
      const refundNoReason = await adminContext.post(refundUrl, { data: { reason: '짧다' } })
      // 결제 스위치가 꺼진 배포에서는 인증 뒤 503으로 갈린다 — 어느 쪽이든
      // 403·401이 아니라는 것이 여기서 볼 것이다.
      expect([400, 503]).toContain(refundNoReason.status())

      const untouched = await adminContext.get(fulfillmentUrl)
      const rows = (await untouched.json()).data?.pledges as { id: string }[]
      expect(Array.isArray(rows)).toBe(true)
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
 *
 * 이행(`POST …/fulfillment`)과 배송 목록 내보내기(`GET …/shipping-export`)도
 * 같은 순서를 쓴다. 그 순서를 **일부러** 고른 것이다: 스위치가 꺼져 있으면
 * 누가 부르든 503이고 그 답은 인증 여부에 따라 갈리지 않으므로 흘리는 것이
 * 없다. 배송 목록은 남의 이름·연락처·주소를 내보내는 라우트라 더 조심해야
 * 하지만, 그 조심은 여기가 아니라 인증·소유자 판정·기록·빈도 제한이 맡는다.
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
        [
          'POST /api/mypage/funding/campaigns/[id]/fulfillment',
          () =>
            anonContext.post(
              `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/fulfillment`,
              { data: { to: 'shipped', pledge_ids: ['00000000-0000-0000-0000-000000000000'] } }
            ),
        ],
        [
          // 표지 업로드는 자기 라우트를 갖는다(파일 업로드 스위치와 분리).
          // 본문이 FormData지만 비인증 거절은 본문을 읽기 전에 난다.
          'POST /api/mypage/funding/campaigns/[id]/cover',
          () =>
            anonContext.post(
              `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/cover`,
              {
                multipart: {
                  file: {
                    name: 'c.png',
                    mimeType: 'image/png',
                    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
                  },
                },
              }
            ),
        ],
        [
          'GET /api/mypage/funding/campaigns/[id]/shipping-export',
          () =>
            anonContext.get(
              `/api/mypage/funding/campaigns/${fixtures.fundingDraftCampaignId}/shipping-export`
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
        [
          'GET /api/admin/funding/campaigns/[id]/settlement',
          () =>
            anonContext.get(
              `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/settlement`
            ),
        ],
        [
          'POST /api/admin/funding/campaigns/[id]/settlement',
          () =>
            anonContext.post(
              `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/settlement`,
              { data: { pg_fee_amount: 0 } }
            ),
        ],
        [
          'PATCH /api/admin/funding/campaigns/[id]/settlement',
          () =>
            anonContext.patch(
              `/api/admin/funding/campaigns/${fixtures.fundingReviewCampaignId}/settlement`,
              { data: { action: 'mark_paid' } }
            ),
        ],
        // 사무국 구제 수단 둘. 하나는 남의 결제를 돌려주고, 하나는 이미 나간
        // 발송 안내를 되돌린다 — 세션 없이 닿으면 안 되는 자리다.
        [
          'GET /api/admin/funding/campaigns/[id]/fulfillment',
          () =>
            anonContext.get(
              `/api/admin/funding/campaigns/${fixtures.fundingActiveCampaignId}/fulfillment`
            ),
        ],
        [
          'POST /api/admin/funding/campaigns/[id]/fulfillment',
          () =>
            anonContext.post(
              `/api/admin/funding/campaigns/${fixtures.fundingActiveCampaignId}/fulfillment`,
              {
                data: {
                  to: 'none',
                  kind: 'wrong_row',
                  reason: '비인증 시도입니다 되돌리기',
                  pledge_ids: [fixtures.fundingMemberPledgeId],
                },
              }
            ),
        ],
        [
          'POST /api/admin/funding/pledges/[id]/refund',
          () =>
            anonContext.post(
              `/api/admin/funding/pledges/${fixtures.fundingMemberPledgeId}/refund`,
              {
                data: { reason: '비인증 시도입니다 환불' },
              }
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

/**
 * **관리자 전용 동작(approve·reject·settle)은 마이페이지 라우트로 들어오지 못한다.**
 *
 * 마이페이지 전이 라우트(`src/app/api/mypage/funding/campaigns/[id]/transition/
 * route.ts`)에서 이 경계를 지키는 것은 **한 줄**이다 —
 * `if (actorFor(action) !== 'owner_or_admin') return ApiError.forbidden(...)`.
 * 그 줄을 지우면 개설자가 자기 캠페인에 `{"action":"approve"}`를 보내 스스로
 * 공개하고 돈을 받기 시작할 수 있고, 이어서 `close`·`settle`까지 간다.
 *
 * 그 줄이 없어도 아래 어느 것도 울지 않는다(실제로 확인한 사실이다):
 *
 * - `canManageCampaign`은 **누구의 캠페인인가**만 보고 어떤 동작인지 모른다
 * - `nextStatus('submitted', 'approve')`는 유효한 전이다 — 전이표에 행위자
 *   개념이 없다
 * - `checkActionPreconditions`에는 `submit` 규칙만 있다
 * - `transitionCampaign`은 slug가 없어도 그냥 승인한다
 * - `scripts/testing/fundingTransitions.test.mjs`는 `actorFor('approve')`가
 *   `'admin'`임을 못박지만, **그 함수를 라우트가 부르는지는 아무도 안 본다**
 *
 * 그래서 경계를 라우트로 직접 두드린다. 동작마다 캠페인을 따로 두는 이유는
 * 시드 주석에 적었다.
 *
 * ### 왜 동작 **전부**를 도는가
 *
 * 하나만 못박으면 나머지가 열린 채로 남는다. `settle`은 특히 조심스럽다 —
 * 시작 상태가 `closed`가 아니면 가드를 지워도 전이표가 400으로 막아, 테스트가
 * "막혔다"를 보면서 아무것도 증명하지 않는다. 그래서 정산 캠페인만 `closed`로
 * 심고, 단정도 "200이 아니다"가 아니라 **정확히 403과 그 문구**를 요구한다.
 */
const ADMIN_ONLY_ACTIONS = [
  {
    action: 'approve',
    campaignId: fixtures.fundingApproveCampaignId,
    from: 'submitted',
    to: 'active',
  },
  {
    action: 'reject',
    campaignId: fixtures.fundingRejectCampaignId,
    from: 'submitted',
    to: 'draft',
  },
  { action: 'settle', campaignId: fixtures.fundingSettleCampaignId, from: 'closed', to: 'settled' },
] as const

/** 관리자 화면이 승인 요청에 싣는 판 번호. 관리자도 마이페이지 조회로 읽는다. */
async function readCampaignVersion(
  context: { get(url: string): Promise<{ status(): number; json(): Promise<any> }> },
  id: string
): Promise<string> {
  const res = await context.get(`/api/mypage/funding/campaigns/${id}`)
  expect(res.status()).toBe(200)
  const version = (await res.json()).data?.campaign?.updated_at
  expect(typeof version).toBe('string')
  return version as string
}

/** 관리자 라우트가 각 동작에 요구하는 나머지 입력. 인가와 무관한 400을 피한다. */
async function adminTransitionBody(
  action: (typeof ADMIN_ONLY_ACTIONS)[number]['action'],
  adminContext: Parameters<typeof readCampaignVersion>[0],
  campaignId: string
): Promise<Record<string, unknown>> {
  if (action === 'approve') {
    return {
      action,
      // 시드가 심은 주소를 그대로 돌려준다 — 주소가 바뀌지 않으므로 유니크
      // 충돌도, 되돌릴 것도 없다.
      slug: fixtures.fundingApproveCampaignSlug,
      reviewedVersion: await readCampaignVersion(adminContext, campaignId),
    }
  }
  if (action === 'reject') return { action, reviewNote: 'authz 픽스처 반려 사유(관리자 전용 동작)' }
  return { action }
}

/** 관리자 전용 동작 캠페인 셋을 시드가 심은 시작 상태로 되돌린다. */
async function resetAdminActionCampaigns(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const rows: Array<[string, string, number | null]> = [
      [fixtures.fundingApproveCampaignId, 'submitted', null],
      [fixtures.fundingRejectCampaignId, 'submitted', null],
      [fixtures.fundingSettleCampaignId, 'closed', new Date('2026-09-02T00:00:00.000Z').getTime()],
    ]
    for (const [id, status, closedAt] of rows) {
      const res = await client.execute({
        sql: `UPDATE funding_campaigns
                 SET status = ?, closed_at = ?, submitted_at = ?,
                     approved_at = NULL, settled_at = NULL, review_note = NULL
               WHERE id = ?`,
        args: [status, closedAt, new Date('2026-09-01T00:00:00.000Z').getTime(), id],
      })
      if (res.rowsAffected !== 1) {
        throw new Error(
          `펀딩 캠페인 초기화 실패(${id}): ${res.rowsAffected}개 행이 갱신됐다(1이어야 한다). ` +
            'seed-authz-fixtures.mjs를 먼저 돌렸는지 확인할 것.'
        )
      }
    }
    // 정산 캠페인은 정산서까지 지운다 — 남겨 두면 다음 실행에서 '이미 지급이
    // 끝난 정산 내역'이라 다시 정리할 수 없어 스위트가 한 번만 돈다.
    await client.execute({
      sql: 'DELETE FROM funding_settlements WHERE campaign_id = ?',
      args: [fixtures.fundingSettleCampaignId],
    })
  } finally {
    client.close()
  }
}

test.describe('펀딩 — 관리자 전용 동작은 마이페이지 라우트로 들어오지 못한다', () => {
  test.afterAll(async () => {
    await resetAdminActionCampaigns()
  })

  for (const { action, campaignId, from, to } of ADMIN_ONLY_ACTIONS) {
    test(`${action} — 개설자가 마이페이지 라우트로 보내면 403이고 상태는 그대로다. 관리자 라우트로는 통한다`, async ({
      baseURL,
    }) => {
      const ownerContext = await apiRequest.newContext({
        baseURL,
        storageState: storageStatePath('owner'),
      })
      const adminContext = await apiRequest.newContext({
        baseURL,
        storageState: storageStatePath('admin'),
      })
      try {
        // 시작 상태가 전제대로인지 먼저 본다 — 아니면 아래 403이 "막았다"가
        // 아니라 "전이표가 400으로 끊었다"일 수 있다.
        const before = await readCampaignRow(campaignId)
        expect(before?.status, `${action} 시작 상태`).toBe(from)
        // 그리고 이 캠페인의 개설자가 정말 `owner`인지 — 아니면 403이 행위자
        // 판정이 아니라 소유권 판정(404)에서 나올 수 있다.
        expect(before?.owner_user_id).toBe(fixtures.users.owner)

        // 금지 쪽: 캠페인 주인이 자기 캠페인에 관리자 전용 동작을 보낸다.
        const denied = await ownerContext.post(
          `/api/mypage/funding/campaigns/${campaignId}/transition`,
          { data: { action } }
        )
        expect(denied.status(), `${action} 거부 코드`).toBe(403)
        expect((await denied.json()).error).toContain('권한이 없습니다')

        // 짝: 403을 돌려주면서 실제로는 옮겨버리는 모양을 코드만으로는 구분할
        // 수 없다 — DB를 직접 읽는다.
        const afterDenied = await readCampaignRow(campaignId)
        expect(afterDenied?.status, `${action} 거부 후 상태`).toBe(from)

        // 정산 완료(`settle`)는 **지급까지 끝난 정산 내역**이 있어야 통과한다
        // (`src/lib/funding/campaignPreconditions.ts`). 기록 없이 '정산 완료'
        // 딱지만 붙는 일을 막는 규칙이라, 허용 쪽을 확인하기 전에 그 기록을
        // 관리자 라우트로 실제로 만든다 — 그 두 라우트도 관리자 전용이다.
        if (action === 'settle') {
          const blocked = await adminContext.post(
            `/api/admin/funding/campaigns/${campaignId}/transition`,
            { data: { action } }
          )
          expect(blocked.status(), '정산 내역 없이 정산 완료').toBe(400)
          expect((await blocked.json()).error).toContain('정산 내역을 먼저 정리')

          const prepared = await adminContext.post(
            `/api/admin/funding/campaigns/${campaignId}/settlement`,
            { data: { pg_fee_amount: 0, memo: 'authz 픽스처 정산' } }
          )
          expect(prepared.status(), '정산 내역 정리').toBe(200)
          // 픽스처 개설자는 프로필에 계좌를 등록한 적이 없다. 그 상태로 지급을
          // 기록하려 들면 서버가 409로 한 번 세운다 — 조합이 "등록된 계좌로
          // 보냈다"고 주장하는 기록이 근거 없이 남는 것을 막는 자리다.
          const unacknowledged = await adminContext.patch(
            `/api/admin/funding/campaigns/${campaignId}/settlement`,
            { data: { action: 'mark_paid' } }
          )
          expect(unacknowledged.status(), '계좌 없이 지급 기록').toBe(409)
          expect((await unacknowledged.json()).error).toContain('등록해 둔 계좌가 없습니다')

          // 확인하고 다시 보내면 통과한다. 이체는 이미 손으로 끝난 일이라
          // 거절이 아니라 확인이고, 등록된 계좌가 없었다는 사실은 활동
          // 기록에 남는다.
          const paidOut = await adminContext.patch(
            `/api/admin/funding/campaigns/${campaignId}/settlement`,
            { data: { action: 'mark_paid', acknowledge_no_account: true } }
          )
          expect(paidOut.status(), '정산 지급 기록').toBe(200)
          expect((await paidOut.json()).data?.settlement?.status).toBe('paid')
        }

        // 허용 쪽: 같은 동작이 관리자 라우트로는 통한다. 이 단정이 없으면
        // 게이트가 "전부 막기"로 퇴화해도 위 부정 단정은 그대로 초록불이다.
        const allowed = await adminContext.post(
          `/api/admin/funding/campaigns/${campaignId}/transition`,
          { data: await adminTransitionBody(action, adminContext, campaignId) }
        )
        expect(allowed.status(), `${action} 허용 코드`).toBe(200)
        expect((await allowed.json()).data?.campaign?.status).toBe(to)

        const afterAllowed = await readCampaignRow(campaignId)
        expect(afterAllowed?.status, `${action} 허용 후 상태`).toBe(to)
      } finally {
        await ownerContext.dispose()
        await adminContext.dispose()
      }
    })
  }
})

/**
 * **후원 취소 경계** — `POST /api/funding/pledges/cancel`.
 *
 * 이 라우트는 `getOptionalUser()`로 요청자를 알아본다. 그 함수는 아무도 막지
 * 않는다. "내 후원"과 "아무의 후원"을 가르는 것은 `canViewPledge` 한 번뿐이고,
 * 그 줄을 지우면 후원 id를 아는 로그인 사용자가 남의 결제를 환불시킬 수 있다.
 * 개설자 화면(`GET /api/mypage/funding/campaigns/[id]`)이 자기 캠페인의 후원
 * id를 전부 건네주므로 그 id를 구하는 일은 어렵지 않다. 이번 회차 전까지
 * `e2e/` 어느 스펙도 `/api/funding/pledges/*`를 한 번도 부르지 않았다.
 *
 * ## 허용 쪽이 400인 이유 — 여기서 증명하는 것과 증명하지 않는 것
 *
 * 취소의 성공 경로는 토스에 **실제 환불**을 요청한다. 토스 클라이언트의
 * 주소(`https://api.tosspayments.com`)는 상수라 로컬로 돌릴 수 없으므로
 * E2E가 그 경로를 끝까지 탈 수는 없다. 그래서 픽스처 후원에는 결제
 * 연결(`payment_id`)을 두지 않았다 — 라우트는 신원 확인과 상태·캠페인·배송
 * 검사를 **전부 지난 뒤** 400 `결제 정보를 확인할 수 없습니다`로 끝난다.
 *
 * - **증명한다**: 요청자가 신원 관문을 지났는가. 거부(404 `찾을 수 없습니다`)와
 *   글자 단위로 다른 답이므로, `canViewPledge`를 지우면 거부 쪽이 이 400으로
 *   바뀌어 테스트가 빨간불이 된다.
 * - **증명하지 않는다**: 환불이 실제로 나가는지, 원장이 맞게 적히는지. 그건
 *   `scripts/testing/queriesFundingPledges.test.mjs`(쿼리 계층)와 사람의 손이
 *   본다.
 *
 * 선점(`claimPledgeForCancel`)은 이 400보다 **뒤**에 있으므로 어느 쪽 요청도
 * 후원 행을 바꾸지 않는다 — 그래도 매번 DB를 다시 읽어 확인한다.
 */
const PLEDGE_NOT_FOUND = '후원 내역을 찾을 수 없습니다.'
const PLEDGE_NO_PAYMENT = '결제 정보를 확인할 수 없습니다. 사무국으로 문의해 주세요.'

async function readPledgeRow(id: string) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: `SELECT status, fulfillment_status, canceled_at, refunded_at, user_id
              FROM funding_pledges WHERE id = ?`,
      args: [id],
    })
    return res.rows[0] ?? null
  } finally {
    client.close()
  }
}

/** 후원 둘을 시드가 심은 상태(결제 완료, 배송 전, 결제 연결 없음)로 되돌린다. */
async function resetPledges(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    for (const id of [fixtures.fundingMemberPledgeId, fixtures.fundingGuestPledgeId]) {
      const res = await client.execute({
        sql: `UPDATE funding_pledges
                 SET status = 'paid', fulfillment_status = 'none',
                     canceled_at = NULL, refunded_at = NULL, payment_id = NULL
               WHERE id = ?`,
        args: [id],
      })
      if (res.rowsAffected !== 1) {
        throw new Error(
          `후원 초기화 실패(${id}): ${res.rowsAffected}개 행이 갱신됐다(1이어야 한다). ` +
            'seed-authz-fixtures.mjs를 먼저 돌렸는지 확인할 것.'
        )
      }
    }
  } finally {
    client.close()
  }
}

test.describe('펀딩 — 후원 취소 경계', () => {
  test.afterAll(async () => {
    await resetPledges()
  })

  test('회원 후원은 본인만 취소를 시작한다 — 캠페인 개설자도 남의 후원은 못 건드린다', async ({
    baseURL,
  }) => {
    // 거부당하는 쪽이 **캠페인 개설자**다. 감사가 짚은 경로가 "개설자 화면이
    // 후원 id를 전부 건네준다"이므로, 남남인 제3자보다 이쪽이 실제 위험이다.
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    const backerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    try {
      const before = await readPledgeRow(fixtures.fundingMemberPledgeId)
      expect(before?.status).toBe('paid')
      expect(before?.user_id).toBe(fixtures.users.other)

      const denied = await ownerContext.post('/api/funding/pledges/cancel', {
        data: { pledgeId: fixtures.fundingMemberPledgeId },
      })
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toBe(PLEDGE_NOT_FOUND)

      // 짝: 404를 돌려주면서 실제로는 선점해버리는 모양을 코드만으로는 구분할
      // 수 없다.
      const afterDenied = await readPledgeRow(fixtures.fundingMemberPledgeId)
      expect(afterDenied?.status).toBe('paid')
      expect(afterDenied?.canceled_at).toBeNull()

      // 허용 쪽: 후원자 본인은 신원 관문을 지난다(위 주석의 400).
      const allowed = await backerContext.post('/api/funding/pledges/cancel', {
        data: { pledgeId: fixtures.fundingMemberPledgeId },
      })
      expect(allowed.status()).toBe(400)
      expect((await allowed.json()).error).toBe(PLEDGE_NO_PAYMENT)

      const afterAllowed = await readPledgeRow(fixtures.fundingMemberPledgeId)
      expect(afterAllowed?.status).toBe('paid')
    } finally {
      await ownerContext.dispose()
      await backerContext.dispose()
    }
  })

  test('비회원 후원은 후원번호와 이메일이 둘 다 맞아야 한다', async ({ baseURL }) => {
    // 세션 없는 요청이다 — 비회원 경로의 열쇠는 번호+이메일 한 쌍뿐이다.
    const anonContext = await apiRequest.newContext({ baseURL })
    try {
      expect((await readPledgeRow(fixtures.fundingGuestPledgeId))?.status).toBe('paid')

      // 번호는 맞고 이메일이 틀린 경우. 이 짝이 없으면 조회가 번호 하나로
      // 무너져도(= `lower(backer_email) = lower(?)` 조건이 사라져도) 아래
      // 허용 단정만 초록불로 남는다.
      const wrongEmail = await anonContext.post('/api/funding/pledges/cancel', {
        data: {
          pledgeCode: fixtures.fundingGuestPledgeCode,
          email: 'authz-not-the-backer@test.local',
        },
      })
      expect(wrongEmail.status()).toBe(404)
      expect((await wrongEmail.json()).error).toBe(PLEDGE_NOT_FOUND)

      // 이메일은 맞고 번호가 틀린 경우 — 같은 답이어야 한다(번호의 존재
      // 여부가 새면 추측이 쉬워진다).
      const wrongCode = await anonContext.post('/api/funding/pledges/cancel', {
        data: { pledgeCode: 'FND-20260901-ZZZZZZZZ', email: fixtures.fundingGuestBackerEmail },
      })
      expect(wrongCode.status()).toBe(404)
      expect((await wrongCode.json()).error).toBe(PLEDGE_NOT_FOUND)

      const afterDenied = await readPledgeRow(fixtures.fundingGuestPledgeId)
      expect(afterDenied?.status).toBe('paid')
      expect(afterDenied?.canceled_at).toBeNull()

      // 허용 쪽: 둘 다 맞으면 신원 관문을 지난다.
      const allowed = await anonContext.post('/api/funding/pledges/cancel', {
        data: {
          pledgeCode: fixtures.fundingGuestPledgeCode,
          email: fixtures.fundingGuestBackerEmail,
        },
      })
      expect(allowed.status()).toBe(400)
      expect((await allowed.json()).error).toBe(PLEDGE_NO_PAYMENT)

      expect((await readPledgeRow(fixtures.fundingGuestPledgeId))?.status).toBe('paid')
    } finally {
      await anonContext.dispose()
    }
  })

  /**
   * **세션은 신원이다.** 번호+이메일 경로는 인증할 수 없는 사람을 위한
   * 길이지, 인증할 수 있는 사람에게 열린 두 번째 문이 아니다.
   *
   * 4차 감사에서 확인한 실제 경로다 — 개설자 화면이 결제 완료 후원의
   * `pledge_code`를 전부 주고 배송 리워드면 `backer_email`까지 줬다. 그 둘을
   * 쥔 개설자가 `pledgeId` 대신 번호+이메일을 보내면 `canViewPledge`를 보지
   * 않는 갈래로 우회해 자기 후원자의 결제를 전액 환불시킬 수 있었다.
   *
   * 두 곳을 함께 닫았고 **한쪽만으로는 닫히지 않는다** — 이메일만 빼면 번호는
   * 여전히 화면에 있고(다른 경로로 이메일을 알면 그만이다), 라우트만 고치면
   * 개설자 화면은 계속 남의 결제 열쇠를 화면에 뿌린다.
   */
  test('개설자는 후원번호와 이메일로도 남의 후원을 취소하지 못한다 — 임자 있는 후원은 세션이 임자일 때만', async ({
    baseURL,
  }) => {
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    const backerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    try {
      // 금지 쪽: 캠페인 개설자가 자기 후원자의 번호+이메일을 그대로 보낸다.
      // 둘 다 맞는 값이다 — 막는 것은 값의 정확성이 아니라 임자 판정이다.
      const denied = await ownerContext.post('/api/funding/pledges/cancel', {
        data: {
          pledgeCode: fixtures.fundingMemberPledgeCode,
          email: fixtures.fundingMemberBackerEmail,
        },
      })
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toBe(PLEDGE_NOT_FOUND)

      const afterDenied = await readPledgeRow(fixtures.fundingMemberPledgeId)
      expect(afterDenied?.status).toBe('paid')
      expect(afterDenied?.canceled_at).toBeNull()

      // 허용 쪽: 같은 번호+이메일을 **후원자 본인**이 보내면 지난다. 이 단정이
      // 없으면 갈래를 통째로 막아도(= 회원 후원은 번호+이메일로 영영 못 건드리게
      // 해도) 위 부정 단정은 초록불이다. 후원자에게 열린 두 길(후원 id·번호+이메일)이
      // 둘 다 살아 있어야 한다 — 앞 테스트가 후원 id 쪽을 본다.
      const allowed = await backerContext.post('/api/funding/pledges/cancel', {
        data: {
          pledgeCode: fixtures.fundingMemberPledgeCode,
          email: fixtures.fundingMemberBackerEmail,
        },
      })
      expect(allowed.status()).toBe(400)
      expect((await allowed.json()).error).toBe(PLEDGE_NO_PAYMENT)

      expect((await readPledgeRow(fixtures.fundingMemberPledgeId))?.status).toBe('paid')
    } finally {
      await ownerContext.dispose()
      await backerContext.dispose()
    }
  })

  /**
   * **개설자 화면은 후원자 이메일을 싣지 않는다.**
   *
   * 택배를 부치는 데 필요한 것은 받는 사람 이름·전화번호·주소이고 그 셋은
   * 그대로 간다. 이메일은 거기에 보태는 편의였는데, 같은 화면이 주는
   * `pledge_code`와 짝이 되는 순간 남의 결제를 환불하는 열쇠가 된다.
   *
   * 값을 치른다 — 개설자가 후원자에게 메일로 연락할 길이 화면에서 사라진다.
   * 그런 일은 사무국을 거친다. 의도한 맞바꿈이라 여기 적어 둔다.
   */
  test('개설자 화면은 후원자 이메일을 싣지 않는다 — 배송에 필요한 것만 간다', async ({
    baseURL,
  }) => {
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    try {
      const res = await ownerContext.get(
        `/api/mypage/funding/campaigns/${fixtures.fundingActiveCampaignId}`
      )
      expect(res.status()).toBe(200)
      const bodyText = await res.text()
      const body = JSON.parse(bodyText)
      const pledges = body.data?.pledges as Array<Record<string, unknown>>
      const mine = pledges.find(p => p.pledge_code === fixtures.fundingMemberPledgeCode)
      expect(mine, '개설자 화면에 그 후원이 보이지 않는다 — 시드를 확인할 것').toBeTruthy()

      // 먼저 **배송 묶음이 실제로 실려 있는지** 본다. 이 리워드가 배송이
      // 아니면 아래 단정이 게이트와 무관하게 공허하게 통과한다.
      expect(mine!.shipping_address1).toBeTruthy()
      expect(mine!.shipping_phone).toBeTruthy()

      expect(mine!.backer_email).toBeUndefined()
      // 키 이름을 바꿔 같은 값을 다시 싣는 길도 막는다 — 응답 어디에도
      // 후원자 이메일 문자열이 없어야 한다.
      expect(bodyText).not.toContain(fixtures.fundingMemberBackerEmail)
      expect(bodyText).not.toContain(fixtures.fundingGuestBackerEmail)
    } finally {
      await ownerContext.dispose()
    }
  })
})

/**
 * **공개 상세가 리워드 행을 그대로 내보내지 않는다** —
 * `GET /api/funding/campaigns/[slug]`.
 *
 * 2차 수리가 `toPublicReward`로 싣는 목록을 만들었지만, 라우트가 그 함수를
 * 실제로 부르는지 보는 테스트는 없었다. `...r`로 되돌리면 `locked_at`이 다시
 * 공개 응답에 실리는데 단위 테스트는 전부 초록불이다(순수 함수는 멀쩡하니까).
 * 그래서 **응답 본문**을 본다.
 *
 * `locked_at`이 새면 공개 후원자 명단의 `paid_at`과 시각으로 맞춰져 "이
 * 리워드를 처음 잠근 후원자"가 특정된다 — 이름이 걸린 사람을 특정 금액에
 * 묶을 수 있다.
 */
test.describe('펀딩 — 공개 상세 응답', () => {
  test('공개 상세는 리워드의 내부 필드를 싣지 않는다 — locked_at이 새지 않는다', async ({
    baseURL,
  }) => {
    const anonContext = await apiRequest.newContext({ baseURL })
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      // 먼저 표에 잠금이 실제로 찍혀 있는지 본다 — 비어 있으면 아래 단정이
      // 게이트 덕분인지 값이 없어서인지 구분되지 않는다(공허한 통과).
      const row = await client.execute({
        sql: 'SELECT locked_at FROM funding_rewards WHERE id = ?',
        args: [fixtures.fundingActiveRewardId],
      })
      expect(row.rows[0]?.locked_at, '픽스처 리워드에 잠금이 없다 — 시드를 확인할 것').toBeTruthy()

      const res = await anonContext.get(
        `/api/funding/campaigns/${fixtures.fundingActiveCampaignSlug}`
      )
      expect(res.status()).toBe(200)
      const text = await res.text()
      const rewards = JSON.parse(text).data?.rewards as Array<Record<string, unknown>>
      expect(Array.isArray(rewards)).toBe(true)
      expect(rewards.length).toBeGreaterThan(0)
      for (const reward of rewards) {
        expect(Object.keys(reward).sort()).toEqual([
          'amount',
          'description',
          'estimated_delivery',
          'id',
          'image_url',
          'remaining_quantity',
          'requires_shipping',
          'title',
          'total_quantity',
        ])
      }
      // 키 이름을 바꿔 같은 값을 다시 싣는 길도 막는다.
      expect(text).not.toContain('locked_at')
      expect(text).not.toContain('campaign_id')
    } finally {
      client.close()
      await anonContext.dispose()
    }
  })
})

/**
 * **승인은 관리자가 실제로 읽은 판에만 찍힌다** —
 * `POST /api/admin/funding/campaigns/[id]/transition`.
 *
 * `transitionCampaign`은 `expectedUpdatedAt`이 `undefined`면 조건이 없는
 * 것으로 보고 그냥 승인한다. 그래서 라우트의 `reviewedVersion` 블록을 지우면
 * 쿼리 계층 테스트는 전부 초록불인 채로 경계만 사라진다 — 관리자가 본 적 없는
 * 내용이 그대로 공개된다. 여기서는 **라우트에** 낡은 판 번호를 보낸다.
 */
test.describe('펀딩 — 승인은 심사한 판에만 찍힌다', () => {
  test.afterAll(async () => {
    await resetReviewCampaign()
  })

  test('낡은 판 번호로 보낸 승인은 409이고 상태는 그대로다. 지금 판 번호면 통한다', async ({
    baseURL,
  }) => {
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const id = fixtures.fundingReviewCampaignId
      expect((await readCampaignRow(id))?.status, '시작 상태').toBe('submitted')

      // 판 번호를 아예 빼면 400이다 — "조건 없음"으로 조용히 통과하지 않는다.
      const missing = await adminContext.post(`/api/admin/funding/campaigns/${id}/transition`, {
        data: { action: 'approve', slug: 'authz-e2e-funding-review-stale' },
      })
      expect(missing.status(), '판 번호 없음').toBe(400)
      expect((await missing.json()).error).toContain('판 정보가 없습니다')
      expect((await readCampaignRow(id))?.status).toBe('submitted')

      // 낡은 판 번호는 409다.
      const stale = await adminContext.post(`/api/admin/funding/campaigns/${id}/transition`, {
        data: {
          action: 'approve',
          slug: 'authz-e2e-funding-review-stale',
          reviewedVersion: new Date('1999-01-01T00:00:00.000Z').toISOString(),
        },
      })
      expect(stale.status(), '낡은 판 번호').toBe(409)
      expect((await stale.json()).error).toContain('심사하는 동안')
      expect((await readCampaignRow(id))?.status, '거부 후 상태').toBe('submitted')

      // 허용 쪽: 지금 판 번호면 승인된다. 이 단정이 없으면 승인을 통째로
      // 막아도 위 두 단정은 초록불이다.
      const allowed = await adminContext.post(`/api/admin/funding/campaigns/${id}/transition`, {
        data: {
          action: 'approve',
          slug: 'authz-e2e-funding-review-stale',
          reviewedVersion: await readCampaignVersion(adminContext, id),
        },
      })
      expect(allowed.status(), '지금 판 번호').toBe(200)
      expect((await readCampaignRow(id))?.status).toBe('active')
    } finally {
      await adminContext.dispose()
    }
  })
})

/**
 * **조회도 취소와 같은 규칙이다** — `POST /api/funding/pledges/lookup`.
 *
 * 번호+이메일은 인증할 수 없는 사람을 위한 길이지, 인증할 수 있는 사람에게
 * 열린 두 번째 문이 아니다. 취소에만 이 규칙을 적고 조회에 안 적으면 개설자가
 * 자기 후원자의 후원 상세를 계속 열어볼 수 있다.
 */
test.describe('펀딩 — 후원 조회 경계', () => {
  test('임자 있는 후원의 조회는 세션이 임자일 때만 지난다. 비회원 후원은 그대로 열린다', async ({
    baseURL,
  }) => {
    const ownerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('owner'),
    })
    const backerContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const anonContext = await apiRequest.newContext({ baseURL })
    try {
      const memberKey = {
        pledgeCode: fixtures.fundingMemberPledgeCode,
        email: fixtures.fundingMemberBackerEmail,
      }
      // 금지 쪽: 개설자가 맞는 번호+이메일을 보내도 못 본다.
      const denied = await ownerContext.post('/api/funding/pledges/lookup', { data: memberKey })
      expect(denied.status()).toBe(404)
      expect((await denied.json()).error).toBe(PLEDGE_NOT_FOUND)

      // 로그아웃 상태도 같다 — 임자가 있는 후원은 세션으로만 지난다.
      const loggedOut = await anonContext.post('/api/funding/pledges/lookup', { data: memberKey })
      expect(loggedOut.status()).toBe(404)

      // 허용 쪽 ①: 후원자 본인은 지난다.
      const mine = await backerContext.post('/api/funding/pledges/lookup', { data: memberKey })
      expect(mine.status()).toBe(200)
      expect((await mine.json()).data?.pledge?.pledge_code).toBe(fixtures.fundingMemberPledgeCode)

      // 허용 쪽 ②: 비회원 후원은 세션 없이 번호+이메일로 그대로 열린다.
      const guest = await anonContext.post('/api/funding/pledges/lookup', {
        data: {
          pledgeCode: fixtures.fundingGuestPledgeCode,
          email: fixtures.fundingGuestBackerEmail,
        },
      })
      expect(guest.status()).toBe(200)
      expect((await guest.json()).data?.pledge?.pledge_code).toBe(fixtures.fundingGuestPledgeCode)
    } finally {
      await ownerContext.dispose()
      await backerContext.dispose()
      await anonContext.dispose()
    }
  })
})
