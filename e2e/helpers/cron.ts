/**
 * 이사회 업무툴 크론(`/api/internal/board-work/*`)을 E2E가 부를 때 쓰는 **로컬 전용** CRON_SECRET.
 * `playwright.config.ts`가 같은 값을 webServer `env.CRON_SECRET`으로 넘긴다(`.env.local`의 운영 값을 이긴다).
 * 운영 시크릿이 아니다 — 로컬 서버에서만 통한다.
 */
export const E2E_CRON_SECRET = 'e2e-local-board-work-cron-secret'

export function cronHeaders(secret: string = E2E_CRON_SECRET): Record<string, string> {
  return { Authorization: `Bearer ${secret}` }
}
