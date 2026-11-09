import { expect, test } from '@playwright/test'

// 회귀 방지: 세그먼트에 loading.tsx가 있으면 하위 페이지가 Suspense 안에서
// 스트리밍되어 notFound()가 HTTP 상태를 404로 바꾸지 못한다(soft-404, 200 응답).
// 목록 페이지는 (list) 라우트 그룹으로 옮겨 loading.tsx를 거기에만 둔다.
const DETAIL_ROUTES = [
  '/artists/no-such-artist-xyz',
  '/projects/no-such-project-xyz',
  '/funding/no-such-campaign-xyz',
  '/tickets/no-such-performance-xyz',
  '/board/no-such-post-xyz',
  '/board/market/no-such-item-xyz',
  '/board/timebank/no-such-item-xyz',
]

test.describe('존재하지 않는 상세 페이지는 404를 반환한다', () => {
  for (const path of DETAIL_ROUTES) {
    test(`GET ${path} -> 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status()).toBe(404)
    })
  }
})
