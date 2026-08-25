import { defineConfig, devices } from '@playwright/test'

import { assertNoRemoteTursoTarget } from './e2e/helpers/authState'

if (process.env.FORCE_COLOR) {
  delete process.env.NO_COLOR
}

const isCI = !!process.env.CI
const port = Number(process.env.PLAYWRIGHT_PORT || 3101)
const baseURL = `http://127.0.0.1:${port}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'

// 권한 E2E는 계정을 만들고 글을 쓰고 유지보수 모드를 토글한다 — 대상이 운영
// Turso면 그게 전부 실제 회원 데이터 위에서 벌어진다. 그래서 대상 지정을
// `TURSO_DATABASE_URL`이 아니라 **별도 이름**(`E2E_TURSO_DATABASE_URL`)으로
// 받는다: 개발자 셸에 이미 운영 `TURSO_DATABASE_URL`이 export돼 있어도 그
// 값으로는 절대 돌지 않고, e2e 전용 변수를 의도적으로 지정해야만 돈다.
//
// 여기서 한 번 process.env에 심으면 webServer(Next.js 앱)와 스펙 워커 프로세스가
// **같은 값**을 본다. 예전에는 webServer 커맨드에만 주입해서, 스펙 파일이 직접
// 읽는 `TURSO_DATABASE_URL`은 개발자가 따로 export해야 했고 두 값이 어긋나면
// "앱은 A를 읽고 스펙은 B를 쓰는" 상태가 조용히 만들어졌다.
if (process.env.E2E_TURSO_DATABASE_URL) {
  process.env.TURSO_DATABASE_URL = process.env.E2E_TURSO_DATABASE_URL
  // 로컬 `turso dev`는 토큰을 요구하지 않는다. 셸에 남아 있는 운영 토큰이
  // 그대로 따라붙지 않도록 함께 지운다.
  delete process.env.TURSO_AUTH_TOKEN
}

// **옮겨 심기가 끝난 자리에서, 조건 없이 판정한다.** 스펙 파일도 각자
// assertLocalTurso()를 부르지만 그건 파일 로드 시점, 즉 webServer(`npm run
// dev`)가 이미 뜬 뒤다 — 잘못된 대상을 주면 앱이 **운영을 가리킨 채 먼저
// 뜨고** readiness 요청이 운영을 읽은 다음에야 전 스펙이 죽는다. 여기서
// 막으면 dev 서버가 시작조차 하지 않는다.
//
// 이 호출이 위 `if` **밖**에 있어야 하는 이유: Playwright는 webServer에
// `{...process.env, ...webServer.env}`를 넘긴다. `E2E_TURSO_DATABASE_URL`을
// 주지 않고 셸에 운영 `TURSO_DATABASE_URL`만 export된 경우 위 블록은 통째로
// 건너뛰지만 **운영 URL은 상속으로 그대로 dev 서버에 간다.** 안에 두면 그
// 경로가 무방비였다.
assertNoRemoteTursoTarget()

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
      testIgnore: /authz[.-]/,
    },
    // authz 계열은 로컬 Turso(`turso dev`)와 픽스처 시드가 있어야 도는 로컬 전용
    // 프로젝트다(CI는 돌리지 않는다). 단계 4 Task 5로 앱에서 Supabase가 사라진 뒤로
    // 로컬 Supabase 스택은 더 이상 필요하지 않다 — 실행 절차는 scripts/turso/README.md.
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
      testMatch: /authz-(ownership|personal|remaining|maintenance|roles)\.spec\.ts/,
      dependencies: ['authz-setup'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    // authz-boundaries는 로그인 상태(storageState)를 쓰지 않는 비인증 경계 스펙이라
    // authz-setup 의존이 없다. authz 프로젝트가 만들어지기 전에 추가된 파일이라
    // testMatch에서 누락돼 번들 브라우저를 쓰는 chromium 프로젝트로 떨어져 있었고,
    // 그 결과 번들 브라우저가 없는 머신에서 7개 테스트가 통째로 실행되지 못했다.
    // 형제들과 같이 시스템 Chrome을 쓴다(다운로드 0). CI는 smoke.spec.ts만 돌린다.
    {
      name: 'authz-public',
      testMatch: /authz-boundaries\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  webServer: {
    // 권한 E2E는 로컬 Turso를 가리켜야 한다(운영에 글을 쓰면 안 된다).
    // Next.js는 부모 프로세스가 넘긴 환경변수를 .env.local보다 우선한다 —
    // 위에서 `E2E_TURSO_DATABASE_URL`을 `TURSO_DATABASE_URL`로 옮겨 심었으므로
    // 그 값이 .env.local(운영 Turso를 가리킴)을 이긴다.
    //
    // NEXT_STRICT_CSP를 명시적으로 꺼서 E2E가 로컬 .env.local의 CSP 실험 상태에
    // 좌우되지 않게 한다 — strict CSP가 dev에 켜져 있으면 하이드레이션 의존
    // 테스트(password-reset 등)가 환경 요인으로 실패한다.
    //
    // **값은 커맨드 문자열이 아니라 `env`로 넘긴다.** 커맨드에 넣으면 그 문자열이
    // 프로세스 인자로 남아 같은 머신의 아무 사용자나 `ps`로 읽을 수 있다 —
    // 아래 `PUBLIC_BLOB_READ_WRITE_TOKEN`이 정확히 그 모양이었다.
    command: 'env -u NO_COLOR npm run dev',
    env: {
      NEXT_STRICT_CSP: 'false',
      // 미들웨어의 system_settings 캐시(기본 60초 TTL)를 E2E 서버에서만 0으로
      // 낮춘다. authz-maintenance.spec.ts가 DB의 system_settings를 직접 UPDATE해
      // 유지보수 모드를 켜고 끄는데, 캐시가 살아 있으면 authz-setup의 로그인
      // 내비게이션이 먼저 채운 값(꺼짐)이 최대 60초간 그대로 남아 방금 켠
      // 유지보수가 반영되지 않는 것처럼 보인다. 운영 빌드/배포 커맨드에는 이
      // 변수를 넣지 않는다.
      SETTINGS_CACHE_TTL_MS: '0',
      PORT: String(port),
      // TURSO_DATABASE_URL — 없으면 .env.local의 운영 Turso를 그대로 가리킨다.
      // 파일 상단에서 `E2E_TURSO_DATABASE_URL`이 설정됐을 때만 process.env에
      // 옮겨 심었고(그 자리에서 로컬인지도 판정했다), 여기서 그 값을 dev 서버에
      // 명시적으로 넘긴다(스펙 워커와 앱이 같은 DB를 보게 하는 배선의 나머지 절반).
      ...(process.env.E2E_TURSO_DATABASE_URL
        ? { TURSO_DATABASE_URL: process.env.E2E_TURSO_DATABASE_URL }
        : {}),
      // 첨부파일 업로드(정책 36, authz-remaining.spec.ts)는 Vercel Blob 하나만
      // 쓴다 — Task 5에서 제공자 분기가 사라졌다. 토큰이 없으면 라우트가
      // 업로드 전에 `hasPublicBlobStore()`로 거부하므로 그 테스트가 통과할 수
      // 없다. **공개 스토어 토큰만** 넘긴다: 이 저장소는 공개이고, 비공개
      // 스토어(`PRIVATE_BLOB_READ_WRITE_TOKEN`, 이사회 서류)는 권한 E2E가
      // 건드리지 않는다. 값은 셸 환경에서만 오고 저장소에는 남지 않는다.
      ...(process.env.PUBLIC_BLOB_READ_WRITE_TOKEN
        ? { PUBLIC_BLOB_READ_WRITE_TOKEN: process.env.PUBLIC_BLOB_READ_WRITE_TOKEN }
        : {}),
      ...(process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL
        ? { NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL }
        : {}),
      // BETTER_AUTH_URL — Better Auth는 요청의 Origin 헤더를 이 값과 정확히
      // 비교해 다르면 403 INVALID_ORIGIN을 던진다(실측:
      // `[Better Auth]: Invalid origin: http://127.0.0.1:3101`).
      // `.env.local`의 값(`http://localhost:3000`)은 이 프로젝트가 쓰는 고정
      // E2E 포트(3101)와 호스트 표기(127.0.0.1 vs localhost) 둘 다 달라
      // authz-setup의 로그인 자체가 항상 실패했다 — 여기서 `baseURL`로 맞춘다.
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
    url: `${baseURL}/robots.txt`,
    reuseExistingServer,
    timeout: 120_000,
  },
})
