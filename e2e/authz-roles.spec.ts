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

/**
 * '이사회 서류 목록은...' 테스트 전용 픽스처. `scripts/testing/seed-authz-fixtures.mjs`는
 * `board_documents`에 아무 행도 심지 않는다(2026-09-09 확인, 실측 0행) —
 * 그래서 목록이 원래 비어 있으면 "필터가 board 자료를 걸렀다"와 "애초에
 * 아무것도 없었다"를 구분할 수 없고, 인가를 통째로 지워도 이 스펙이
 * 통과해 버린다(공허한 테스트).
 *
 * `authz-mailbox.spec.ts`의 `seedMailboxFixtures()`를 본떠 공용 시드
 * 스크립트는 건드리지 않고 이 파일 안에서 libsql 클라이언트로 직접 심는다
 * (고정 id, `ON CONFLICT`로 재실행에 견딘다). 다만 그 선례와 달리 이 두 행은
 * 실행이 끝나면 명시적으로 지운다 — 아래 `test.afterAll`에서 정리한다.
 *
 * **members 쪽 카테고리를 '총회'가 아니라 '기타'로 심은 이유.**
 * `GET /api/board-room/documents`(카테고리 미지정)는 `visibility`를 보기
 * 전에 카테고리로 먼저 거른다 — `BOARD_DOCUMENT_CATEGORIES`(등록증·정관·
 * 계약·기타)만 포함하고 `ASSEMBLY_DOCUMENT_CATEGORY`('총회')는 무조건
 * 뺀다(`src/db/queries/board.ts`의 `listDocuments` 호출부 주석, "카테고리가
 * 없으면 원본과 동일하게 정기총회 자료를 제외한다"). 그래서 '총회' 카테고리로
 * 심으면 visibility가 'members'여도 이 엔드포인트의 기본 목록에는 애초에
 * 나타나지 않는다 — category 배제가 먼저 걸려 visibility 필터를 아예
 * 시험하지 못한다(실측: '총회'로 심었더니 두 역할 모두 빈 배열이었다). 그래서
 * `BOARD_DOCUMENT_CATEGORIES` 안의 카테고리('기타')를 썼다 — 이래야 두 문서가
 * 모두 카테고리 조건은 통과하고 visibility 조건에서만 갈린다.
 */
const BOARD_ONLY_DOCUMENT_ID = '00000000-0000-4000-8000-00000000d001'
const MEMBERS_VISIBLE_DOCUMENT_ID = '00000000-0000-4000-8000-00000000d002'
const BOARD_ONLY_DOCUMENT_TITLE = 'AUTHZ-E2E-BOARD-ONLY-DOCUMENT-FIXTURE'
const MEMBERS_VISIBLE_DOCUMENT_TITLE = 'AUTHZ-E2E-MEMBERS-VISIBLE-DOCUMENT-FIXTURE'

async function seedBoardDocumentFixtures(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const now = Date.now()
    // 1) 서류함 자료 — 조합원에게 보이면 안 된다. visibility 기본값이 이미
    //    'board'지만 회귀를 명확히 잡으려고 명시한다.
    await client.execute({
      sql: `INSERT INTO board_documents
              (id, title, category, file_path, file_name, file_size, mime_type,
               uploaded_by, body_markdown, visibility, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              category = excluded.category,
              file_path = excluded.file_path,
              file_name = excluded.file_name,
              file_size = excluded.file_size,
              mime_type = excluded.mime_type,
              uploaded_by = excluded.uploaded_by,
              body_markdown = excluded.body_markdown,
              visibility = excluded.visibility,
              created_at = excluded.created_at`,
      args: [
        BOARD_ONLY_DOCUMENT_ID,
        BOARD_ONLY_DOCUMENT_TITLE,
        '정관',
        'authz-e2e-fixtures/board-only.pdf',
        'board-only.pdf',
        1234,
        'application/pdf',
        fixtures.users.admin,
        null,
        'board',
        now - 60_000,
      ],
    })
    // 2) 서류함 카테고리이지만 조합원에게 공개로 지정된 자료 — 조합원에게
    //    보여야 한다. 위 주석대로 카테고리는 '기타'(BOARD_DOCUMENT_CATEGORIES
    //    안)를 쓴다 — '총회'를 쓰면 이 엔드포인트가 카테고리 단계에서부터
    //    빼버려 visibility 필터를 시험하지 못한다.
    await client.execute({
      sql: `INSERT INTO board_documents
              (id, title, category, file_path, file_name, file_size, mime_type,
               uploaded_by, body_markdown, visibility, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              category = excluded.category,
              file_path = excluded.file_path,
              file_name = excluded.file_name,
              file_size = excluded.file_size,
              mime_type = excluded.mime_type,
              uploaded_by = excluded.uploaded_by,
              body_markdown = excluded.body_markdown,
              visibility = excluded.visibility,
              created_at = excluded.created_at`,
      args: [
        MEMBERS_VISIBLE_DOCUMENT_ID,
        MEMBERS_VISIBLE_DOCUMENT_TITLE,
        '기타',
        'authz-e2e-fixtures/members-visible.md',
        'members-visible.md',
        56,
        'text/markdown',
        fixtures.users.admin,
        '# 조합원 공개 자료\n\nAUTHZ-E2E-MEMBERS-VISIBLE-BODY-MARKER',
        'members',
        now - 30_000,
      ],
    })
  } finally {
    client.close()
  }
}

async function deleteBoardDocumentFixtures(): Promise<void> {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    await client.execute({
      sql: 'DELETE FROM board_documents WHERE id IN (?, ?)',
      args: [BOARD_ONLY_DOCUMENT_ID, MEMBERS_VISIBLE_DOCUMENT_ID],
    })
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
  test.beforeAll(async () => {
    await seedBoardDocumentFixtures()
  })

  test('이사회 서류 목록은 이사가 아니면 board 자료를 못 본다(게이트가 아니라 visibility가 막는다)', async ({
    baseURL,
  }) => {
    const memberContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('other'),
    })
    const directorContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('director'),
    })

    try {
      // 금지 쪽: **인증된** 비이사다. 이 라우트는 이미 requireBoardRecordReader()로
      // 바뀌어(Task 4·5, 74d20dd·6fbd866) 승인·활성 조합원이면 누구나 200을
      // 받는다 — 403 게이트는 더 이상 여기 없다. `authz-boundaries.spec.ts`가
      // 보는 비인증 401도 로그인 게이트만 증명할 뿐 이 경계와는 무관하다.
      // 로그인한 일반 조합원이 이사회 서류를 열람하게 되는 회귀를 잡던 자리는
      // 이제 게이트가 아니라 `visibility` 필터다.
      //
      // id로 식별한다(개수로 하지 않는다) — 다른 테스트나 실행이 행을 더
      // 추가해도 흔들리지 않기 위해서다. 두 방향을 모두 본다: board 자료가
      // '없다'만 보면 필터가 통째로 고장 나 전부 빈 배열이 되는 상태(인가를
      // 지워도 통과하는 공허한 테스트)를 못 잡는다 — members 자료가
      // '있다'는 단언이 바로 그 구멍을 막는다.
      const memberList = await memberContext.get('/api/board-room/documents')
      expect(memberList.status()).toBe(200)
      const memberBody = await memberList.json()
      expect(memberBody.success).toBe(true)
      const memberDocuments = memberBody.data?.documents as Array<{ id: string }>
      expect(Array.isArray(memberDocuments)).toBe(true)
      const memberIds = memberDocuments.map(doc => doc.id)
      expect(memberIds).not.toContain(BOARD_ONLY_DOCUMENT_ID)
      expect(memberIds).toContain(MEMBERS_VISIBLE_DOCUMENT_ID)

      // 서류함 카테고리(board 자료의 카테고리)를 명시해도 마찬가지다 — 카테고리
      // 조건은 통과하지만 visibility 조건에서 걸러져 빈 목록이어야 한다.
      const memberCategoryList = await memberContext.get('/api/board-room/documents?category=정관')
      expect(memberCategoryList.status()).toBe(200)
      const memberCategoryBody = await memberCategoryList.json()
      expect(memberCategoryBody.data?.documents).toHaveLength(0)

      // 허용 쪽은 **관리자가 아닌 이사**다. admin 계정으로 확인하면
      // canAccessBoardRoom의 is_admin 분기만 타서 is_director 판정은 여전히
      // 검사되지 않는다. 이사는 게이트도 필터도 걸리지 않는다 — board 자료가
      // 목록에도, 카테고리 필터 결과에도 실제로 실려야 한다(대조군. 배열
      // 여부만으로는 부족하다 — 필터가 이사 쪽까지 잘못 걸러도 빈 배열은
      // 여전히 배열이다).
      const allowed = await directorContext.get('/api/board-room/documents')
      expect(allowed.status()).toBe(200)
      const body = await allowed.json()
      expect(body.success).toBe(true)
      const directorIds = (body.data?.documents as Array<{ id: string }>).map(doc => doc.id)
      expect(directorIds).toContain(BOARD_ONLY_DOCUMENT_ID)

      const directorCategoryList = await directorContext.get(
        '/api/board-room/documents?category=정관'
      )
      expect(directorCategoryList.status()).toBe(200)
      const directorCategoryBody = await directorCategoryList.json()
      const directorCategoryIds = (
        directorCategoryBody.data?.documents as Array<{ id: string }>
      ).map(doc => doc.id)
      expect(directorCategoryIds).toContain(BOARD_ONLY_DOCUMENT_ID)
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
  // 그대로 두면 실행마다 쌓인다. 이 describe가 심은 board_documents 픽스처
  // 두 행도 같은 이유로 여기서 지운다 — 남기면 서류함 관련 다른 스펙이나
  // 다음 실행이 이 픽스처를 실제 자료로 착각한다.
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
    await deleteBoardDocumentFixtures()
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

/**
 * **회원 탈퇴 경계**(Task 8) — 안전망의 마지막 조각.
 *
 * 설계가 중간에 바뀌었다: 탈퇴 "신청"은 `registration_status`를 바꾸지
 * 않는다(`withdrawal_requested_at` 타임스탬프만 채운다). 그래서 이 스위트가
 * 증명해야 할 것은 세 가지다 — ①확정된 탈퇴자는 로그인 자체가 막힌다
 * (`account` 행 삭제), ②관리자가 자기 자신을 탈퇴시키는 것은 막힌다,
 * ③신청 **중**인 회원은 여전히 정상 조합원이다(이게 이번 설계 수정의
 * 핵심이라 가장 중요하다 — 신청을 상태값으로 표현했다면 이 단정이 깨졌을
 * 것이다).
 */
test.describe('회원 탈퇴 경계', () => {
  test('탈퇴가 확정된 조합원은 로그인이 되지 않는다', async ({ baseURL }) => {
    // storageState를 쓰지 않는다 — 애초에 로그인이 안 되는 계정이라 만들
    // storageState가 없다(`e2e/authz.setup.ts`에도 없다).
    const anonContext = await apiRequest.newContext({ baseURL })
    try {
      // 비밀번호(account 행)가 `withdrawMember()`로 지워졌으므로, 어떤
      // 비밀번호를 넣어도 401이어야 한다 — Better Auth 기준 로그인
      // 시도(`/api/auth/sign-in/email`)다.
      const login = await anonContext.post('/api/auth/sign-in/email', {
        data: { email: fixtures.users.withdrawnEmail, password: 'anything-goes-here-2026' },
      })
      expect(login.status()).toBe(401)
    } finally {
      await anonContext.dispose()
    }
  })

  test('관리자는 자기 자신을 탈퇴 처리할 수 없다', async ({ baseURL }) => {
    const adminContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('admin'),
    })
    try {
      const res = await adminContext.post('/api/admin/member-action', {
        data: { memberId: fixtures.users.admin, action: 'withdraw' },
      })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toContain('자기 자신은 탈퇴 처리할 수 없습니다')

      // 짝: 거부됐다면 관리자 계정이 실제로 탈퇴되지 않았어야 한다. 상태
      // 코드만 보면 400을 돌려주면서 처리는 이미 해버리는 모양을 못 잡는다.
      expect(await readRegistrationStatus(fixtures.users.admin)).toBe('approved')
    } finally {
      await adminContext.dispose()
    }
  })

  test('탈퇴 신청 중인 회원은 여전히 조합원이다 (마이페이지·게시판 접근 유지)', async ({
    baseURL,
  }) => {
    const requesterContext = await apiRequest.newContext({
      baseURL,
      storageState: storageStatePath('withdrawalRequested'),
    })
    try {
      // 신청 상태여도 registration_status는 'approved' 그대로다 — 상태값을
      // 바꾸는 설계였다면 이 단정이 깨졌을 것이다.
      expect(await readRegistrationStatus(fixtures.users.withdrawalRequested)).toBe('approved')

      // 마이페이지 전용 라우트(`requireActiveMember`)가 통과한다 — 이미
      // 신청한 상태라 재신청은 409로 거절되지만, 그 409 자체가 "게이트를
      // 통과했다"는 증거다(미승인/비활성이었다면 403이 먼저 났을 것이다).
      const reRequest = await requesterContext.post('/api/mypage/withdrawal')
      expect(reRequest.status()).toBe(409)

      // 게시판 접근도 그대로다 — 소개 페이지가 조합원에게 공개적으로
      // 약속한 범위(이사회 안건 토론 읽기)로 확인한다.
      const boardRead = await requesterContext.get(
        `/api/board-room/agendas/${fixtures.boardAgendaId}/comments`
      )
      expect(boardRead.status()).toBe(200)
      expect(Array.isArray((await boardRead.json()).data?.comments)).toBe(true)
    } finally {
      await requesterContext.dispose()
    }
  })
})
