import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'

import { applyCSP } from './middleware/csp'
import { getSystemSettings } from './middleware/settings'
import { handleAuth } from './middleware/auth'
import { getMaintenanceResponse } from './middleware/maintenance'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

function hasSupabaseMiddlewareConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API 라우트는 절대 미들웨어에서 처리하지 않음
  if (pathname.startsWith('/api/')) {
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ [MIDDLEWARE] API route bypassed:', pathname)
    }
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
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ [MIDDLEWARE] Supabase env missing, skipping auth middleware')
    }
    return res
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    }
  )

  const systemSettings = await getSystemSettings(supabase)
  const authResult = await handleAuth(request, res, supabase, systemSettings)

  if (!authResult.shouldContinue && authResult.response) {
    return authResult.response
  }

  if (systemSettings?.maintenanceMode) {
    const isAdmin = authResult.profile?.is_admin === true

    if (!isAdmin) {
      return getMaintenanceResponse(systemSettings.maintenanceMessage)
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|ico)$).*)',
  ],
}
