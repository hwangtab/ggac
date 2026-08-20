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
    // 브라우저 로케일을 ko-KR로 고정한다. next-intl은 localePrefix가 'as-needed'라
    // Accept-Language로 로케일을 협상하는데(`/` → 307 `/en`), Playwright 크로미움의
    // 기본값은 en-US라서 테스트가 실행 머신의 언어 설정에 좌우됐다. 그 결과 홈
    // 제목·canonical이 영문 로케일로 나와 기본 로케일(ko)을 전제한 단정이 깨졌다.
    // 여기서 고정해야 어느 머신에서 돌리든 같은 결과가 나오고, `['/', '/en']`을
    // 순회하는 테스트가 실제로 두 로케일을 검사하게 된다.
    locale: 'ko-KR',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /authz-(setup|ownership|personal|remaining|maintenance)/,
    },
    // authz 계열은 로컬 Supabase 스택이 있어야 도는 로컬 전용 프로젝트다(CI는 돌리지 않는다).
    // channel: 'chrome'으로 개발자 머신에 이미 설치된 Chrome을 쓴다 — Playwright 번들
    // 브라우저(약 150MB)를 따로 받지 않아도 권한 경계 증명을 재현할 수 있게 하려는 것이다.
    // CI가 실행하는 위 `chromium` 프로젝트는 번들 브라우저를 그대로 쓴다.
    {
      name: 'authz-setup',
      testMatch: /authz\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'authz',
      testMatch: /authz-(ownership|personal|remaining|maintenance)\.spec\.ts/,
      dependencies: ['authz-setup'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  webServer: {
    // 권한 E2E는 로컬 Supabase 스택을 가리켜야 한다(운영에 글을 쓰면 안 된다).
    // Next.js는 부모 프로세스가 넘긴 환경변수를 .env.local보다 우선한다 —
    // E2E_SUPABASE_* 가 설정돼 있으면 그것으로 덮어쓴다.
    //
    // NEXT_STRICT_CSP를 명시적으로 꺼서 E2E가 로컬 .env.local의 CSP 실험 상태에
    // 좌우되지 않게 한다 — strict CSP가 dev에 켜져 있으면 하이드레이션 의존
    // 테스트(password-reset 등)가 환경 요인으로 실패한다.
    command: [
      'env -u NO_COLOR NEXT_STRICT_CSP=false',
      `PORT=${port}`,
      process.env.E2E_SUPABASE_URL
        ? `NEXT_PUBLIC_SUPABASE_URL=${process.env.E2E_SUPABASE_URL}`
        : '',
      process.env.E2E_SUPABASE_ANON_KEY
        ? `NEXT_PUBLIC_SUPABASE_ANON_KEY=${process.env.E2E_SUPABASE_ANON_KEY}`
        : '',
      process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
        ? `SUPABASE_SERVICE_ROLE_KEY=${process.env.E2E_SUPABASE_SERVICE_ROLE_KEY}`
        : '',
      'npm run dev',
    ]
      .filter(Boolean)
      .join(' '),
    url: `${baseURL}/robots.txt`,
    reuseExistingServer,
    timeout: 120_000,
  },
})
