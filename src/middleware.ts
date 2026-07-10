import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'

import { applyCSP } from './middleware/csp'
import { getSystemSettings } from './middleware/settings'
import { handleAuth } from './middleware/auth'
import { getMaintenanceResponse } from './middleware/maintenance'
import { routing } from './i18n/routing'
import { createLogger } from '@/utils/logger'

const intlMiddleware = createIntlMiddleware(routing)
const log = createLogger('middleware')

function hasSupabaseMiddlewareConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

// @supabase/ssr가 setAll로 기반 응답(res)에 기록한 갱신 토큰 쿠키를, 미들웨어가 새로
// 반환하는 응답(리다이렉트·유지보수)에도 복사해 브라우저까지 전달한다. 누락하면 토큰
// 회전(rotation) 환경에서 갱신이 유실되어 다음 요청에 로그아웃될 수 있다.
function copyResponseCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach(cookie => to.cookies.set(cookie))
  return to
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API 라우트는 절대 미들웨어에서 처리하지 않음
  if (pathname.startsWith('/api/')) {
    log.debug('API route bypassed', pathname)
    return NextResponse.next()
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

  if (!hasSupabaseMiddlewareConfig()) {
    log.debug('Supabase env missing, skipping auth middleware')
    return res
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // 미들웨어는 모든 페이지 요청 경로다. Supabase Auth가 행이면 사이트 전체가
      // 미들웨어 타임아웃까지 블로킹되므로 요청 상한을 짧게 둔다(초과 시 auth 실패
      // 경로로 처리되어 공개 페이지는 통과, 보호 페이지는 로그인으로 유도).
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(3000) }),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // access token 갱신 시 새 쿠키를 요청·응답 양쪽에 반영해 브라우저까지 전달한다.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    }
  )

  const systemSettings = await getSystemSettings(supabase)
  const authResult = await handleAuth(request, res, supabase, systemSettings)

  if (!authResult.shouldContinue && authResult.response) {
    return copyResponseCookies(res, authResult.response)
  }

  if (systemSettings?.maintenanceMode) {
    const isAdmin = authResult.profile?.is_admin === true

    if (!isAdmin) {
      return copyResponseCookies(res, getMaintenanceResponse(systemSettings.maintenanceMessage))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|ico)$).*)',
  ],
}
