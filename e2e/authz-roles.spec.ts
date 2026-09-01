import { test, expect, request as apiRequest } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

/**
 * **관리자 경계**와 **이사 경계** — 이 스위트에서 가장 무거운 두 게이트다.
 *
 * 리뷰 1회차에서 확인된 사실: `requireAdmin()`과 `checkAdminPermission()`을
 * **둘 다 무력화해도** 권한 E2E는 전부 초록이었고, board-room은 **비인증
 * 401**만 검사되고 있었다(`authz-boundaries.spec.ts`). 즉 승인된 일반
 * 조합원이 회원을 승인·정지하고 시스템 설정을 열람하게 되는 회귀도,
 * 비이사가 이사회 서류를 열람하게 되는 회귀도 아무도 잡지 못했다.
 *
 * 목적은 전수 커버리지가 아니라 **게이트가 살아 있는지**다. 그래서 경계마다
 * 대표 엔드포인트 하나씩만 고르되, 아래 두 규칙을 지킨다.
 *
 * 1. **짝지어 단정한다.** 금지된 세션이 403인지만 보면 게이트가 "전부 막기"로
 *    퇴화한 것을 못 잡는다(관리자 화면이 통째로 죽어도 초록불이다). 허용된
 *    세션이 실제로 성공하는 것도 같은 테스트 안에서 단정한다.
 * 2. **상태 코드가 아니라 효과까지 본다.** 쓰기 경계는 403을 확인한 뒤 DB의
 *    대상 행이 정말 안 바뀌었는지도 읽는다 — 라우트가 403을 돌려주면서
 *    쓰기는 이미 해버리는 모양을 상태 코드만으로는 구분할 수 없다.
 *
 * 대표 엔드포인트를 이렇게 고른 이유: 관리자 게이트는 구현이 **두 벌**이다.
 * `requireAdmin()`(`auth: 'admin'`, 예: member-action)과
 * `checkAdminPermission()`(`createSettingsAdminAuth()`, 예: admin/settings).
 * 한쪽만 검사하면 다른 쪽 회귀는 그대로 통과하므로 쓰기·읽기를 각각 다른
 * 구현에서 골랐다.
 */

/** 관리자 쓰기 경계의 대상 계정을 `pending`으로 되돌린다. */
async function resetApprovalTarget(memberId: string): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    // 이 리셋이 없으면 스위트를 두 번째 돌리는 순간 대상이 이미 approved라
    // 관리자 POST가 400("승인 대기 상태의 회원만 승인할 수 있습니다.")으로
    // 떨어진다. 그러면 "관리자는 성공한다"는 짝 단정이 무너져 이 스펙이
    // 재실행 불가능해진다.
    const res = await client.execute({
      sql: `UPDATE member_profiles
            SET registration_status = 'pending', is_active = 0,
                approved_at = NULL, approved_by = NULL
            WHERE id = ?`,
      args: [memberId],
    })
    if (res.rowsAffected !== 1) {
      // authz-maintenance.spec.ts와 같은 fail-closed다. 시드가 대상 계정을
      // 심지 않았는데 조용히 넘어가면, 아래 단정들이 "무엇을 검사했는지"
      // 알 수 없는 채로 초록이 될 수 있다.
      throw new Error(
        `승인 대상 초기화 실패: member_profiles 행이 ${res.rowsAffected}개 갱신됐다. ` +
          '픽스처 시드(scripts/testing/seed-authz-fixtures.mjs)를 먼저 돌렸는지 확인할 것.'
      )
    }
    // 승인 알림(`notifyMemberApproved`)이 실행마다 쌓이지 않도록 함께 지운다.
    await client.execute({
      sql: 'DELETE FROM notifications WHERE user_id = ?',
      args: [memberId],
    })
  } finally {
    client.close()
  }
}

async function readRegistrationStatus(memberId: string): Promise<string | null> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const res = await client.execute({
      sql: 'SELECT registration_status FROM member_profiles WHERE id = ?',
      args: [memberId],
    })
    return (res.rows[0]?.registration_status as string) ?? null
  } finally {
    client.close()
  }
}

test.describe('관리자 전용 경계', () => {
  test('회원 승인은 관리자만 할 수 있다 (requireAdmin — 쓰기)', async ({ baseURL }) => {
    const targetId = fixtures.users.approvalTarget
    await resetApprovalTarget(targetId)

    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })

    try {
      // 금지 쪽: 승인된 **일반** 조합원(관리자 아님)이다. 미승인 계정이 아니라
      // 이 계정을 쓰는 이유는, 미승인 계정은 다른 게이트(승인 여부)에도 걸려
      // 관리자 게이트가 죽어도 계속 403이 나오기 때문이다 — 그러면 이 단정은
      // 관리자 경계에 대해 아무것도 증명하지 않는다.
      const denied = await memberContext.post('/api/admin/member-action', {
        data: { memberId: targetId, action: 'approve' },
      })
      expect(denied.status()).toBe(403)
      expect((await denied.json()).error).toContain('관리자 권한이 필요합니다')

      // 상태 코드만으로는 부족하다 — 403을 돌려주면서 쓰기는 이미 끝냈을 수도 있다.
      expect(
        await readRegistrationStatus(targetId),
        '403을 받았는데도 대상 회원이 승인됐다 — 거부가 쓰기보다 뒤에 있다'
      ).toBe('pending')

      // 허용 쪽: 같은 요청이 관리자 세션에서는 성공해야 한다. 이 단정이 없으면
      // 게이트가 "전부 막기"로 퇴화해도(관리자 화면이 통째로 죽어도) 초록불이다.
      const allowed = await adminContext.post('/api/admin/member-action', {
        data: { memberId: targetId, action: 'approve' },
      })
      expect(allowed.status()).toBe(200)
      expect((await allowed.json()).message).toContain('승인되었습니다')
      expect(await readRegistrationStatus(targetId)).toBe('approved')
    } finally {
      await memberContext.dispose()
      await adminContext.dispose()
      // 다음 실행이 이 스펙의 실패 지점에 좌우되지 않도록 되돌린다.
      await resetApprovalTarget(targetId)
    }
  })

  test('시스템 설정 조회는 관리자만 할 수 있다 (checkAdminPermission — 읽기)', async ({
    baseURL,
  }) => {
    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })

    try {
      const denied = await memberContext.get('/api/admin/settings')
      expect(denied.status()).toBe(403)
      expect((await denied.json()).error).toContain('관리자 권한이 필요합니다')

      const allowed = await adminContext.get('/api/admin/settings')
      expect(allowed.status()).toBe(200)
      const body = await allowed.json()
      expect(body.success).toBe(true)
      // 시드가 심는 `site/maintenance_mode`가 이 응답에 실린다. 형태만 보는
      // 것이 아니라 관리자가 실제로 설정 값을 받아 갔음을 확인한다.
      expect(typeof body.data?.site?.maintenance_mode).toBe('boolean')
    } finally {
      await memberContext.dispose()
      await adminContext.dispose()
    }
  })
})

test.describe('이사회 경계', () => {
  test('이사회 서류 목록은 이사만 볼 수 있다', async ({ baseURL }) => {
    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const directorContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })

    try {
      // 금지 쪽: **인증된** 비이사다. `authz-boundaries.spec.ts`가 보는 비인증
      // 401은 로그인 게이트만 증명한다 — 로그인한 일반 조합원이 이사회 서류를
      // 열람하게 되는 회귀는 그쪽으로는 잡히지 않는다.
      const denied = await memberContext.get('/api/board-room/documents')
      expect(denied.status()).toBe(403)
      expect((await denied.json()).error).toContain('이사회 접근 권한이 없습니다')

      // 허용 쪽은 **관리자가 아닌 이사**다. admin 계정으로 확인하면
      // canAccessBoardRoom의 is_admin 분기만 타서 is_director 판정은 여전히
      // 검사되지 않는다.
      const allowed = await directorContext.get('/api/board-room/documents')
      expect(allowed.status()).toBe(200)
      const body = await allowed.json()
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data?.documents)).toBe(true)
    } finally {
      await memberContext.dispose()
      await directorContext.dispose()
    }
  })

  /**
   * 열람 개방의 **양면**을 한 테스트에서 본다. 조합원은 안건·회의록까지
   * 읽지만 출석·정족수는 못 본다 — 한쪽만 단정하면 게이트가 "전부 열림"이나
   * "전부 닫힘"으로 퇴화한 것을 놓친다.
   *
   * 소개 페이지가 "이사회 안건과 회의록은 조합원이 볼 수 있습니다"라고
   * 공개적으로 약속하는 범위가 정확히 이만큼이라, 이 테스트가 그 약속과
   * 코드가 어긋나는 순간을 잡는 자리다.
   */
  test('조합원은 안건·회의록까지만 읽는다 (출석·정족수는 못 본다)', async ({ baseURL }) => {
    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const directorContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })

    try {
      const list = await memberContext.get('/api/board-room/meetings')
      expect(list.status()).toBe(200)
      expect(Array.isArray((await list.json()).data?.meetings)).toBe(true)

      const detail = await memberContext.get(`/api/board-room/meetings/${fixtures.boardMeetingId}`)
      expect(detail.status()).toBe(200)
      const memberBody = (await detail.json()).data
      // 열린 쪽: 안건과 회의록 키가 실제로 온다.
      expect(Array.isArray(memberBody?.agendas)).toBe(true)
      expect(memberBody).toHaveProperty('minutes')
      // 닫힌 쪽: 이사회 전용 정보는 비어서 온다.
      expect(memberBody?.is_board_member).toBe(false)
      expect(memberBody?.attendees).toEqual([])
      expect(memberBody?.roster).toEqual([])
      expect(memberBody?.quorum).toBeNull()

      // 짝: 이사에게는 같은 응답에 출석·정족수가 실린다. 이게 없으면
      // "조합원 응답이 비었다"가 게이트 때문인지 데이터가 없어서인지 모른다.
      const directorDetail = await directorContext.get(
        `/api/board-room/meetings/${fixtures.boardMeetingId}`
      )
      expect(directorDetail.status()).toBe(200)
      const directorBody = (await directorDetail.json()).data
      expect(directorBody?.is_board_member).toBe(true)
      expect(directorBody?.quorum).not.toBeNull()
      expect(Array.isArray(directorBody?.roster)).toBe(true)
      expect(directorBody.roster.length).toBeGreaterThan(0)
    } finally {
      await memberContext.dispose()
      await directorContext.dispose()
    }
  })

  test('조합원은 안건 토론을 읽고 쓰지만 이사회 쓰기는 막힌다', async ({ baseURL }) => {
    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })

    try {
      const read = await memberContext.get(
        `/api/board-room/agendas/${fixtures.boardAgendaId}/comments`
      )
      expect(read.status()).toBe(200)
      expect(Array.isArray((await read.json()).data?.comments)).toBe(true)

      // 토론은 조합원에게 열려 있다.
      const write = await memberContext.post(
        `/api/board-room/agendas/${fixtures.boardAgendaId}/comments`,
        { data: { content: '조합원의 의견' } }
      )
      expect(write.status()).toBe(201)

      // **짝 단정.** 토론 게이트가 다른 이사회 쓰기로 번지면 여기서 201이
      // 난다 — 비이사가 안건을 올리는 회귀는 토론 개방과 반드시 함께 본다.
      const agenda = await memberContext.post('/api/board-room/agendas', {
        data: { meeting_id: fixtures.boardMeetingId, title: '조합원이 올린 안건' },
      })
      expect(agenda.status()).toBe(403)
      expect((await agenda.json()).error).toContain('이사회 접근 권한이 없습니다')
    } finally {
      await memberContext.dispose()
    }
  })

  // 위 테스트가 남긴 조합원 의견을 실행 안에서 치운다 — 시드는 지우지 않아
  // 그대로 두면 실행마다 쌓인다.
  test.afterAll(async () => {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      await client.execute({
        sql: 'DELETE FROM board_agenda_comments WHERE agenda_id = ? AND author_id = ?',
        args: [fixtures.boardAgendaId, fixtures.users.other],
      })
    } finally {
      client.close()
    }
  })
})

/**
 * **페이지 레벨 인가.** 위 API 경계와 목적은 같지만 게이트가 다르다 —
 * `src/middleware/auth.ts`의 두 분기(`/admin` + `!isAdmin`,
 * board-room + `!isAdmin && !is_director && !is_auditor`)다.
 *
 * 왜 필요한가: `src/app/[locale]/admin/page.tsx`와
 * `src/app/[locale]/board-room/page.tsx`는 **둘 다 `'use client'`**라 서버측
 * 인가가 전혀 없다. **미들웨어가 유일한 게이트다.** 실측(리뷰 2회차): 두
 * 분기를 동시에 무력화해도 권한 E2E 48건이 전부 초록이었다 — 승인된 일반
 * 조합원이 관리자 콘솔과 이사회 화면을 그대로 여는 회귀를 아무도 잡지
 * 못했다. 데이터 API가 403이라 즉시 유출은 아니지만, 미들웨어 주석 자신이
 * "API `canAccessBoardRoom`과 동일 기준"이라 선언한 경계다.
 *
 * API 스펙과 같은 규칙을 지킨다: **짝지어 단정한다.** 리다이렉트만 확인하면
 * 게이트가 "전부 리다이렉트"로 퇴화한 것(관리자·이사도 화면에 못 들어가는
 * 상태)을 못 잡는다.
 */
test.describe('페이지 레벨 인가 (미들웨어)', () => {
  test('이사회 전용 화면은 이사만 연다 (/board-room/documents)', async ({ browser }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })
    const directorContext = await browser.newContext({
      storageState: storageStatePath('director'),
    })

    try {
      // 금지 쪽: 승인된 **일반** 조합원. 미승인 계정을 쓰면 앞선 분기(승인
      // 여부)가 먼저 걸려 이사 판정이 죽어도 계속 리다이렉트된다.
      //
      // 대상이 `/board-room`에서 `/board-room/documents`로 바뀐 이유: 이제
      // 대시보드와 회의(안건·회의록)는 조합원에게 열려 있다(소개 페이지가
      // 공개적으로 약속한 범위). 서류함·일정 투표·정기총회는 그대로 이사
      // 전용이고, 미들웨어의 `isBoardRoomRecordPage` 예외가 그 선을 긋는다.
      const memberPage = await memberContext.newPage()
      await memberPage.goto('/board-room/documents', { waitUntil: 'domcontentloaded' })
      await expect(memberPage).toHaveURL(/\/board$/, { timeout: 15000 })

      // 허용 쪽: **관리자가 아닌 이사**. admin 계정으로 확인하면 `isAdmin`
      // 분기만 타서 `is_director` 판정은 여전히 검사되지 않는다.
      const directorPage = await directorContext.newPage()
      await directorPage.goto('/board-room', { waitUntil: 'domcontentloaded' })
      await expect(directorPage).toHaveURL(/\/board-room$/, { timeout: 15000 })
      // URL만 보면 "머물렀다"까지만 증명된다. 이사회 화면이 실제로 그려졌는지
      // 확인해야 게이트 통과 후 다른 이유로 죽는 상태와 구분된다.
      await expect(
        directorPage.getByRole('heading', { name: '이사회 대시보드', level: 1 })
      ).toBeVisible({ timeout: 15000 })
    } finally {
      await memberContext.close()
      await directorContext.close()
    }
  })

  test('조합원은 이사회 회의 페이지에 들어간다 (/board-room/meetings)', async ({ browser }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })

    try {
      // 위 테스트의 짝. 서류함에서 튕겨 나오는 것만 확인하면 게이트가 "전부
      // 리다이렉트"로 되돌아간 상태(= 조합원 열람 개방이 통째로 사라진 상태)를
      // 못 잡는다.
      const memberPage = await memberContext.newPage()
      await memberPage.goto('/board-room/meetings', { waitUntil: 'domcontentloaded' })
      await expect(memberPage).toHaveURL(/\/board-room\/meetings$/, { timeout: 15000 })
    } finally {
      await memberContext.close()
    }
  })

  test('관리자 콘솔은 관리자만 연다 (/admin)', async ({ browser }) => {
    const memberContext = await browser.newContext({ storageState: storageStatePath('other') })
    const adminContext = await browser.newContext({ storageState: storageStatePath('admin') })

    try {
      const memberPage = await memberContext.newPage()
      await memberPage.goto('/admin', { waitUntil: 'domcontentloaded' })
      await expect(memberPage).toHaveURL(/\/board$/, { timeout: 15000 })

      const adminPage = await adminContext.newPage()
      await adminPage.goto('/admin', { waitUntil: 'domcontentloaded' })
      await expect(adminPage).toHaveURL(/\/admin$/, { timeout: 15000 })
      await expect(
        adminPage.getByRole('heading', { name: '관리자 대시보드', level: 1 })
      ).toBeVisible({ timeout: 15000 })
    } finally {
      await memberContext.close()
      await adminContext.close()
    }
  })
})
