import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'

import { applyCSP } from './middleware/csp'
import { getSystemSettings } from './middleware/settings'
import { handleAuth } from './middleware/auth'
import { getMaintenanceResponse } from './middleware/maintenance'
import { routing } from './i18n/routing'
import { verifySessionFresh } from './middleware/session'

const intlMiddleware = createIntlMiddleware(routing)

// 유지보수 모드가 켜져 있어도 항상 통과해야 하는 최소 집합.
// 막으면 관리자 판정 자체가 불가능해지거나(로그인·세션 확인) 배포 스모크 체크가
// 항상 실패한다(`.github/workflows/post-deploy-smoke.yml` → scripts/utils/deployment/smoke-check.mjs
// → GET /api/health).
/**
 * 유지보수 모드에서도 열어두는 경로.
 *
 * 두 종류를 구분한다:
 * - `EXACT`는 정확히 그 경로만 통과한다. 접두사로 두면 `/api/health`가
 *   `/api/healthcheck`·`/api/health-report` 같은 **미래에 생길** 라우트까지
 *   조용히 동결에서 빼준다 — 예외는 최소 집합이어야 하므로 세그먼트에 못박는다.
 * - `PREFIX`는 하위 경로가 실제로 있는 것만 둔다. `/api/auth/`는
 *   `[...all]` 캐치올이라 하위 경로 전체가 인증 흐름이다.
 *
 * `/api/inbound/`와 `/api/internal/`도 같은 이유로 면제한다 — **유지보수
 * 우회가 아니다.** 이 두 접두사는 세션과 무관한 자체 게이트를 이미 갖고
 * 있다: 웹훅(`/api/inbound/resend`)은 Svix 서명이, 크론(`/api/internal/*`)은
 * `timingSafeEqual` 토큰이 각각 판정한다. 막으면 웹훅이 유지보수 시간만큼
 * 재시도를 태우다 결국 포기하고, 크론도 그동안 멈춘다 — 응답 코드로 "다시
 * 보내라"를 말하는 두 경로가, 정작 우리가 아무것도 처리할 생각이 없는 동안
 * 그 신호를 내보내는 셈이다.
 */
const MAINTENANCE_EXEMPT_EXACT = ['/api/health']
const MAINTENANCE_EXEMPT_PREFIXES = ['/api/auth/', '/api/inbound/', '/api/internal/']

/**
 * 정본 호스트. 검색엔진에 색인시킬 주소이고, `getSiteUrl()`이 canonical과
 * hreflang에 박는 주소이기도 하다(`src/utils/site.ts`).
 */
const CANONICAL_HOST = 'ggac.kr'

/**
 * 정본으로 모을 별칭 호스트. **정확히 일치할 때만** 넘긴다.
 *
 * `.vercel.app`을 접미사로 잡으면 프리뷰 배포(`ggac-git-….vercel.app`)까지
 * 전부 프로덕션으로 튕겨 나가 리뷰가 불가능해진다. 별칭은 손으로 적는다.
 */
const CANONICAL_HOST_ALIASES = new Set(['www.ggac.kr', 'ggac.vercel.app'])

/**
 * 별칭 호스트로 들어온 요청을 정본으로 308 넘긴다. 아니면 `null`.
 *
 * 두 별칭이 같은 사이트를 200으로 그대로 내주고 있었다. 검색엔진 입장에서는
 * 같은 내용이 세 주소에 있고, 정작 페이지가 스스로 적는 canonical·hreflang은
 * `ggac.kr`만 가리킨다 — 주소와 선언이 어긋나면 색인 신호가 갈린다.
 *
 * **`/api/*`에는 걸지 않는다**(호출부가 그 앞에서 갈린다). 그쪽을 두드리는
 * 것은 사람이 아니라 GitHub Actions 크론과 외부 웹훅이고, 그들 다수는
 * 리다이렉트를 따라가지 않아 여기서 같이 넘기면 조용히 끊긴다 — 실제로
 * 지원사업·회비 워크플로 둘이 `https://www.ggac.kr/api/internal/...`로
 * POST한다. 색인과도 무관한 경로다.
 *
 * next.config의 `redirects()`가 아니라 미들웨어에 두는 이유도 그 예외다.
 * `redirects()`에서 `/api`만 빼려면 source에 부정 전방탐색 정규식을 써야 하고,
 * 그 패턴이 루트(`/`)까지 무는지는 빌드를 돌려야 알 수 있다. 여기서는 이미
 * `/api/` 분기가 위에서 끝나 있어 아무 패턴도 필요 없다.
 */
function canonicalHostRedirect(request: NextRequest): NextResponse | null {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
  if (!CANONICAL_HOST_ALIASES.has(host)) return null

  const url = new URL(request.url)
  url.protocol = 'https:'
  url.hostname = CANONICAL_HOST
  url.port = ''
  return NextResponse.redirect(url, 308)
}

/**
 * **이미 움직인 돈을 마저 세우는 경로.** 유지보수는 새 행동을 멈추는
 * 스위치이지, 진행 중인 결제를 버리는 스위치가 아니다.
 *
 * 토스 위젯에서 결제를 승인한 사람은 그 순간 카드가 이미 긁혔고, 우리 쪽
 * 승인(`confirm`)이 끝나야 후원·예매·회비가 성립한다. 그 사이에 사무국이
 * 유지보수를 켜면 리다이렉트로 돌아온 요청이 503을 받고, 결제는 승인되지
 * 않은 채 남는다 — 후원자는 돈이 빠져나간 화면과 "점검 중" 안내를 동시에
 * 보게 되고, 되돌리려면 사람이 손으로 취소를 걸어야 한다.
 *
 * **우회가 아니다.** 셋 다 세션과 별개의 자체 게이트를 이미 갖고 있다:
 * `orderId`·`paymentKey`·대상 id 세 값이 DB의 같은 행에서 짝이 맞아야 하고,
 * 금액까지 대조한 뒤에야 승인이 나간다(회비는 그 위에
 * `requireActiveMember`가 더 걸린다). 준비(`prepare`)와 새 후원·예매는
 * 면제하지 않는다 — 그쪽이 막아야 할 "새 행동"이다.
 *
 * 화면도 함께 연다. 승인을 부르는 것은 토스가 돌려보낸 성공 화면이라
 * (`.../success/page.tsx`가 `useEffect`에서 confirm을 호출한다) 화면이 503이면
 * 라우트를 열어 둔 의미가 없다.
 */
const PAYMENT_CONFIRM_EXEMPT_API = [
  '/api/funding/pledges/confirm',
  '/api/tickets/confirm',
  '/api/payments/dues/confirm',
]
/**
 * `localePrefix: 'as-needed'`라 한국어는 접두사가 없고 영어는 `/en/...`이
 * 붙는다. 목록은 접두사 없는 형태 하나만 적고 로케일 변형을 여기서 펼친다 —
 * 로케일이 늘어도 목록을 다시 적지 않는다.
 */
const PAYMENT_CONFIRM_EXEMPT_PAGES = new Set(
  ['/funding/success', '/tickets/success', '/mypage/dues/success'].flatMap(path => [
    path,
    ...routing.locales.map(locale => `/${locale}${path}`),
  ])
)

function isMaintenanceExempt(pathname: string): boolean {
  return (
    MAINTENANCE_EXEMPT_EXACT.includes(pathname) ||
    PAYMENT_CONFIRM_EXEMPT_API.includes(pathname) ||
    MAINTENANCE_EXEMPT_PREFIXES.some(p => pathname.startsWith(p))
  )
}

// handleAuth·getSystemSettings가 기반 응답(res)에 기록한 쿠키를, 미들웨어가 새로
// 반환하는 응답(리다이렉트·유지보수)에도 복사해 브라우저까지 전달한다. 누락하면
// 세션 갱신이 유실되어 다음 요청에 로그아웃될 수 있다.
function copyResponseCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach(cookie => to.cookies.set(cookie))
  // 미들웨어가 새로 반환하는 응답(리다이렉트·유지보수 503·가입중단 403 HTML)은
  // applyCSP를 직접 거치지 않는다. 이미 CSP가 적용된 기반 응답(res)의 헤더를
  // 복사해 CSP 없는 HTML이 새지 않게 한다(코드리뷰 CONFIRMED — next.config의
  // 정적 CSP 제거로 이 응답들의 커버가 사라졌던 회귀 보강).
  const csp = from.headers.get('content-security-policy')
  if (csp && !to.headers.has('content-security-policy')) {
    to.headers.set('content-security-policy', csp)
  }
  return to
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API 라우트: 페이지 파이프라인(next-intl rewrite·CSP·handleAuth 리다이렉트)은
  // 타지 않는다. 유지보수 판정만 전담한다.
  if (pathname.startsWith('/api/')) {
    // 로그인·세션 확인(/api/auth/*)과 헬스체크(/api/health)는 유지보수 여부와
    // 무관하게 항상 통과한다 — 막으면 관리자가 스스로를 유지보수 벽에 가둔다.
    if (isMaintenanceExempt(pathname)) {
      return NextResponse.next()
    }

    const systemSettings = await getSystemSettings()

    // 유지보수가 꺼져 있으면(평시) 세션을 읽지 않고 즉시 통과한다 — matcher
    // 확장 이전과 같은 동작·비용을 유지한다. settingsCache가 60초 TTL이라
    // 이 조회는 대부분 캐시 히트다.
    if (!systemSettings?.maintenanceMode) {
      return NextResponse.next()
    }

    // 유지보수 ON: 관리자만 통과시킨다. 판정을 위해서만 세션을 읽는다 — 유지보수는
    // 드물고 저트래픽이라 이 왕복 비용은 무시할 만하다(평시 경로에는 없다).
    const res = NextResponse.next()
    const authResult = await handleAuth(request, res, systemSettings)
    let isAdmin = authResult.profile?.is_admin === true

    // 페이지 경로와 동일한 근거: readMiddlewareSession()의 쿠키 캐시 판정은 전역
    // 로그아웃·비밀번호 변경으로 취소된 세션을 캐시 만료(최대 5분)까지 감지하지
    // 못한다. 우회를 허용하기 직전에만 verifySessionFresh()로 DB를 왕복해
    // 1회 재검증한다.
    if (isAdmin) {
      const freshSession = await verifySessionFresh(request)
      if (!freshSession) {
        isAdmin = false
      }
    }

    if (!isAdmin) {
      return copyResponseCookies(
        res,
        getMaintenanceResponse(systemSettings.maintenanceMessage, { isApi: true })
      )
    }

    return res
  }

  // 별칭 호스트(www·vercel.app)를 정본으로 모은다. 정적 파일 통과보다 **앞에**
  // 둔다 — sitemap.xml·robots.txt도 정본 주소에서 나와야 한다.
  const hostRedirect = canonicalHostRedirect(request)
  if (hostRedirect) return hostRedirect

  // 정적 파일 및 Next.js 내부 경로 패스
  if (pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Trailing slash 정규화: `/about/` → `/about` 301 리디렉션.
  // next-intl locale 처리 이전에 수행하여 이중 리디렉션 방지.
  //
  // **`request.nextUrl.clone()`을 쓰지 마라.** `NextURL`은 pathname setter가
  // 내부 포맷 결과에 반영되지 않아, `url.pathname`은 `/artists`로 바뀌는데
  // `toString()`과 Location 헤더는 여전히 `/artists/`가 나온다. 그러면 이 블록이
  // 자기 자신으로 301을 내보내 **무한 리다이렉트**가 된다(브라우저는
  // ERR_TOO_MANY_REDIRECTS). 슬래시가 붙은 모든 URL이 열리지 않았다 —
  // 외부 링크·북마크·메일·QR이 슬래시를 달고 있으면 그 방문자는 페이지를
  // 아예 못 봤다. 컷오버 후 감사(2026-08-27)에서 발견됐고 이관 이전부터 있었다.
  //
  // 표준 `URL`은 setter가 정상 동작하며 쿼리스트링과 로케일 접두사를 보존한다.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const url = new URL(request.url)
    url.pathname = pathname.replace(/\/+$/, '')
    return NextResponse.redirect(url, 301)
  }

  // /auth/* 는 [locale] 바깥의 비localized 라우트(예: /auth/callback 콜백 핸들러)다.
  // next-intl이 /ko/auth/callback 으로 rewrite하면 [locale] 세그먼트에 해당 라우트가
  // 없어 404가 되므로, next-intl 처리를 건너뛰고 라우트 핸들러로 바로 통과시킨다.
  // (콜백이 세션을 직접 수립하므로 auth 미들웨어도 불필요. CSP 헤더만 적용.)
  if (pathname.startsWith('/auth/')) {
    const authRes = NextResponse.next()
    applyCSP(request, authRes)
    return authRes
  }

  // next-intl 미들웨어 실행: locale 감지 + [locale] 라우트 rewrite
  // localePrefix: 'as-needed'이므로 ko(기본)는 prefix 없이, en은 /en/ prefix.
  const intlRes = intlMiddleware(request)

  // intl이 redirect를 발생시킨 경우(예: /en 경로 정규화) 그대로 반환
  if (
    intlRes.status === 301 ||
    intlRes.status === 302 ||
    intlRes.status === 307 ||
    intlRes.status === 308
  ) {
    return intlRes
  }

  // intlRes를 기반으로 CSP + auth 적용.
  // intlRes는 rewrite 정보([locale] 라우팅)를 담고 있으므로 이를 기반으로 사용.
  const res = intlRes

  // CSP 보안 헤더 적용
  applyCSP(request, res)

  const systemSettings = await getSystemSettings()
  const authResult = await handleAuth(request, res, systemSettings)

  if (!authResult.shouldContinue && authResult.response) {
    return copyResponseCookies(res, authResult.response)
  }

  if (systemSettings?.maintenanceMode && !PAYMENT_CONFIRM_EXEMPT_PAGES.has(pathname)) {
    let isAdmin = authResult.profile?.is_admin === true

    // 유지보수 화이트리스트는 미들웨어 신원이 유일한 종단 게이트다 — 이 503은 여기서
    // 끝나고 하류 API/RSC의 getSession 재검증이 구제하지 않는다. handleAuth는
    // readMiddlewareSession()의 쿠키 캐시로 신원을 판정하므로 전역 로그아웃·비밀번호
    // 변경으로 취소된 세션을 캐시 만료(최대 5분)까지 감지하지 못한다. 우회를 허용하기
    // 직전에만 verifySessionFresh()로 DB를 왕복해 1회 재검증해 취소된 관리자
    // 세션이 유지보수 벽을 넘지 못하게 한다. 유지보수는 드물고 저트래픽이라 왕복
    // 비용은 무시할 만하며, 평시(유지보수 OFF) 경로에는 이 왕복이 없다.
    if (isAdmin) {
      const freshSession = await verifySessionFresh(request)
      if (!freshSession) {
        isAdmin = false
      }
    }

    if (!isAdmin) {
      return copyResponseCookies(res, getMaintenanceResponse(systemSettings.maintenanceMessage))
    }
  }

  return res
}

export const config = {
  matcher: [
    // `api`를 더 이상 제외하지 않는다 — 유지보수 모드가 API 쓰기를 막아야
    // 단계 2b-6의 쓰기 동결이 의미를 갖는다. 대신 미들웨어 본문에서
    // MAINTENANCE_EXEMPT_PREFIXES로 인증·헬스체크를 통과시킨다.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|ico)$).*)',
  ],
}
