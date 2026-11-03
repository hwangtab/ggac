import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()
const users = fixtures.users

/**
 * 조합원 타임뱅크(1-A)의 인가 경계(스펙 §7.2·§11, 계획 Task 13).
 *
 * 장터 스펙(`authz-market.spec.ts`)처럼 상태 코드와 메시지를 **정확히** 단정한다.
 * 실패 본문은 `{ success: false, error }`다. 화면 경계는 응답에 픽스처 제목이
 * **없는지**로 본다.
 *
 * 픽스처(`scripts/testing/seed-authz-fixtures.mjs`의 `seedTimebank`):
 * - 동의: admin·owner·other·withdrawalRequested·suspended(현재 판). director는 미동의.
 * - 원장: 대기(owner 기록 → 상대 other), 확정 교환(owner → other), 정지 회원이 당사자인
 *   대기 둘 — (a) suspended 기록·상대 other, (b) owner 기록·상대 suspended.
 *
 * **픽스처를 소모하는 테스트**(정지 회원 대기 (a)·(b))는 그 행만 쓴다. 나머지 상태
 * 변경은 테스트가 직접 만든 행으로 하고 그 자리에서 정리한다. 설정을 바꾸는 테스트는
 * 원래 값을 읽어 두었다가 `finally`에서 그대로 되돌린다. 원장 행·자원 기록은 시드가
 * 다음 실행 전에 지우고 다시 심는다(그래서 스위트는 시드 뒤에 돈다 — 다른 authz
 * 스펙과 같다).
 */

const LISTING_TITLE = 'authz 픽스처 타임뱅크 글'
const PENDING_MEMO = 'authz 픽스처 대기 기록'
const SUSPENDED_A_MEMO = 'authz 픽스처 정지 회원 기록(a)'

const MSG = {
  unauthenticated: '인증이 필요합니다.',
  notMember: '승인된 조합원만 이용할 수 있습니다.',
  disabled: '타임뱅크가 지금 꺼져 있습니다.',
  notAgreed: '타임뱅크 이용규칙에 먼저 동의해 주세요.',
  termsOutdated: '바뀐 이용규칙에 다시 동의해 주세요.',
  frozen: '탈퇴 신청 중에는 타임뱅크를 이용할 수 없습니다.',
  notCounterparty: '이 기록은 상대 당사자만 확인하거나 거절할 수 있습니다.',
  notRecorder: '이 기록은 남긴 사람만 취소할 수 있습니다.',
  notPending: '이미 처리된 기록입니다.',
  counterpartyNotParticipant: '상대가 지금 타임뱅크에 참여할 수 없는 상태입니다.',
  self: '자기 자신과는 기록할 수 없습니다.',
  coopTaskByMember: '조합 업무는 관리자 화면에서 올립니다.',
  adminOnly: '관리자 권한이 필요합니다.',
  boardRoomOnly: '이사회 접근 권한이 없습니다.',
  notVolunteer: '이 조합원은 이 조합 업무에 자원한 기록이 없습니다.',
  selfApproval: '조정은 만든 사람도 대상도 아닌 다른 관리자가 승인해야 합니다.',
  volunteerOff: '조합 업무 참여가 지금 꺼져 있습니다.',
  coopCreditOff: '조합 업무 크레딧이 지금 꺼져 있습니다.',
} as const

const listing = () => `/api/timebank/listings/${fixtures.timebankListingId}`
const transferAction = (id: string, action: 'confirm' | 'reject' | 'cancel') =>
  `/api/timebank/transfers/${id}/${action}`

/** 회원 읽기 경로. 비회원·미승인·정지는 전부 같은 401/403이어야 한다. */
const READ_PATHS = () => [
  '/api/timebank/listings',
  listing(),
  `${listing()}/comments`,
  '/api/timebank/me',
  '/api/timebank/me/transfers',
  '/api/timebank/me/transfers.csv',
  '/api/timebank/me/pending',
  '/api/timebank/participants',
  '/api/timebank/directory',
  '/api/timebank/profile',
  '/api/timebank/stats',
]

/** 정상 형식의 기록 본문(인가 판정 뒤로 넘어가도 400이 나지 않는 모양). */
const recordBody = (counterpartyId: string, extra: Record<string, unknown> = {}) => ({
  counterparty_id: counterpartyId,
  role: 'received',
  minutes: 30,
  category: 'lesson',
  ...extra,
})

const listingBody = {
  kind: 'offer',
  category: 'lesson',
  title: 'authz 경계 확인 글',
  description: '경계 확인',
}

async function errorOf(res: { json: () => Promise<unknown> }): Promise<string> {
  return ((await res.json()) as { error: string }).error
}

// ── DB 직접 조작(설정 스위치·원장 행 확인) ──────────────────────────────────

async function withDb<T>(fn: (db: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

/**
 * `features/timebank_features`를 **읽은 값 위에** 덮어쓰고, 원래 값으로 되돌리는
 * 함수를 돌려준다. 영향 행 수를 확인한다 — 시드가 행을 만들지 않으면 UPDATE는
 * 0행에 적용되고, 그 상태로도 "꺼짐 403" 계열 단정은 기본값(꺼짐) 덕분에 통과해
 * 스펙이 조용히 아무것도 검사하지 않는다(`authz-features.spec.ts`와 같은 이유).
 *
 * 설정 캐시는 E2E 서버에서 0이다(`SETTINGS_CACHE_TTL_MS=0`, `playwright.config.ts`).
 */
async function patchTimebankSettings(patch: Record<string, unknown>): Promise<() => Promise<void>> {
  const write = (value: string) =>
    withDb(async db => {
      const res = await db.execute({
        sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
              WHERE category = 'features' AND setting_key = 'timebank_features'`,
        args: [value, Date.now()],
      })
      if (res.rowsAffected !== 1) {
        throw new Error(
          `타임뱅크 설정 쓰기 실패: system_settings(features/timebank_features) 행이 ` +
            `${res.rowsAffected}개 갱신됐다. 픽스처 시드를 먼저 돌렸는지 확인할 것.`
        )
      }
    })
  const original = await withDb(async db => {
    const res = await db.execute(
      `SELECT setting_value FROM system_settings
       WHERE category = 'features' AND setting_key = 'timebank_features'`
    )
    if (res.rows.length !== 1) throw new Error('타임뱅크 설정 행이 없다 — 시드를 먼저 돌릴 것.')
    return String(res.rows[0].setting_value)
  })
  await write(JSON.stringify({ ...JSON.parse(original), ...patch }))
  return () => write(original)
}

async function readTransfer(id: string) {
  return withDb(async db => {
    const res = await db.execute({
      sql: `SELECT from_account, to_account, kind, status, created_by, counterparty_id
            FROM timebank_transfers WHERE id = ?`,
      args: [id],
    })
    return res.rows[0] as unknown as
      | {
          from_account: string
          to_account: string
          kind: string
          status: string
          created_by: string
          counterparty_id: string | null
        }
      | undefined
  })
}

/** 다른 계정의 요청 컨텍스트(한 테스트 안에서 두 사람이 번갈아 행동할 때). */
async function as(role: string, baseURL: string | undefined): Promise<APIRequestContext> {
  return apiRequest.newContext({ baseURL, storageState: storageStatePath(role) })
}

/** 정리용: owner가 남긴 대기 기록을 owner가 취소한다(실패해도 시드가 지운다). */
async function cancelAs(ctx: APIRequestContext, id: string) {
  await ctx.post(transferAction(id, 'cancel'))
}

// ── 비로그인 ─────────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 비로그인', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('회원 API는 읽기·쓰기 전부 401이다', async ({ request }) => {
    for (const path of READ_PATHS()) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(401)
      expect(await errorOf(res), path).toBe(MSG.unauthenticated)
    }
    const writes = [
      () => request.post('/api/timebank/listings', { data: listingBody }),
      () => request.post('/api/timebank/transfers', { data: recordBody(users.owner) }),
      () => request.post(transferAction(fixtures.timebankPendingId, 'confirm')),
      () => request.post(transferAction(fixtures.timebankPendingId, 'reject')),
      () => request.post('/api/timebank/agree', { data: { terms_version: '2026-11' } }),
    ]
    for (const send of writes) {
      const res = await send()
      expect(res.status()).toBe(401)
    }
  })

  test('상세 화면은 로그인으로 보내고 글을 그리지 않는다', async ({ page }) => {
    await page.goto(`/board/timebank/${fixtures.timebankListingId}`)
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByText(LISTING_TITLE)).toHaveCount(0)
  })

  test('타임뱅크 글 id로 게시판 상세(/board/[id])를 열어도 나오지 않는다', async ({ request }) => {
    // 타임뱅크 글은 `posts`가 아니라 별도 표다. 게시판의 공개·ISR 경로로 새지 않는다.
    const res = await request.get(`/api/posts/${fixtures.timebankListingId}`)
    expect(res.status()).toBe(404)
    const html = await (await request.get(`/board/${fixtures.timebankListingId}`)).text()
    expect(html).not.toContain(LISTING_TITLE)
  })
})

// ── 미승인 ───────────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 미승인 회원', () => {
  test.use({ storageState: storageStatePath('pending') })

  test('API는 읽기·쓰기 전부 403 + 승인 조합원 메시지다', async ({ request }) => {
    for (const path of READ_PATHS()) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(403)
      expect(await errorOf(res), path).toBe(MSG.notMember)
    }
    const record = await request.post('/api/timebank/transfers', { data: recordBody(users.owner) })
    expect(record.status()).toBe(403)
    expect(await errorOf(record)).toBe(MSG.notMember)
  })

  test('상세 화면은 게이트만 그리고 글은 그리지 않는다', async ({ page }) => {
    await page.goto(`/board/timebank/${fixtures.timebankListingId}`)
    await expect(
      page.locator('[data-testid="timebank-gate"][data-state="unapproved"]')
    ).toBeVisible()
    await expect(page.getByText(LISTING_TITLE)).toHaveCount(0)
  })
})

// ── 미동의(director) ─────────────────────────────────────────────────────────

test.describe('타임뱅크 — 미동의 조합원(director)', () => {
  test.use({ storageState: storageStatePath('director') })

  test('읽기는 200이다', async ({ request }) => {
    for (const path of [
      '/api/timebank/listings',
      listing(),
      `${listing()}/comments`,
      '/api/timebank/me',
      '/api/timebank/me/transfers',
      '/api/timebank/me/pending',
      '/api/timebank/profile',
      '/api/timebank/stats',
    ]) {
      expect((await request.get(path)).status(), path).toBe(200)
    }
  })

  test('참여자 명단·재능 디렉터리는 동의자끼리라 403이다', async ({ request }) => {
    for (const path of ['/api/timebank/participants', '/api/timebank/directory']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(403)
      expect(await errorOf(res), path).toBe(MSG.notAgreed)
    }
  })

  test('글쓰기·기록·확인은 403 + 동의 안내다', async ({ request }) => {
    const sends = [
      request.post('/api/timebank/listings', { data: listingBody }),
      request.post('/api/timebank/transfers', { data: recordBody(users.owner) }),
      request.post(`${listing()}/comments`, { data: { content: '미동의 댓글' } }),
      request.post(transferAction(fixtures.timebankPendingId, 'confirm')),
    ]
    for (const res of await Promise.all(sends)) {
      expect(res.status(), res.url()).toBe(403)
      expect(await errorOf(res), res.url()).toBe(MSG.notAgreed)
    }
  })
})

// ── 구판 동의 ────────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 이용규칙 판이 바뀐 뒤', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('구판 동의자의 기록은 403 + 재동의 안내, 읽기는 200이다', async ({ request }) => {
    const restore = await patchTimebankSettings({ terms_version: 'authz-e2e-next' })
    try {
      const record = await request.post('/api/timebank/transfers', {
        data: recordBody(users.other),
      })
      expect(record.status()).toBe(403)
      expect(await errorOf(record)).toBe(MSG.termsOutdated)

      const write = await request.post('/api/timebank/listings', { data: listingBody })
      expect(write.status()).toBe(403)
      expect(await errorOf(write)).toBe(MSG.termsOutdated)

      // 명단도 "현재 판 동의자끼리"다.
      const peers = await request.get('/api/timebank/participants')
      expect(peers.status()).toBe(403)
      expect(await errorOf(peers)).toBe(MSG.termsOutdated)

      expect((await request.get('/api/timebank/me')).status()).toBe(200)
      expect((await request.get(listing())).status()).toBe(200)
    } finally {
      await restore()
    }
    // 짝: 되돌린 뒤에는 같은 계정이 명단을 본다 — 403이 늘 나는 라우트가 아니다.
    expect((await request.get('/api/timebank/participants')).status()).toBe(200)
  })
})

// ── 탈퇴 신청 중 ─────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 탈퇴 신청 중(withdrawalRequested)', () => {
  test.use({ storageState: storageStatePath('withdrawalRequested') })

  test('기록·확인·글쓰기는 403 + 동결 안내다', async ({ request }) => {
    const sends = [
      request.post('/api/timebank/transfers', { data: recordBody(users.owner) }),
      request.post(transferAction(fixtures.timebankPendingId, 'confirm')),
      request.post('/api/timebank/listings', { data: listingBody }),
    ]
    for (const res of await Promise.all(sends)) {
      expect(res.status(), res.url()).toBe(403)
      expect(await errorOf(res), res.url()).toBe(MSG.frozen)
    }
  })

  test('읽기는 200이다', async ({ request }) => {
    for (const path of ['/api/timebank/listings', listing(), '/api/timebank/me']) {
      expect((await request.get(path)).status(), path).toBe(200)
    }
  })
})

// ── 정지(결정 6) ─────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 정지 회원(suspended)', () => {
  test.use({ storageState: storageStatePath('suspended') })

  test('모든 회원 API가 읽기·쓰기 403이다(정지는 is_active=false)', async ({ request }) => {
    for (const path of READ_PATHS()) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(403)
      expect(await errorOf(res), path).toBe(MSG.notMember)
    }
    const { bySuspended, toSuspended } = fixtures.timebankSuspendedPendingIds
    const sends = [
      request.post('/api/timebank/transfers', { data: recordBody(users.other) }),
      request.post('/api/timebank/listings', { data: listingBody }),
      request.post('/api/timebank/agree', { data: { terms_version: '2026-11' } }),
      // 자기 대기 건의 결정도 정지 상태에선 앞단에서 막힌다.
      request.post(transferAction(toSuspended, 'confirm')),
      request.post(transferAction(bySuspended, 'cancel')),
    ]
    for (const res of await Promise.all(sends)) {
      expect(res.status(), res.url()).toBe(403)
      expect(await errorOf(res), res.url()).toBe(MSG.notMember)
    }
  })

  test('마이페이지 타임 화면은 열리지 않는다(승인 대기 안내로 보낸다)', async ({ page }) => {
    // `/mypage`는 미들웨어가 승인·활성 조합원 전용으로 묶는다 — 정지(is_active=false)는
    // 화면의 `TimebankGate`에 닿기 전에 `/register/pending`으로 간다.
    await page.goto('/mypage/timebank')
    await expect(page).toHaveURL(/\/register\/pending$/)
    await expect(page.getByText(PENDING_MEMO)).toHaveCount(0)
  })

  test('게시판 상세 화면은 게이트만 그린다', async ({ page }) => {
    await page.goto(`/board/timebank/${fixtures.timebankListingId}`)
    await expect(
      page.locator('[data-testid="timebank-gate"][data-state="unapproved"]')
    ).toBeVisible()
    await expect(page.getByText(LISTING_TITLE)).toHaveCount(0)
  })
})

test.describe('타임뱅크 — 정지 회원이 당사자인 대기 기록', () => {
  test('상대(other)의 확인은 거부되고(확인 시점 재판정), 거절은 200이다', async ({ baseURL }) => {
    const other = await as('other', baseURL)
    try {
      const id = fixtures.timebankSuspendedPendingIds.bySuspended
      const confirm = await other.post(transferAction(id, 'confirm'))
      // 확인자 기준 판정이라 정지 회원은 "상대" 쪽이다(`evaluateTransfer`의 recorder_id = 확인자).
      expect(confirm.status()).toBe(409)
      expect(await errorOf(confirm)).toBe(MSG.counterpartyNotParticipant)
      expect((await readTransfer(id))?.status).toBe('pending')

      // §7.2: 거절은 막지 않는다.
      const reject = await other.post(transferAction(id, 'reject'))
      expect(reject.status()).toBe(200)
      expect((await readTransfer(id))?.status).toBe('rejected')
    } finally {
      await other.dispose()
    }
  })

  test('기록자(owner)는 정지 회원에게 남긴 대기 기록을 취소할 수 있다', async ({ baseURL }) => {
    const owner = await as('owner', baseURL)
    try {
      const id = fixtures.timebankSuspendedPendingIds.toSuspended
      const res = await owner.post(transferAction(id, 'cancel'))
      expect(res.status()).toBe(200)
      expect((await readTransfer(id))?.status).toBe('canceled')
    } finally {
      await owner.dispose()
    }
  })
})

// ── 기록 위조·자기 기록 ──────────────────────────────────────────────────────

test.describe('타임뱅크 — 기록 본문 위조', () => {
  test('kind·from·to·coop·created_by를 보내도 역할과 세션으로만 정해진다', async ({ baseURL }) => {
    const other = await as('other', baseURL)
    const owner = await as('owner', baseURL)
    let createdId: string | null = null
    try {
      const res = await other.post('/api/timebank/transfers', {
        data: {
          counterparty_id: users.owner,
          role: 'gave',
          minutes: 60,
          // 아래는 전부 버려져야 한다. 방향은 역할과 **반대**로 적었다.
          kind: 'coop_task',
          from_account: users.other,
          to_account: users.owner,
          coop: true,
          created_by: users.admin,
          status: 'confirmed',
        },
      })
      expect(res.status()).toBe(201)
      const view = (await res.json()).data.transfer
      createdId = view.id
      expect(view.kind).toBe('exchange')
      expect(view.status).toBe('pending')
      // other가 "해 줬다" → 받은 쪽은 other, 낸 쪽은 owner.
      expect(view.direction).toBe('in')
      expect(view.counterparty.id).toBe(users.owner)

      const row = await readTransfer(view.id)
      expect(row).toMatchObject({
        from_account: users.owner,
        to_account: users.other,
        kind: 'exchange',
        status: 'pending',
        created_by: users.other,
        counterparty_id: users.owner,
      })

      // 상대(owner)가 거절해 정리한다.
      const reject = await owner.post(transferAction(view.id, 'reject'))
      expect(reject.status()).toBe(200)
      createdId = null
    } finally {
      if (createdId) await cancelAs(other, createdId)
      await other.dispose()
      await owner.dispose()
    }
  })

  test.describe('자기 자신', () => {
    test.use({ storageState: storageStatePath('owner') })

    test('자기 자신과의 기록은 400이다', async ({ request }) => {
      const res = await request.post('/api/timebank/transfers', { data: recordBody(users.owner) })
      expect(res.status()).toBe(400)
      expect(await errorOf(res)).toBe(MSG.self)
    })
  })
})

// ── 확인·거절·취소 권한 ──────────────────────────────────────────────────────

test.describe('타임뱅크 — 확인·거절·취소 권한', () => {
  test('기록자(owner)는 자기 기록을 확인·거절하지 못한다', async ({ baseURL }) => {
    const owner = await as('owner', baseURL)
    try {
      for (const action of ['confirm', 'reject'] as const) {
        const res = await owner.post(transferAction(fixtures.timebankPendingId, action))
        expect(res.status(), action).toBe(403)
        expect(await errorOf(res), action).toBe(MSG.notCounterparty)
      }
      expect((await readTransfer(fixtures.timebankPendingId))?.status).toBe('pending')
    } finally {
      await owner.dispose()
    }
  })

  test('제3자(admin)는 확인·거절·취소 전부 403이다', async ({ baseURL }) => {
    // admin은 시드에서 현재 판에 동의해 있다 — 그래야 확인이 참여 판정(미동의 403)이
    // 아니라 원장의 당사자 판정에서 막히는지 본다.
    const admin = await as('admin', baseURL)
    try {
      const expected = {
        confirm: MSG.notCounterparty,
        reject: MSG.notCounterparty,
        cancel: MSG.notRecorder,
      } as const
      for (const action of ['confirm', 'reject', 'cancel'] as const) {
        const res = await admin.post(transferAction(fixtures.timebankPendingId, action))
        expect(res.status(), action).toBe(403)
        expect(await errorOf(res), action).toBe(expected[action])
      }
      expect((await readTransfer(fixtures.timebankPendingId))?.status).toBe('pending')
    } finally {
      await admin.dispose()
    }
  })

  test('상대(other)는 owner의 기록을 취소하지 못한다', async ({ baseURL }) => {
    const other = await as('other', baseURL)
    try {
      const res = await other.post(transferAction(fixtures.timebankPendingId, 'cancel'))
      expect(res.status()).toBe(403)
      expect(await errorOf(res)).toBe(MSG.notRecorder)
      expect((await readTransfer(fixtures.timebankPendingId))?.status).toBe('pending')
    } finally {
      await other.dispose()
    }
  })

  test('확정된 기록은 거절·취소·확인 전부 409다', async ({ baseURL }) => {
    const other = await as('other', baseURL)
    const owner = await as('owner', baseURL)
    try {
      const id = fixtures.timebankConfirmedId
      for (const [ctx, action] of [
        [other, 'reject'],
        [other, 'confirm'],
        [owner, 'cancel'],
      ] as const) {
        const res = await ctx.post(transferAction(id, action))
        expect(res.status(), action).toBe(409)
        expect(await errorOf(res), action).toBe(MSG.notPending)
      }
      expect((await readTransfer(id))?.status).toBe('confirmed')
    } finally {
      await other.dispose()
      await owner.dispose()
    }
  })

  test('상대(other)의 확인은 200이다(새로 만든 기록으로)', async ({ baseURL }) => {
    const owner = await as('owner', baseURL)
    const other = await as('other', baseURL)
    let createdId: string | null = null
    try {
      const created = await owner.post('/api/timebank/transfers', {
        data: recordBody(users.other, { memo: 'authz 확인 경계' }),
      })
      expect(created.status()).toBe(201)
      createdId = (await created.json()).data.transfer.id
      const res = await other.post(transferAction(createdId!, 'confirm'))
      expect(res.status()).toBe(200)
      expect((await res.json()).data.transfer.status).toBe('confirmed')
      expect((await readTransfer(createdId!))?.status).toBe('confirmed')
      createdId = null
    } finally {
      if (createdId) await cancelAs(owner, createdId)
      await owner.dispose()
      await other.dispose()
    }
  })
})

// ── 조합원이 관리자 경로를 두드린다 ──────────────────────────────────────────

test.describe('타임뱅크 — 조합원의 관리자 경로', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('조합원 글쓰기에 kind: coop_task를 보내면 400이다', async ({ request }) => {
    const res = await request.post('/api/timebank/listings', {
      data: { ...listingBody, kind: 'coop_task' },
    })
    expect(res.status()).toBe(400)
    expect(await errorOf(res)).toBe(MSG.coopTaskByMember)
  })

  test('조합 업무 글은 조합원 경로로 고치거나 지울 수 없다(404)', async ({ request }) => {
    const path = `/api/timebank/listings/${fixtures.timebankTaskId}`
    const edit = await request.patch(path, { data: { status: 'closed' } })
    expect(edit.status()).toBe(404)
    // owner는 작성자가 아니고 관리자도 아니다 — 판정 이전에 조합 업무라서 404다.
    const del = await request.delete(path)
    expect(del.status()).toBe(404)
  })

  test('/api/admin/timebank/* 는 전부 403이다', async ({ request }) => {
    const task = fixtures.timebankTaskId
    const pending = fixtures.timebankPendingId
    const sends = [
      request.get('/api/admin/timebank/accounts'),
      request.get('/api/admin/timebank/settings'),
      request.put('/api/admin/timebank/settings', {
        data: { settings: { enabled: false }, resolution_ref: '2026-11-02 이사회 1호' },
      }),
      request.get('/api/admin/timebank/tasks'),
      request.post('/api/admin/timebank/tasks', { data: { ...listingBody } }),
      request.get(`/api/admin/timebank/tasks/${task}/credit`),
      request.post(`/api/admin/timebank/tasks/${task}/credit`, {
        data: { member_id: users.owner, minutes: 60, memo: 'x', not_paid_elsewhere: true },
      }),
      request.post('/api/admin/timebank/adjust', {
        data: { member_id: users.owner, direction: 'credit', minutes: 60, memo: 'x' },
      }),
      request.post(`/api/admin/timebank/adjust/${pending}/approve`),
      request.post(`/api/admin/timebank/transfers/${pending}/cancel`, { data: { memo: 'x' } }),
    ]
    for (const res of await Promise.all(sends)) {
      expect(res.status(), res.url()).toBe(403)
      expect(await errorOf(res), res.url()).toBe(MSG.adminOnly)
    }
    expect((await readTransfer(pending))?.status).toBe('pending')
  })
})

// ── 관리자 ───────────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 관리자', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('본인 대상 조정은 400이다', async ({ request }) => {
    const res = await request.post('/api/admin/timebank/adjust', {
      data: { member_id: users.admin, direction: 'credit', minutes: 60, memo: '자기 적립 시도' },
    })
    expect(res.status()).toBe(400)
    expect(await errorOf(res)).toBe(MSG.self)
  })

  test('본인 대상 조합 업무 지급은 400이다', async ({ request }) => {
    const res = await request.post(`/api/admin/timebank/tasks/${fixtures.timebankTaskId}/credit`, {
      data: {
        member_id: users.admin,
        minutes: 60,
        memo: '자기 지급 시도',
        not_paid_elsewhere: true,
      },
    })
    expect(res.status()).toBe(400)
    expect(await errorOf(res)).toBe(MSG.self)
  })

  test('자원 기록이 없는 회원에게 지급은 거부된다(409)', async ({ request }) => {
    const res = await request.post(`/api/admin/timebank/tasks/${fixtures.timebankTaskId}/credit`, {
      data: { member_id: users.other, minutes: 60, memo: '자원 없음', not_paid_elsewhere: true },
    })
    expect(res.status()).toBe(409)
    expect(await errorOf(res)).toBe(MSG.notVolunteer)
  })

  test('300분 조정은 대기로 남고, 만든 관리자가 승인하면 403이다', async ({ request, baseURL }) => {
    const created = await request.post('/api/admin/timebank/adjust', {
      data: { member_id: users.other, direction: 'credit', minutes: 300, memo: '이중 승인 경계' },
    })
    expect(created.status()).toBe(201)
    const body = (await created.json()).data
    expect(body.needs_approval).toBe(true)
    expect(body.transfer.status).toBe('pending')
    const id = body.transfer.id as string
    try {
      const approve = await request.post(`/api/admin/timebank/adjust/${id}/approve`)
      expect(approve.status()).toBe(403)
      expect(await errorOf(approve)).toBe(MSG.selfApproval)
      expect((await readTransfer(id))?.status).toBe('pending')

      // 조정 대기는 조합원 경로로 닿지 않는다(회원 간 kind만 — 404).
      const other = await as('other', baseURL)
      try {
        const res = await other.post(transferAction(id, 'confirm'))
        expect(res.status()).toBe(404)
      } finally {
        await other.dispose()
      }
    } finally {
      // 정리: 관리자 취소(분쟁 정리 경로, memo 필수).
      const cancel = await request.post(`/api/admin/timebank/transfers/${id}/cancel`, {
        data: { memo: 'authz E2E 정리' },
      })
      expect(cancel.status()).toBe(200)
    }
  })
})

// ── 내역·CSV ─────────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 내역은 세션 회원 것만', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('me/transfers?member_id=other를 보내도 owner가 당사자인 행만 온다', async ({ request }) => {
    const res = await request.get(`/api/timebank/me/transfers?member_id=${users.other}`)
    expect(res.status()).toBe(200)
    const rows = (await res.json()).data.transfers as Array<{ id: string }>
    const ids = rows.map(r => r.id)
    // 공허한 통과 방지: owner의 픽스처 행이 실제로 들어 있다.
    expect(ids).toContain(fixtures.timebankPendingId)
    expect(ids).toContain(fixtures.timebankConfirmedId)
    // other와 suspended 사이의 행(a)은 없다.
    expect(ids).not.toContain(fixtures.timebankSuspendedPendingIds.bySuspended)
    for (const id of ids) {
      const row = await readTransfer(id)
      expect([row?.from_account, row?.to_account], id).toContain(users.owner)
    }
  })

  test('CSV도 같다', async ({ request }) => {
    const res = await request.get(`/api/timebank/me/transfers.csv?member_id=${users.other}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="timebank-/)
    const csv = await res.text()
    expect(csv).toContain(PENDING_MEMO)
    expect(csv).not.toContain(SUSPENDED_A_MEMO)
  })
})

// ── 이사회 보고 ──────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 이사회 보고', () => {
  test('조합원(owner)은 403, 이사(director)는 200이다', async ({ baseURL }) => {
    const owner = await as('owner', baseURL)
    const director = await as('director', baseURL)
    try {
      const denied = await owner.get('/api/board-room/timebank/oversight')
      expect(denied.status()).toBe(403)
      expect(await errorOf(denied)).toBe(MSG.boardRoomOnly)
      const allowed = await director.get('/api/board-room/timebank/oversight')
      expect(allowed.status()).toBe(200)
    } finally {
      await owner.dispose()
      await director.dispose()
    }
  })
})

// ── 스위치(§7.2) ─────────────────────────────────────────────────────────────

test.describe('타임뱅크 — 기능 스위치', () => {
  test('enabled를 끄면 기록·확인·글쓰기 403, 거절·취소·읽기는 열린다', async ({ baseURL }) => {
    const owner = await as('owner', baseURL)
    const other = await as('other', baseURL)
    // 꺼지기 전에 대기 둘을 만든다 — 하나는 거절, 하나는 취소할 것.
    const make = async () => {
      const res = await owner.post('/api/timebank/transfers', { data: recordBody(users.other) })
      expect(res.status()).toBe(201)
      return (await res.json()).data.transfer.id as string
    }
    const toReject = await make()
    const toCancel = await make()
    const restore = await patchTimebankSettings({ enabled: false })
    try {
      const record = await owner.post('/api/timebank/transfers', { data: recordBody(users.other) })
      expect(record.status()).toBe(403)
      expect(await errorOf(record)).toBe(MSG.disabled)

      const confirm = await other.post(transferAction(toReject, 'confirm'))
      expect(confirm.status()).toBe(403)
      expect(await errorOf(confirm)).toBe(MSG.disabled)

      const write = await owner.post('/api/timebank/listings', { data: listingBody })
      expect(write.status()).toBe(403)
      expect(await errorOf(write)).toBe(MSG.disabled)

      expect((await other.post(transferAction(toReject, 'reject'))).status()).toBe(200)
      expect((await owner.post(transferAction(toCancel, 'cancel'))).status()).toBe(200)

      for (const path of ['/api/timebank/listings', listing(), '/api/timebank/me']) {
        expect((await owner.get(path)).status(), path).toBe(200)
      }
    } finally {
      await restore()
      await cancelAs(owner, toReject)
      await cancelAs(owner, toCancel)
      await owner.dispose()
      await other.dispose()
    }
    expect((await readTransfer(toReject))?.status).toBe('rejected')
    expect((await readTransfer(toCancel))?.status).toBe('canceled')
  })

  test('coop_tasks_enabled를 끄면 자원 403·관리자 지급 403, 켜면 자원이 된다', async ({
    baseURL,
  }) => {
    const owner = await as('owner', baseURL)
    const admin = await as('admin', baseURL)
    const volunteer = `/api/timebank/listings/${fixtures.timebankTaskId}/volunteer`
    const credit = `/api/admin/timebank/tasks/${fixtures.timebankTaskId}/credit`
    try {
      const restore = await patchTimebankSettings({ coop_tasks_enabled: false })
      try {
        const v = await owner.post(volunteer)
        expect(v.status()).toBe(403)
        expect(await errorOf(v)).toBe(MSG.volunteerOff)

        const c = await admin.post(credit, {
          data: {
            member_id: users.owner,
            minutes: 60,
            memo: '꺼짐 경계',
            not_paid_elsewhere: true,
          },
        })
        expect(c.status()).toBe(403)
        expect(await errorOf(c)).toBe(MSG.coopCreditOff)

        const task = await admin.post('/api/admin/timebank/tasks', { data: listingBody })
        expect(task.status()).toBe(403)
        expect(await errorOf(task)).toBe(MSG.coopCreditOff)
      } finally {
        await restore()
      }

      // 짝: 켜져 있으면 자원이 된다(403이 늘 나는 라우트가 아니다). 철회해 되돌린다.
      const on = await owner.post(volunteer)
      expect(on.status()).toBe(200)
      expect((await owner.delete(volunteer)).status()).toBe(200)
    } finally {
      await owner.dispose()
      await admin.dispose()
    }
  })
})
