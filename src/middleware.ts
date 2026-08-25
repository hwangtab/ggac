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
 */
const MAINTENANCE_EXEMPT_EXACT = ['/api/health']
const MAINTENANCE_EXEMPT_PREFIXES = ['/api/auth/']

function isMaintenanceExempt(pathname: string): boolean {
  return (
    MAINTENANCE_EXEMPT_EXACT.includes(pathname) ||
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

  // 정적 파일 및 Next.js 내부 경로 패스
  if (pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Trailing slash 정규화: `/about/` → `/about` 301 리디렉션.
  // next-intl locale 처리 이전에 수행하여 이중 리디렉션 방지.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const url = request.nextUrl.clone()
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

  if (systemSettings?.maintenanceMode) {
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
