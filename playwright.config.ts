import { defineConfig, devices } from '@playwright/test'

import { assertNoRemoteTursoTarget } from './e2e/helpers/authState'
import { E2E_CRON_SECRET } from './e2e/helpers/cron'

if (process.env.FORCE_COLOR) {
  delete process.env.NO_COLOR
}

const isCI = !!process.env.CI
const port = Number(process.env.PLAYWRIGHT_PORT || 3101)
const baseURL = `http://127.0.0.1:${port}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'

// 크론 라우트(`/api/internal/*`)의 CRON_SECRET — E2E 서버에는 **늘 로컬 시험값**을 준다. 주지 않으면 `.env.local`의
// 운영 값이 서버에 실리고(Next 는 부모 환경에 없는 키만 .env.local 에서 채운다) 스펙은 그 값을 모르게 된다.
// 스펙 워커도 같은 값을 읽도록 process.env 에 심는다(이사회 업무툴 본문 추출 E2E — authz-board-work·board-work-search).
// 크론 시크릿은 한 곳(e2e/helpers/cron.ts)에서만 정한다 — 스펙이 상수와 env 둘 다 읽으므로 값이 어긋나면 안 된다
process.env.E2E_CRON_SECRET = E2E_CRON_SECRET

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

// **권한 E2E는 운영 빌드(`next build` → `next start`)를 상대로 돈다.** dev 서버로 돌리던
// 때는 약 200건에 11분이 걸렸고, 처음 닿는 라우트를 컴파일하는 동안 30초 타임아웃이 나거나
// (`authz-funding`·`authz-roles`·`board-work-chat`), 로그인 중 dev 서버가
// `Unexpected end of JSON input`을 뱉거나, 미들웨어의 세션 재확인(`/api/auth/get-session`,
// 상한 3초 — `src/middleware/session.ts`)이 컴파일에 밀려 뒤쪽 테스트가 `/login`으로 튕겼다.
// 셋 다 따로 돌리면 통과하는, 앱이 아니라 서버가 만든 실패였다. 운영 빌드는 미리 다 컴파일돼
// 있어 그 원인이 통째로 사라진다 — 그리고 실제 배포와 같은 코드 경로를 검사한다.
//
// 조건은 셋이다:
//  - **`E2E_TURSO_DATABASE_URL`이 있을 때만.** `next build`는 프리렌더하면서 DB를 읽는다
//    (아티스트 등). 그 값이 없으면 빌드가 `.env.local`의 운영 Turso를 읽게 되므로, 빌드
//    경로는 로컬 E2E DB가 지정된 경우에만 탄다. 없으면 예전처럼 dev 서버다.
//  - **CI가 아닐 때만.** CI의 smoke 잡(`--project=chromium`)은 예전 그대로 dev 서버다.
//  - **`PLAYWRIGHT_DEV_SERVER=1`이면 dev 서버로 돌아간다**(탈출구 — 화면을 고치며 HMR로
//    돌려 볼 때).
const useProductionServer =
  !isCI && !!process.env.E2E_TURSO_DATABASE_URL && process.env.PLAYWRIGHT_DEV_SERVER !== '1'

// 운영 빌드 출력은 `.next`가 아니라 `.next-e2e`에 둔다(`next.config.js`의 `distDir`). 같은
// 워크트리에서 `next dev`가 돌고 있어도 서로의 청크를 덮지 않는다.
const E2E_DIST_DIR = '.next-e2e'

// 운영 모드의 레이트리밋은 Upstash가 없으면 쓰기를 503으로 닫는다 — 로컬 가짜 Upstash를
// 함께 띄워 앱이 운영과 같은 Redis 경로를 타게 한다(`e2e/helpers/fakeUpstash.mjs` 주석).
// 포트는 앱 포트에서 1000을 더한 자리다(병렬로 도는 다른 E2E와 겹치지 않게 앱 포트를 따라간다).
const fakeUpstashPort = port + 1000
const FAKE_UPSTASH_TOKEN = 'e2e-local-fake-upstash'

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
    // **영상은 CI에서만 남긴다.**
    //
    // 영상 녹화는 `ms-playwright` 캐시의 `ffmpeg-*` 바이너리를 요구하고, 없으면
    // `browserContext.newPage`가 **테스트마다** 실패한다(실패한 테스트만이 아니다 —
    // `retain-on-failure`도 일단 전부 녹화한 뒤 통과분을 버린다). 이 저장소는
    // 브라우저를 받지 않는 정책이라(아래 `chromium` 프로젝트 주석), 캐시를 비운
    // 머신에서 영상 하나 때문에 전 스위트가 죽는 것은 앞뒤가 안 맞는다.
    // 실측(2026-09-01): 캐시를 비우면 Chrome은 정상 실행되는데 ffmpeg 때문에 29건이 죽었다.
    //
    // 로컬 디버깅은 `trace`(스크린샷 포함)와 `screenshot`으로 충분하고, 둘 다
    // 추가 바이너리를 요구하지 않는다.
    video: isCI ? 'retain-on-failure' : 'off',
  },

  projects: [
    {
      name: 'chromium',
      // **로컬에서는 이미 깔린 시스템 Chrome을 쓴다(다운로드 0).**
      //
      // 이 프로젝트만 번들 브라우저를 고집하는 바람에, 개발자 머신에서
      // `authz`가 아닌 스펙 5개(약 30건 — 게시판 SSR·이사회·홈 모션·비밀번호
      // 재설정·API 회귀)가 **아예 실행되지 못했다.** CI는 `smoke.spec.ts`만
      // 돌리므로 그 30건은 어디에서도 돌지 않는 상태였다(2026-09-01 확인).
      //
      // 번들 브라우저를 받아 해결하려 들지 마라. 저장소 정책은 **받지 않는
      // 것**이다 — `npx playwright install`은 프로젝트 버전이 아닌 최신본을
      // 받아 멀쩡한 빌드를 지운 이력이 있고, 프로젝트 바이너리로 받아도
      // `chromium`과 `chromium-headless-shell`이 따로 놀아 부분 설치로
      // 끝나는 것을 실측했다. 형제 프로젝트(authz 계열)가 진작부터 쓰던
      // 방식으로 통일한다.
      //
      // CI에서는 `channel`을 비워 번들 브라우저를 쓴다 — 러너에 Chrome이
      // 없고 워크플로가 `npx playwright install --with-deps chromium`으로
      // 직접 깔기 때문이다(`.github/workflows/ci.yml`).
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
      },
      // board-work-chat·tabs·files: 로그인 상태(authz-setup)와 로컬 Turso 시드가 필요해 authz 프로젝트에서만 돈다
      testIgnore:
        /authz[.-]|board-work-(chat|tabs|files|editors|search|cron|layout|library)\.spec\.ts/,
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
      testMatch:
        /(authz-(ownership|personal|remaining|maintenance|roles|mailbox|funding|features|email-verification|market|timebank|board-work)|board-work-(chat|tabs|files|editors|search|cron|layout|library))\.spec\.ts/,
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

  webServer: [
    ...(useProductionServer
      ? [
          {
            command: `node e2e/helpers/fakeUpstash.mjs ${fakeUpstashPort} ${FAKE_UPSTASH_TOKEN}`,
            url: `http://127.0.0.1:${fakeUpstashPort}/`,
            reuseExistingServer,
            timeout: 10_000,
          },
        ]
      : []),
    {
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
      //
      // 운영 빌드 경로(`useProductionServer`)는 세 단계를 한 커맨드로 잇는다:
      //  1. `seed-build-fixture.mjs` — 운영 빌드는 아티스트가 0건이면 일부러 실패한다
      //     (`src/lib/data.ts`의 `PublicArtistDataUnavailableError`). 권한 픽스처 시드에는
      //     아티스트가 없으므로 CI 빌드가 쓰는 최소 행을 같은 로컬 DB에 심는다(멱등, 로컬만 허용).
      //  2. `next build` — `npm run build`가 아니다. 그쪽은 이미지 최적화·`llms.txt` 생성을
      //     먼저 돌려 작업 트리(`public/llms.txt` 등)를 바꾼다. 린트는 `npm run lint`가 따로
      //     지키므로 끈다(`--no-lint`). 타입 검사는 Next가 그대로 한다.
      //  3. `next start`
      // 아래 `env`는 커맨드 전체에 걸리므로 **빌드도 같은 값을 본다** — `NEXT_PUBLIC_*`는 빌드
      // 시점에 번들에 박히고, 프리렌더가 읽는 DB도 이 `TURSO_DATABASE_URL`(로컬)이다.
      command: useProductionServer
        ? 'env -u NO_COLOR sh -c "node scripts/testing/seed-build-fixture.mjs && npx next build --no-lint && npx next start"'
        : 'env -u NO_COLOR npm run dev',
      env: {
        // 운영 빌드에서도 같은 값으로 둔다(운영 모드의 기본값은 켜짐 — `src/middleware/csp.ts`).
        // 권한 스위트(authz·authz-public)는 켜도 결과가 같았다(2026-11-02 실측: 198 passed,
        // 정책 36만 실패). 그래도 끈 채 두는 이유는 같은 서버를 쓰는 `chromium` 프로젝트의
        // 하이드레이션 의존 스펙을 운영 빌드 + strict CSP로 검증하지 않았기 때문이다.
        NEXT_STRICT_CSP: 'false',
        ...(useProductionServer
          ? {
              NEXT_DIST_DIR: E2E_DIST_DIR,
              UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${fakeUpstashPort}`,
              UPSTASH_REDIS_REST_TOKEN: FAKE_UPSTASH_TOKEN,
            }
          : {}),
        // 미들웨어의 system_settings 캐시(기본 60초 TTL)를 E2E 서버에서만 0으로
        // 낮춘다. authz-maintenance.spec.ts가 DB의 system_settings를 직접 UPDATE해
        // 유지보수 모드를 켜고 끄는데, 캐시가 살아 있으면 authz-setup의 로그인
        // 내비게이션이 먼저 채운 값(꺼짐)이 최대 60초간 그대로 남아 방금 켠
        // 유지보수가 반영되지 않는 것처럼 보인다. 운영 빌드/배포 커맨드에는 이
        // 변수를 넣지 않는다.
        SETTINGS_CACHE_TTL_MS: '0',
        // 후원 취소 경계(`e2e/authz-funding.spec.ts`)는 결제 킬스위치가 꺼져
        // 있으면 인가 판정에 닿기도 전에 503을 받는다
        // (`isPaymentEnabled()` — `src/lib/payments/toss/config.ts`). 그러면
        // "막았다"와 "결제가 원래 꺼져 있었다"를 구분할 수 없다. 개발자
        // `.env.local`의 값에 좌우되지 않도록 여기서 켜 둔다.
        //
        // **결제가 실제로 일어나지는 않는다.** 그 스펙의 픽스처 후원에는 결제
        // 연결(`payment_id`)이 없어, 라우트는 신원 확인을 지난 뒤 토스를 부르기
        // 전에 400으로 끝난다. 토스 호출은 `https://api.tosspayments.com` 상수라
        // 애초에 로컬로 돌릴 수 없고, 이 스위치만으로는 아무 키도 생기지 않는다.
        NEXT_PUBLIC_PAYMENT_MODE: 'toss',
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
        // 이사회 업무툴 파일(비공개 Blob)은 **E2E에서 운영 비공개 저장소로 절대 떨어지지 않게** 늘 명시한다.
        // 업무툴 저장소 계층(src/work/lib/files/storage.ts)은 `BOARD_WORK_BLOB_READ_WRITE_TOKEN`이 정의돼 있으면(빈 값 포함)
        // 그것만 쓴다 — 빈 값이면 저장소를 부르지 않고 503이다. `.env.local`의 운영 `PRIVATE_BLOB_READ_WRITE_TOKEN`
        // (DB 백업까지 든 저장소)은 Next가 부모 환경에 이미 있는 키를 덮지 않으므로 이 값을 이기지 못한다.
        // 시험용 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)을 셸에 주면 그것으로 실제 업로드 E2E
        // (e2e/board-work-files.spec.ts)가 돌고, 그때는 다른 비공개 저장소 소비자(서류함·메일함)도 같은 시험 저장소를 본다.
        BOARD_WORK_BLOB_READ_WRITE_TOKEN: process.env.BOARD_WORK_TEST_BLOB_TOKEN ?? '',
        ...(process.env.BOARD_WORK_TEST_BLOB_TOKEN
          ? { PRIVATE_BLOB_READ_WRITE_TOKEN: process.env.BOARD_WORK_TEST_BLOB_TOKEN }
          : {}),
        // BETTER_AUTH_URL — Better Auth는 요청의 Origin 헤더를 이 값과 정확히
        // 비교해 다르면 403 INVALID_ORIGIN을 던진다(실측:
        // `[Better Auth]: Invalid origin: http://127.0.0.1:3101`).
        // `.env.local`의 값(`http://localhost:3000`)은 이 프로젝트가 쓰는 고정
        // E2E 포트(3101)와 호스트 표기(127.0.0.1 vs localhost) 둘 다 달라
        // authz-setup의 로그인 자체가 항상 실패했다 — 여기서 `baseURL`로 맞춘다.
        BETTER_AUTH_URL: baseURL,
        NEXT_PUBLIC_SITE_URL: baseURL,
        // 업무툴 업로드 직후 추출 훅(`scheduleTextExtraction`)과 크론 E2E가 이 값으로 자기 자신을 부른다(e2e/helpers/cron.ts)
        // **E2E 서버에서 실제 메일·푸시가 나갈 길을 닫는다.** `.env.local`에는 운영 Resend 키가 있다 — Next는 부모
        // 환경에 이미 정의된 키(빈 값 포함)를 `.env.local`로 덮지 않으므로 빈 값을 넘기면 그 키는 서버에 닿지 않는다.
        // 업무툴 멘션 메일은 `log` 전송(보내지 않고 건수만 로그)으로 돌려 크론 경로는 끝까지 탄다(src/work/lib/digest/mailer.ts).
        // 웹 푸시는 VAPID 키가 비면 no-op이다(src/work/lib/push/send.ts).
        RESEND_API_KEY: '',
        BOARD_WORK_DIGEST_TRANSPORT: 'log',
        WEB_PUSH_PUBLIC_KEY: '',
        NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY: '',
        WEB_PUSH_PRIVATE_KEY: '',
        CRON_SECRET: E2E_CRON_SECRET,
      },
      url: `${baseURL}/robots.txt`,
      reuseExistingServer,
      // 운영 빌드는 시드 + `next build`(타입 검사 포함)까지 기다려야 한다 — 캐시가 빈 첫
      // 빌드도 덮도록 넉넉히 잡는다. dev 서버는 예전 값 그대로다.
      timeout: useProductionServer ? 900_000 : 120_000,
    },
  ],
})
