import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { applyCSP } from './middleware/csp'
import { getSystemSettings } from './middleware/settings'
import { handleAuth } from './middleware/auth'
import { getMaintenanceResponse } from './middleware/maintenance'

function hasSupabaseMiddlewareConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export async function middleware(request: NextRequest) {
  // 1. 기본 응답 객체 생성 (request를 전달해야 쿠키 업데이트가 제대로 동작함)
  const res = NextResponse.next({ request })

  // 2. CSP 보안 헤더 적용
  applyCSP(request, res)

  // 3. API 및 정적 파일 경로 우회
  const { pathname } = request.nextUrl

  // API 라우트는 절대 미들웨어에서 처리하지 않음 (동적 API 라우트 문제 해결)
  if (pathname.startsWith('/api/')) {
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ [MIDDLEWARE] API route bypassed:', pathname)
    }
    return NextResponse.next()
  }

  // 정적 파일 및 Next.js 내부 경로 패스
  if (pathname.startsWith('/_next') || pathname.includes('.')) {
    return res
  }

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

  // Fast-path: 게시판 페이지는 시스템 설정 조회 지연을 줄이기 위해 바로 통과할 수도 있으나
  // 유지보수 모드 체크를 위해 필요함. 단, 성능을 위해 특정 경로는 제외 가능.
  // 여기서는 로직 단순화를 위해 모든 페이지에서 설정 조회 (캐시됨)

  // 4. 시스템 설정 조회
  const systemSettings = await getSystemSettings(supabase)

  // 5. 인증 및 권한 처리
  const authResult = await handleAuth(request, res, supabase, systemSettings)

  if (!authResult.shouldContinue && authResult.response) {
    return authResult.response
  }

  // 6. 유지보수 모드 최종 확인
  // authResult.shouldContinue가 true여도 유지보수 모드이고 관리자가 아니면 차단
  if (systemSettings?.maintenanceMode) {
    const isAdmin = authResult.profile?.is_admin === true

    if (!isAdmin) {
      return getMaintenanceResponse(systemSettings.maintenanceMessage)
    }
  }

  // 7. 최종 응답 반환 (쿠키 등이 설정된 res 객체)
  return res
}

export const config = {
  /*
   * 미들웨어를 실행할 경로를 명시적으로 지정
   * API 라우트는 완전히 제외하여 동적 라우팅 문제 해결
   */
  matcher: [
    /*
     * 다음 경로들에 대해서만 미들웨어 실행:
     * - 모든 페이지 라우트 (단, API 라우트 제외)
     * - 정적 파일, 이미지, 폰트 등은 제외
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|ico)$).*)',
  ],
}
