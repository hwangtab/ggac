import { test, expect } from '@playwright/test'

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
