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

/**
 * 경매 경계. 한 경매 위에서 순서대로 진행하는 시나리오라 `serial`이다 — 입찰이
 * 들어오기 전/후로 판매자에게 열리는 동작이 달라지는 것을 보는 게 목적이다.
 * 시드가 매번 입찰을 비우고 경매를 진행 중으로 되돌린다.
 */
test.describe.serial('장터 경매', () => {
  const auction = () => `/api/market/${fixtures.marketAuctionId}`

  test.describe('비로그인·미승인', () => {
    test('비로그인은 입찰 이력도 401이다', async ({ playwright, baseURL }) => {
      const anon = await playwright.request.newContext({ baseURL })
      const res = await anon.get(`${auction()}/bids`)
      expect(res.status()).toBe(401)
      await anon.dispose()
    })

    test('미승인 회원은 입찰할 수 없다', async ({ playwright, baseURL }) => {
      const pending = await playwright.request.newContext({
        baseURL,
        storageState: storageStatePath('pending'),
      })
      const res = await pending.post(`${auction()}/bids`, { data: { amount: 10000 } })
      expect(res.status()).toBe(403)
      expect((await res.json()).error).toBe('승인된 조합원만 이용할 수 있습니다.')
      await pending.dispose()
    })
  })

  test.describe('판매자 — 입찰 전', () => {
    test.use({ storageState: storageStatePath('owner') })

    test('판매자는 자기 경매에 입찰하지 못한다', async ({ request }) => {
      const res = await request.post(`${auction()}/bids`, { data: { amount: 50000 } })
      expect(res.status()).toBe(403)
      expect((await res.json()).error).toBe('내 경매에는 입찰할 수 없습니다.')
    })

    test('진행 중 경매는 거래 상태를 바꿀 수 없다', async ({ request }) => {
      const res = await request.patch(`${auction()}/status`, { data: { status: 'done' } })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('경매가 진행 중일 때는 거래 상태를 바꿀 수 없습니다.')
    })
  })

  test.describe('다른 조합원 — 입찰', () => {
    test.use({ storageState: storageStatePath('other') })

    test('시작가 미만은 400, 시작가 이상은 201이고 이름은 활동명으로 보인다', async ({
      request,
    }) => {
      const low = await request.post(`${auction()}/bids`, { data: { amount: 9999 } })
      expect(low.status()).toBe(400)
      expect((await low.json()).error).toContain('10,000원 이상')

      const ok = await request.post(`${auction()}/bids`, { data: { amount: 10000 } })
      expect(ok.status()).toBe(201)

      const { data } = await (await request.get(`${auction()}/bids`)).json()
      expect(data.auction.current_price).toBe(10000)
      expect(data.auction.current_bidder_name).toBe('authz-other')
      expect(data.bids.map((b: { bidder_name: string }) => b.bidder_name)).toEqual(['authz-other'])
      // 실명·이메일 같은 칸은 응답에 실리지 않는다. 회원 id(UUID)도 싣지 않고,
      // "나인가"만 불리언으로 준다.
      expect(JSON.stringify(data)).not.toContain('@test.local')
      expect(JSON.stringify(data)).not.toContain(fixtures.users.other)
      expect(data.auction.i_am_leading).toBe(true)
      expect(data.bids[0].is_mine).toBe(true)
    })

    test('남의 경매는 다시 열 수 없다', async ({ request }) => {
      const res = await request.post(`${auction()}/relist`, {
        data: { start_price: 5000, min_increment: 500, duration_days: 1 },
      })
      expect(res.status()).toBe(403)
      expect((await res.json()).error).toBe('수정 권한이 없습니다.')
    })

    test('입찰자는 자기 입찰도 무효로 하지 못한다', async ({ request }) => {
      const { data } = await (await request.get(`${auction()}/bids`)).json()
      const res = await request.delete(`${auction()}/bids/${data.bids[0].id}`)
      expect(res.status()).toBe(403)
      expect((await res.json()).error).toBe('입찰 무효 권한이 없습니다.')
    })
  })

  test.describe('판매자 — 입찰 후', () => {
    test.use({ storageState: storageStatePath('owner') })

    test('입찰이 들어온 경매는 판매자가 고치지도 내리지도 못한다', async ({ request }) => {
      const edit = await request.patch(auction(), {
        data: {
          title: '바꾼 제목',
          description: '바꾼 설명',
          deal_type: 'auction',
          item_category: 'audio',
        },
      })
      expect(edit.status()).toBe(400)
      expect((await edit.json()).error).toBe('입찰이 들어온 경매는 수정할 수 없습니다.')

      const del = await request.delete(auction())
      expect(del.status()).toBe(400)
      expect((await del.json()).error).toContain('입찰이 들어온 경매는 내릴 수 없습니다')
    })

    test('진행 중인 경매는 판매자도 다시 열 수 없다(유찰만)', async ({ request }) => {
      const res = await request.post(`${auction()}/relist`, {
        data: { start_price: 5000, min_increment: 500, duration_days: 1 },
      })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('입찰 없이 끝난 경매만 다시 열 수 있습니다.')
    })

    test('판매자도 입찰을 무효로 하지 못한다', async ({ request }) => {
      const { data } = await (await request.get(`${auction()}/bids`)).json()
      const res = await request.delete(`${auction()}/bids/${data.bids[0].id}`)
      expect(res.status()).toBe(403)
    })
  })

  test.describe('관리자', () => {
    test.use({ storageState: storageStatePath('admin') })

    test('관리자는 입찰을 무효로 할 수 있고, 최고가가 다시 계산된다', async ({ request }) => {
      const before = (await (await request.get(`${auction()}/bids`)).json()).data
      const res = await request.delete(`${auction()}/bids/${before.bids[0].id}`)
      expect(res.status()).toBe(200)

      const after = (await (await request.get(`${auction()}/bids`)).json()).data
      expect(after.auction.current_price).toBeNull()
      expect(after.auction.bid_count).toBe(0)
      expect(after.bids[0].voided).toBe(true)
    })
  })
})
