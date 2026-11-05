import { expect, type APIResponse } from '@playwright/test'

/**
 * 첨부 다운로드 라우트가 **인가를 통과해 저장소 단계까지 갔다**는 것을 확인한다.
 *
 * E2E 서버는 운영 비공개 Blob 토큰을 쥐지 않는다(`playwright.config.ts` — 쥐고 있으면 로컬 DB를 보면서 운영
 * 저장소를 만지게 된다). 시험 저장소 토큰이 없으면 저장소 호출이 던지고 라우트는 **자기 메시지의 500**을
 * 준다. 그 500은 "인가는 통과했고 저장소가 없다"는 뜻이다 — 401·403이 아니라는 점이 이 테스트들이 증명하려는
 * 전부다. `requireAdmin()` 자체가 프로필 조회에 실패해도 500이 나므로(`adminAuth.ts`) 아무 500이나 통과시키지
 * 않고 **라우트 고유의 메시지**로만 구분한다.
 */
export async function expectReachedStorage(res: APIResponse, allowed: number[] = [200, 404]) {
  const status = res.status()
  if (allowed.includes(status)) return
  expect(status, `인가를 통과하지 못했거나 라우트가 망가졌다 (${status})`).toBe(500)
  const body = await res.json().catch(() => null)
  expect(String(body?.error ?? ''), '저장소 단계의 500이 아니다').toMatch(
    /^첨부를 (불러올|조회할) 수 없습니다/
  )
}
