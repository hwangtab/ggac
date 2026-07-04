import { test, expect } from '@playwright/test'

// 로컬 전용 스모크(운영 Supabase 연결 필요).
//
// 회귀 방지: PostContentRenderer 가 브라우저 전용 dompurify 를 SSR 경로에서
// 호출해 content_format='html' 인 게시글 상세가 SSR 500 으로 크래시하던
// 버그(운영 420건)를 isomorphic-dompurify 로 근본 수정했다.
//
// 버그는 html 포맷 글에서만 재현되고 plain/markdown 은 크래시하지 않으므로,
// 첫 글 하나만 확인하면 그 글이 plain/markdown 일 때 버그가 있어도 통과한다.
// 따라서 목록의 상세 링크를 여러 개(최대 10개) 순회하며 각 SSR 응답 상태를
// 직접 단언한다. 목록에 html 포스트가 하나라도 있으면 회귀 시 반드시 실패한다.
//
// DB 미연결로 게시글 링크가 0개면 회귀를 검증할 수 없다 — 이때는 초록불이
// "검증 완료"로 오인되지 않도록 명시적 skip + 경고를 남긴다.
test.describe('board 상세 SSR 회귀 (로컬 DB 필요)', () => {
  test.use({ locale: 'ko-KR' })

  test('실제 게시글 상세들이 SSR 500 없이 본문을 렌더한다', async ({ page }, testInfo) => {
    const listResponse = await page.goto('/board', { waitUntil: 'domcontentloaded' })
    expect(listResponse?.status(), '게시판 목록이 500 없이 응답').toBeLessThan(500)

    // 상세 링크(/board/<id>)만 수집한다. /board/write, /board/<id>/edit 등
    // 작성·수정 라우트는 href 자체로 제외한다(hasNot 필터는 descendant 기준이라
    // 앵커 자신의 href 에는 적용되지 않아 무효 — Minor 3 대응).
    const hrefs = await page.locator('a[href^="/board/"]').evaluateAll(els =>
      els
        .map(el => el.getAttribute('href') || '')
        // /board/<id> 형태만(중첩 세그먼트 write/edit 제외)
        .filter(h => /^\/board\/[^/?#]+\/?(?:[?#].*)?$/.test(h))
        .filter(h => !/^\/board\/(write)\b/.test(h))
    )

    // 순서 보존 중복 제거 후 최대 10개.
    const detailHrefs = Array.from(new Set(hrefs)).slice(0, 10)

    if (detailHrefs.length === 0) {
      const msg =
        'DB 미연결로 게시글 링크가 없어 SSR 회귀를 검증하지 못했습니다 — 회귀 미검증(초록불이 검증 완료가 아님).'
      // eslint-disable-next-line no-console
      console.warn(`[board-detail-ssr] ${msg}`)
      testInfo.annotations.push({ type: 'skip-reason', description: msg })
      test.skip(true, msg)
      return
    }

    // 각 상세를 직접 열어 SSR 응답 상태를 단언한다. html 포스트가 SSR 크래시하면
    // 이 goto 의 status 가 500 이 되어 반드시 실패한다(핵심 회귀 가드).
    for (const href of detailHrefs) {
      const detailResponse = await page.goto(href, { waitUntil: 'domcontentloaded' })
      expect(detailResponse?.status(), `게시글 상세(${href})가 SSR 500 없이 응답`).toBeLessThan(500)

      // PostContentRenderer 본문 컨테이너(.prose)가 렌더됐는지 확인한다.
      await expect(page.locator('.prose').first(), `본문(${href})이 렌더됨`).toBeVisible({
        timeout: 15000,
      })
    }
  })
})
