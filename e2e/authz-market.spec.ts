import { test, expect } from '@playwright/test'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()
const fixtures = readFixtures()

/**
 * 조합원 장터의 경계. 장터는 게시판과 달리 **읽기부터 조합원 전용**이다 —
 * 그 차이가 이 기능의 존재 이유라, 비회원·미승인 차단을 쓰기 경계보다 먼저 본다.
 *
 * `authz-ownership.spec.ts`와 같이 상태 코드와 메시지를 **정확히** 단정한다.
 * 실패 본문은 `{ success: false, error }`다.
 *
 * 화면 경계는 응답 HTML에 픽스처 매물 제목이 **없는지**로 본다. 상태 코드만
 * 보면 "안내 상자를 그리면서 매물도 같이 그린" 회귀를 놓친다.
 */

const LISTING_TITLE = 'authz 픽스처 매물'
const listing = () => `/api/market/${fixtures.marketListingId}`

test.describe('장터 — 비로그인', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('목록·상세·댓글 API는 401이다', async ({ request }) => {
    for (const path of ['/api/market', listing(), `${listing()}/comments`]) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(401)
      expect((await res.json()).error).toBe('인증이 필요합니다.')
    }
  })

  test('상세 화면은 로그인으로 보내고 매물을 그리지 않는다', async ({ page }) => {
    await page.goto(`/board/market/${fixtures.marketListingId}`)
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByText(LISTING_TITLE)).toHaveCount(0)
  })

  test('장터 매물 id로 게시판 상세(/board/[id])를 열어도 나오지 않는다', async ({ request }) => {
    // 장터는 `posts`가 아니라 별도 표다. 게시판의 공개·ISR 경로로 새지 않는다.
    const res = await request.get(`/api/posts/${fixtures.marketListingId}`)
    expect(res.status()).toBe(404)
    const html = await (await request.get(`/board/${fixtures.marketListingId}`)).text()
    expect(html).not.toContain(LISTING_TITLE)
  })
})

test.describe('장터 — 미승인 회원', () => {
  test.use({ storageState: storageStatePath('pending') })

  test('API는 403 + 승인 조합원 메시지다', async ({ request }) => {
    for (const path of ['/api/market', listing(), `${listing()}/comments`]) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(403)
      expect((await res.json()).error).toBe('승인된 조합원만 이용할 수 있습니다.')
    }
  })

  test('상세 화면은 안내 상자만 그리고 매물은 그리지 않는다', async ({ page }) => {
    await page.goto(`/board/market/${fixtures.marketListingId}`)
    await expect(page.getByRole('heading', { name: '조합원만 이용할 수 있습니다' })).toBeVisible()
    await expect(page.getByText(LISTING_TITLE)).toHaveCount(0)
  })

  test('매물 등록은 403이다', async ({ request }) => {
    const res = await request.post('/api/market', {
      data: { title: '미승인 매물', description: 'x', deal_type: 'free', item_category: 'etc' },
    })
    expect(res.status()).toBe(403)
  })
})

test.describe('장터 — 다른 조합원(판매자 아님)', () => {
  test.use({ storageState: storageStatePath('other') })

  test('읽기는 200이다 (조합원끼리는 열려 있다)', async ({ request }) => {
    const list = await request.get('/api/market')
    expect(list.status()).toBe(200)
    const ids = (await list.json()).data.listings.map((l: { id: string }) => l.id)
    expect(ids).toContain(fixtures.marketListingId)

    expect((await request.get(listing())).status()).toBe(200)
    expect((await request.get(`${listing()}/comments`)).status()).toBe(200)
  })

  test('남의 매물 수정·상태 변경은 403 + 수정 권한 없음이다', async ({ request }) => {
    const edit = await request.patch(listing(), {
      data: {
        title: '가로챈 제목',
        description: 'x',
        deal_type: 'sell',
        item_category: 'etc',
        price: 1,
      },
    })
    expect(edit.status()).toBe(403)
    expect((await edit.json()).error).toBe('수정 권한이 없습니다.')

    const status = await request.patch(`${listing()}/status`, { data: { status: 'done' } })
    expect(status.status()).toBe(403)
    expect((await status.json()).error).toBe('수정 권한이 없습니다.')
  })

  test('남의 매물 삭제는 403 + 삭제 권한 없음이다', async ({ request }) => {
    const res = await request.delete(listing())
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('삭제 권한이 없습니다.')
  })

  test('남의 매물 수정 화면은 "없는 페이지"를 그리고 폼을 그리지 않는다', async ({ page }) => {
    // 상태 코드는 보지 않는다 — 상위 `board/loading.tsx`가 스트리밍을 먼저 열어
    // `notFound()`가 나와도 응답은 200으로 이미 나간다(Next.js 동작). 그래서
    // 화면에 무엇이 그려졌는지로 판정한다.
    await page.goto(`/board/market/${fixtures.marketListingId}/edit`)
    await expect(page.getByText('404 — NOT FOUND')).toBeVisible()
    await expect(page.getByRole('heading', { name: '매물 수정' })).toHaveCount(0)
    await expect(page.locator(`input[value="${LISTING_TITLE}"]`)).toHaveCount(0)
  })

  test('댓글 쓰기 경계를 통과한다 — 빈 본문은 인가 뒤의 400이다', async ({ request }) => {
    const res = await request.post(`${listing()}/comments`, { data: { content: '   ' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('내용을 입력해 주세요.')
  })
})

test.describe('장터 — 판매자 본인', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('거래 상태를 바꿀 수 있다(예약중 → 판매중으로 되돌린다)', async ({ request }) => {
    const reserved = await request.patch(`${listing()}/status`, { data: { status: 'reserved' } })
    expect(reserved.status()).toBe(200)
    expect((await (await request.get(listing())).json()).data.listing.status).toBe('reserved')

    const reopened = await request.patch(`${listing()}/status`, { data: { status: 'open' } })
    expect(reopened.status()).toBe(200)
  })

  test('판매자도 남의 문의 댓글은 지우지 못한다', async ({ request }) => {
    const res = await request.delete(`${listing()}/comments/${fixtures.marketCommentId}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('삭제 권한이 없습니다.')
  })

  test('직접 올리지 않은 사진 주소는 400이다', async ({ request }) => {
    const res = await request.patch(listing(), {
      data: {
        title: LISTING_TITLE,
        description: '장터 경계 테스트용',
        deal_type: 'sell',
        item_category: 'instrument',
        price: 10000,
        images: ['https://example.com/not-mine.webp'],
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('직접 올린 사진만 첨부할 수 있습니다.')
  })

  test('다른 매물 경로로 댓글을 지우려 하면 404다(경로 위조)', async ({ request }) => {
    const res = await request.delete(
      `/api/market/${fixtures.marketListingDeletableId}/comments/${fixtures.marketCommentId}`
    )
    expect(res.status()).toBe(404)
  })
})

test.describe('장터 — 관리자', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('관리자도 남의 매물 문구·상태는 고치지 못한다', async ({ request }) => {
    const edit = await request.patch(listing(), {
      data: {
        title: '관리자가 고친 제목',
        description: 'x',
        deal_type: 'sell',
        item_category: 'etc',
        price: 1,
      },
    })
    expect(edit.status()).toBe(403)
    const status = await request.patch(`${listing()}/status`, { data: { status: 'done' } })
    expect(status.status()).toBe(403)
  })

  test('관리자는 남의 댓글을 지울 수 있다', async ({ request }) => {
    const res = await request.delete(`${listing()}/comments/${fixtures.marketCommentDeletableId}`)
    expect(res.status()).toBe(200)
  })

  test('관리자는 남의 매물을 내릴 수 있고, 내린 매물은 404다', async ({ request }) => {
    const path = `/api/market/${fixtures.marketListingDeletableId}`
    expect((await request.delete(path)).status()).toBe(200)
    expect((await request.get(path)).status()).toBe(404)
  })
})
