import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

/**
 * 이 스위트의 목적은 "막히는가"가 아니라 **"무엇이 막는가"**다.
 *
 * RLS가 SELECT를 막으면 행이 없는 것처럼 보여 앱이 404를 낸다. 앱 계층이
 * 막으면 403이 나온다. `expect(status).not.toBe(200)` 같은 느슨한 단정은
 * 이 둘을 구분하지 못해서, RLS를 꺼도 초록이라 격차를 놓친다. 그래서 부정
 * 테스트는 상태 코드와 메시지를 **정확히** 단정한다.
 *
 * 참고: ApiError.toNextResponse()(src/utils/apiWrapper.ts)는 실패 본문을
 * `{ success: false, error: <메시지> }`로 내려준다 — `message` 키가 아니다.
 * (`message` 키는 ApiSuccess 응답에서만 쓰인다.) 그래서 아래 단정은 모두
 * `body.error`를 읽는다.
 *
 * 참고 2: PATCH /api/posts/[id](src/app/api/posts/[id]/route.ts:296)는
 * 본문 형식 필드를 `content_format`(snake_case)으로 읽는다. 이 요청 바디
 * 검증은 소유권 검사보다 먼저 실행되므로, 필드명을 잘못 보내면(예:
 * camelCase `contentFormat`) 403(권한 없음) 전에 400(형식 오류)이 먼저
 * 나와 이 스위트가 확인하려는 지점(소유권 경계)에 도달하지 못한다.
 */

test.describe('게시글 소유권 (조합원 B가 A의 글을 건드린다)', () => {
  test.use({ storageState: storageStatePath('other') })

  test('남의 글 수정은 403 + 권한 없음 메시지다', async ({ request }) => {
    const res = await request.patch(`/api/posts/${fixtures.postId}`, {
      data: { title: '가로챈 제목', content: '<p>x</p>', content_format: 'html', category: '잡담' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('남의 글 삭제는 403 + 권한 없음 메시지다', async ({ request }) => {
    const res = await request.delete(`/api/posts/${fixtures.postId}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('남의 댓글 삭제는 403 + 권한 없음 메시지다', async ({ request }) => {
    const res = await request.delete(`/api/posts/${fixtures.postId}/comments/${fixtures.commentId}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('남의 글도 읽기는 200이다 (게시판은 조합원에게 공개다)', async ({ request }) => {
    const res = await request.get(`/api/posts/${fixtures.postId}`)
    expect(res.status()).toBe(200)
  })
})

test.describe('게시글 소유권 (본인)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('본인 글 수정은 200이다', async ({ request }) => {
    const res = await request.patch(`/api/posts/${fixtures.postId}`, {
      data: {
        title: 'authz 픽스처 글',
        content: '<p>소유권 경계 테스트용</p>',
        content_format: 'html',
        category: '잡담',
      },
    })
    expect(res.status()).toBe(200)
  })
})

test.describe('관리자 우회', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('관리자는 남의 글도 수정할 수 있다', async ({ request }) => {
    const res = await request.patch(`/api/posts/${fixtures.postId}`, {
      data: {
        title: 'authz 픽스처 글',
        content: '<p>소유권 경계 테스트용</p>',
        content_format: 'html',
        category: '잡담',
      },
    })
    expect(res.status()).toBe(200)
  })
})

test.describe('미승인 조합원', () => {
  test.use({ storageState: storageStatePath('pending') })

  test('글 작성은 403 + 승인된 조합원 안내다', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: { title: '미승인 글', content: '<p>x</p>', category: '잡담' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('승인된 조합원')
  })

  test('댓글 작성은 403 + 승인된 조합원 안내다', async ({ request }) => {
    const res = await request.post(`/api/posts/${fixtures.postId}/comments`, {
      data: { content: '미승인 댓글' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('승인된 조합원')
  })
})

/**
 * 이사회 안건 토론(`/api/board-room/agendas/[id]/comments`).
 *
 * 여기서 지켜야 할 경계는 세 겹이고, 셋 다 서로를 대신하지 못한다.
 *
 *   1. **이사회 게이트** — 승인된 일반 조합원은 **읽기까지만** 된다. 안건과
 *      토론은 조합원에게 열려 있고(소개 페이지가 공개적으로 약속한 범위),
 *      작성·수정·삭제는 이사·감사·관리자만이다. 비인증 401은
 *      `authz-boundaries.spec.ts`가 본다.
 *   2. **작성자 경계** — 수정은 본인만이다. 관리자도 남의 발언을 고쳐 쓰지
 *      못한다(회의록의 근거라 삭제=가림까지가 관리자 권한의 끝이다).
 *   3. **경로 대조** — 댓글 id 앞에 아무 안건 id나 붙여도 통하지 않는다.
 *      이 대조가 빠지면 라우트의 `[id]`가 장식이 되고, 소유권 검사만 통과하면
 *      다른 안건의 발언을 건드릴 수 있다.
 */
test.describe('이사회 안건 토론 (일반 조합원)', () => {
  test.use({ storageState: storageStatePath('other') })

  test('토론 읽기는 200이다 (열람은 조합원에게 열려 있다)', async ({ request }) => {
    const res = await request.get(`/api/board-room/agendas/${fixtures.boardAgendaId}/comments`)
    expect(res.status()).toBe(200)
    expect(Array.isArray((await res.json()).data?.comments)).toBe(true)
  })

  test('의견 작성은 403 + 이사회 접근 안내다', async ({ request }) => {
    const res = await request.post(`/api/board-room/agendas/${fixtures.boardAgendaId}/comments`, {
      data: { content: '조합원의 의견' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('이사회 접근 권한이 없습니다')
  })
})

test.describe('이사회 안건 토론 (이사 본인)', () => {
  test.use({ storageState: storageStatePath('director') })

  test('토론 읽기는 200이고 삭제된 의견의 본문은 실리지 않는다', async ({ request }) => {
    const res = await request.get(`/api/board-room/agendas/${fixtures.boardAgendaId}/comments`)
    expect(res.status()).toBe(200)
    const comments = (await res.json()).data.comments as Array<{
      id: string
      content: string | null
      is_deleted: boolean
    }>
    expect(comments.some(c => c.id === fixtures.boardCommentId)).toBe(true)
    for (const comment of comments) {
      if (comment.is_deleted) expect(comment.content).toBeNull()
    }
  })

  test('본인 의견 수정은 200이다', async ({ request }) => {
    const res = await request.patch(
      `/api/board-room/agendas/${fixtures.boardAgendaId}/comments/${fixtures.boardCommentId}`,
      { data: { content: 'authz 픽스처 안건 의견' } }
    )
    expect(res.status()).toBe(200)
  })

  test('작성자가 아닌 이사는 남의 의견을 수정하지 못한다 (403)', async ({ request }) => {
    const res = await request.patch(
      `/api/board-room/agendas/${fixtures.boardAgendaId}/comments/${fixtures.boardCommentByAdminId}`,
      { data: { content: '남의 발언을 고쳐 쓴다' } }
    )
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('작성자가 아닌 이사는 남의 의견을 삭제하지 못한다 (403)', async ({ request }) => {
    // 이 단정이 없으면 `owner.author_id !== user.id && !isAdmin`에서 앞쪽
    // 절반만 지워도 스위트가 초록이다 — 이사 누구나 남의 발언을 지울 수 있다.
    const res = await request.delete(
      `/api/board-room/agendas/${fixtures.boardAgendaId}/comments/${fixtures.boardCommentByAdminId}`
    )
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('토론이 붙은 안건은 제안자 본인도 지우지 못한다 (403)', async ({ request }) => {
    // 안건 삭제는 hard DELETE + cascade다. 이 가드가 없으면 제안자 한 사람이
    // 다른 이사들의 발언을 행째로 없앨 수 있다 — 댓글 DELETE가 관리자에게도
    // 허용하지 않는(soft delete만 한다) 일이 더 낮은 권한으로 가능해진다.
    // 픽스처 안건의 제안자가 director이므로 소유권 검사는 통과한 뒤 이 가드에
    // 걸린다.
    const res = await request.delete(`/api/board-room/agendas/${fixtures.boardAgendaId}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('관리자만 삭제할 수 있습니다')
  })

  test('다른 안건 경로로 부른 수정은 404다', async ({ request }) => {
    const foreignAgendaId = '00000000-0000-4000-8000-0000000000ff'
    const res = await request.patch(
      `/api/board-room/agendas/${foreignAgendaId}/comments/${fixtures.boardCommentId}`,
      { data: { content: '경로를 갈아끼운 수정' } }
    )
    expect(res.status()).toBe(404)
  })
})

test.describe('이사회 안건 토론 (관리자)', () => {
  test.use({ storageState: storageStatePath('admin') })

  /**
   * 삭제 스펙이 소모한 픽스처를 **실행 안에서** 되돌린다.
   *
   * `npm run test:e2e:authz`는 시드를 돌리지 않는다(globalSetup이 없고
   * `authz.setup.ts`는 로그인만 한다). 복구를 손시드에 맡기면 두 번째 실행이
   * 404로 깨져 기준선 60이 무너진다 — 되돌릴 수 없는 상태를 건드리는 다른
   * 스펙(`authz-maintenance`·`authz-remaining`)과 같은 방식으로 자급한다.
   */
  test.afterAll(async () => {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      await client.execute({
        sql: 'UPDATE board_agenda_comments SET is_deleted = 0 WHERE id = ?',
        args: [fixtures.boardCommentDeletableId],
      })
    } finally {
      client.close()
    }
  })

  test('관리자도 남의 의견은 수정하지 못한다 (403)', async ({ request }) => {
    const res = await request.patch(
      `/api/board-room/agendas/${fixtures.boardAgendaId}/comments/${fixtures.boardCommentId}`,
      { data: { content: '관리자가 고쳐 쓴 발언' } }
    )
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toContain('권한이 없습니다')
  })

  test('관리자는 남의 의견을 삭제할 수 있다 (200)', async ({ request }) => {
    // 소모되는 쪽이다 — 시드가 매 실행마다 `is_deleted = false`로 되돌린다.
    const res = await request.delete(
      `/api/board-room/agendas/${fixtures.boardAgendaId}/comments/${fixtures.boardCommentDeletableId}`
    )
    expect(res.status()).toBe(200)
  })
})
