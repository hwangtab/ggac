import { defineConfig, devices } from '@playwright/test'

if (process.env.FORCE_COLOR) {
  delete process.env.NO_COLOR
}

const isCI = !!process.env.CI
const port = Number(process.env.PLAYWRIGHT_PORT || 3101)
const baseURL = `http://127.0.0.1:${port}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // NEXT_STRICT_CSP를 명시적으로 꺼서 E2E가 로컬 .env.local의 CSP 실험 상태에
    // 좌우되지 않게 한다 — strict CSP가 dev에 켜져 있으면 하이드레이션 의존
    // 테스트(password-reset 등)가 환경 요인으로 실패한다.
    command: `env -u NO_COLOR NEXT_STRICT_CSP=false PORT=${port} npm run dev`,
    url: `${baseURL}/robots.txt`,
    reuseExistingServer,
    timeout: 120_000,
  },
})
