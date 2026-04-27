import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRegistrationDisabledHtml } from './templates'

export interface AuthResult {
  response?: NextResponse
  user?: any
  profile?: any
  shouldContinue: boolean
}

export async function handleAuth(
  request: NextRequest,
  response: NextResponse,
  supabase: any,
  systemSettings: any
): Promise<AuthResult> {
  const { pathname } = request.nextUrl

  let user = null
  let authError = false

  // 모바일 디바이스 감지
  const userAgent = request.headers.get('user-agent')?.toLowerCase() || ''
  const isMobile =
    /android|iphone|ipod|ipad|blackberry|windows phone|mobile/.test(userAgent) ||
    request.headers.get('sec-ch-ua-mobile') === '?1'

  // 크리티컬 경로 판단 (게시판 관련 경로, 관리자, 마이페이지)
  const isCriticalPath =
    pathname.startsWith('/board') || pathname.startsWith('/admin') || pathname.startsWith('/mypage')

  // 게시판 공개 읽기 허용 정책: 쓰기/수정만 보호
  const isBoardWrite = pathname.startsWith('/board/write')
  const isBoardEdit = /\/board\/.+\/edit$/.test(pathname)
  const isBoardProtected = isBoardWrite || isBoardEdit
  const isProtectedPage =
    pathname.startsWith('/admin') || pathname.startsWith('/mypage') || isBoardProtected

  try {
    // getUser()는 서버에서 JWT를 검증하므로 getSession()보다 안전
    const {
      data: { user: authUser },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`❌ [MIDDLEWARE DEBUG] Auth error (Mobile: ${isMobile}):`, userError.message)
      }
      authError = true
    } else {
      user = authUser || null
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        console.log(
          `📋 [MIDDLEWARE DEBUG] Auth state for ${pathname} (Mobile: ${isMobile}):`,
          user ? 'Authenticated' : 'Not authenticated'
        )
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`💥 [MIDDLEWARE DEBUG] Auth error in middleware (Mobile: ${isMobile}):`, error)
    }
    authError = true
  }

  // 인증 에러 발생 시 공개 페이지는 허용하고 보호된 페이지만 리다이렉트
  if (authError) {
    if (isProtectedPage) {
      return {
        response: NextResponse.redirect(new URL('/login', request.nextUrl.origin)),
        shouldContinue: false,
      }
    }
    return { shouldContinue: true }
  }

  // 정의된 경로들
  const AUTH_PAGES = ['/login', '/signup']
  const REGISTRATION_PAGES = ['/register/pending', '/register/rejected']
  const isAuthPage = AUTH_PAGES.includes(pathname)
  const isRegistrationPage = REGISTRATION_PAGES.includes(pathname)

  // 1. 인증되지 않은 사용자 처리
  if (!user) {
    // 보호된 페이지에 접근 시 로그인 페이지로 리다이렉트
    if (isProtectedPage) {
      return {
        response: NextResponse.redirect(new URL('/login', request.nextUrl.origin)),
        shouldContinue: false,
      }
    }
    // 인증 페이지나 공개 페이지는 그대로 진행
    return { shouldContinue: true }
  }

  // 2. 인증된 사용자 처리
  // member_profiles 정보 가져오기 (단순화된 조회)
  let profile = null
  let profileError = null

  try {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, is_admin, display_name')
      .eq('id', user.id)
      .single()

    if (data && !error) {
      profile = data
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        console.log(`✅ [MIDDLEWARE DEBUG] Profile found (Mobile: ${isMobile}):`, {
          status: profile.registration_status,
          active: profile.is_active,
        })
      }
    } else {
      profileError = error
      if (process.env.NODE_ENV === 'development') {
        console.log(`❌ [MIDDLEWARE DEBUG] Profile error (Mobile: ${isMobile}):`, error?.message)
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `💥 [MIDDLEWARE DEBUG] Database error in middleware (Mobile: ${isMobile}):`,
        error
      )
    }
    profileError = error

    // 모바일에서는 네트워크 오류 시 더 관대하게 처리
    if (isMobile && !isProtectedPage) {
      if (process.env.NODE_ENV === 'development') {
        console.log(
          '📱 [MIDDLEWARE DEBUG] Mobile device - allowing public page access despite DB error'
        )
      }
      return { user, shouldContinue: true }
    }

    // 데이터베이스 에러 시 기본적으로 공개 페이지는 허용
    if (!isProtectedPage) {
      return { user, shouldContinue: true }
    }
    // 보호된 페이지는 로그인으로 리다이렉트
    return {
      response: NextResponse.redirect(new URL('/login', request.nextUrl.origin)),
      shouldContinue: false,
    }
  }

  // 프로필이 없거나 에러 발생 시 (조합원 가입 플로우 문제일 수 있음)
  if (!profile || profileError) {
    console.log('Profile not found or error for user:', user.id, profileError?.message)

    // 인증 페이지나 등록 페이지는 그대로 진행
    if (isAuthPage || isRegistrationPage) {
      return { user, shouldContinue: true }
    }

    // 보호된 페이지나 기타 페이지에서는 승인 대기 페이지로 리다이렉트
    if (isProtectedPage) {
      return {
        response: NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin)),
        shouldContinue: false,
      }
    }

    // 그 외의 페이지는 그대로 진행
    return { user, shouldContinue: true }
  }

  // 사용자의 현재 상태
  const userStatus = profile.registration_status
  const isActive = profile.is_active
  const isAdmin = profile.is_admin

  // 2.1. 인증 페이지에 접근 시 리다이렉트
  if (isAuthPage) {
    // 회원 가입 페이지에서 등록이 비활성화되어 있으면 차단
    if (pathname === '/signup' && systemSettings && !systemSettings.registrationEnabled) {
      return {
        response: new NextResponse(getRegistrationDisabledHtml(), {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
        shouldContinue: false,
      }
    }

    // 로그인 페이지는 인증된 사용자도 접근 가능하도록 허용 (로그인 페이지에서 자체 처리)
    if (pathname === '/login') {
      return { user, profile, shouldContinue: true }
    }

    // 회원가입 페이지에 대한 기존 리다이렉트 로직
    if (pathname === '/signup') {
      if (userStatus === 'approved' && isActive) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `🎯 [MIDDLEWARE DEBUG] Redirecting approved user to board from signup (Mobile: ${isMobile})`
          )
        }
        return {
          response: NextResponse.redirect(new URL('/board', request.nextUrl.origin)),
          shouldContinue: false,
        }
      } else if (userStatus === 'pending') {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `⏳ [MIDDLEWARE DEBUG] Redirecting pending user from signup (Mobile: ${isMobile})`
          )
        }
        return {
          response: NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin)),
          shouldContinue: false,
        }
      } else if (userStatus === 'rejected') {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `❌ [MIDDLEWARE DEBUG] Redirecting rejected user from signup (Mobile: ${isMobile})`
          )
        }
        return {
          response: NextResponse.redirect(new URL('/register/rejected', request.nextUrl.origin)),
          shouldContinue: false,
        }
      }
    }

    // 그 외의 경우는 현재 페이지 유지
    return { user, profile, shouldContinue: true }
  }

  // 2.2. 등록 관련 페이지에 접근 시 리다이렉트
  if (isRegistrationPage) {
    const expectedPath = `/register/${userStatus}`
    if (pathname !== expectedPath) {
      // 현재 경로가 사용자의 상태와 다르면 올바른 상태 페이지로 리다이렉트
      return {
        response: NextResponse.redirect(new URL(expectedPath, request.nextUrl.origin)),
        shouldContinue: false,
      }
    }
    // 상태가 approved이고 활성화된 경우, 등록 페이지에 있으면 게시판으로
    if (userStatus === 'approved' && isActive) {
      return {
        response: NextResponse.redirect(new URL('/board', request.nextUrl.origin)),
        shouldContinue: false,
      }
    }
    // 현재 경로가 상태와 일치하면 그대로 진행
    return { user, profile, shouldContinue: true }
  }

  // 2.3. 보호된 페이지에 접근 시 권한 확인
  if (isProtectedPage) {
    if (userStatus !== 'approved' || !isActive) {
      // 승인되지 않거나 비활성화된 사용자는 게시판/관리자 페이지 접근 불가
      return {
        response: NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin)),
        shouldContinue: false,
      }
    }
    // 관리자 페이지는 is_admin도 확인
    if (pathname.startsWith('/admin') && !isAdmin) {
      return {
        response: NextResponse.redirect(new URL('/board', request.nextUrl.origin)), // 관리자 아니면 게시판으로
        shouldContinue: false,
      }
    }
  }

  // 2.4. 유지보수 모드 확인 (관리자는 제외)
  if (systemSettings?.maintenanceMode && !isAdmin) {
    // 유지보수 모드는 상위(middleware.ts)에서 처리하지만, 관리자 여부를 알기 위해 profile이 필요함
    // 하지만 여기까지 왔다면 상위에서 이미 유지보수 체크를 했을 것임.
    // 문제는 profile 조회 전에 maintenance check가 있다는 점.
    // 따라서 상위 middleware.ts에서 maintenance check를 할 때 관리자 여부를 확인해야 함.
    // 이 부분은 auth.ts가 아니라 maintenance.ts로 분리하거나 middleware.ts에서 처리해야 함.
    // 여기서는 pass.
  }

  return { user, profile, shouldContinue: true }
}
