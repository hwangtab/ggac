import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRegistrationDisabledHtml } from './templates'
import { createLogger } from '@/utils/logger'
import { fetchMemberProfileForMiddleware } from './profile'

const log = createLogger('middleware/auth')
const LOCALES = ['ko', 'en'] as const
const UUID_PATH_SEGMENT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BOARD_EDIT_PATH_REGEX = /^\/board\/([^/]+)\/edit$/

// PII(user.id) 평문 로깅을 막기 위한 마스킹 헬퍼.
// 처음 6자만 남기고 나머지는 가린다.
const maskId = (id?: string | null): string => (id ? `${id.slice(0, 6)}…` : '<unknown>')

const stripLocalePrefix = (pathname: string): string => {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (LOCALES.some(locale => locale === maybeLocale)) {
    const stripped = `/${segments.slice(2).join('/')}`
    return stripped === '/' ? '/' : stripped.replace(/\/+$/, '') || '/'
  }
  return pathname
}

const getLocaleRedirectPath = (request: NextRequest, path: string): string => {
  const segments = request.nextUrl.pathname.split('/')
  const maybeLocale = segments[1]

  if (maybeLocale === 'en') {
    return path === '/' ? '/en' : `/en${path}`
  }

  return path
}

const redirectToPath = (request: NextRequest, path: string): NextResponse => {
  return NextResponse.redirect(
    new URL(getLocaleRedirectPath(request, path), request.nextUrl.origin)
  )
}

const redirectToLogin = (request: NextRequest): NextResponse => {
  const url = new URL(getLocaleRedirectPath(request, '/login'), request.nextUrl.origin)
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const authPath = stripLocalePrefix(request.nextUrl.pathname)

  if (authPath !== '/login') {
    url.searchParams.set('redirect', requestedPath)
  }

  return NextResponse.redirect(url)
}

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
  const authPathname = stripLocalePrefix(pathname)

  let user = null
  let authError = false

  // 모바일 디바이스 감지
  const userAgent = request.headers.get('user-agent')?.toLowerCase() || ''
  const isMobile =
    /android|iphone|ipod|ipad|blackberry|windows phone|mobile/.test(userAgent) ||
    request.headers.get('sec-ch-ua-mobile') === '?1'

  // 크리티컬 경로 판단 (게시판 관련 경로, 관리자, 마이페이지)
  const isCriticalPath =
    authPathname.startsWith('/board') ||
    authPathname.startsWith('/admin') ||
    authPathname.startsWith('/mypage')

  // 게시판 공개 읽기 허용 정책: 쓰기/수정만 보호
  const isBoardWrite = authPathname.startsWith('/board/write')
  const boardEditMatch = authPathname.match(BOARD_EDIT_PATH_REGEX)
  const isBoardEdit = Boolean(boardEditMatch && UUID_PATH_SEGMENT_REGEX.test(boardEditMatch[1]))
  const isBoardProtected = isBoardWrite || isBoardEdit
  const isBoardRoom = authPathname.startsWith('/board-room')
  const isProtectedPage =
    authPathname.startsWith('/admin') ||
    authPathname.startsWith('/mypage') ||
    authPathname.startsWith('/notifications') ||
    isBoardProtected ||
    isBoardRoom

  try {
    // getClaims()는 액세스 토큰을 WebCrypto로 로컬 검증한다 — getUser()와 달리 GoTrue
    // 서버로 왕복하지 않으므로 미들웨어를 타는 모든 요청에서 네트워크 왕복 1회가 사라진다.
    // (프로젝트가 비대칭 서명 키(ES256)로 전환된 것이 전제 — 2026-07-13 rotate 완료.)
    //
    // 안전성 근거:
    //  - 내부적으로 getSession()을 먼저 호출하므로 만료 임박 토큰 갱신·쿠키 재기록
    //    동작은 getUser()와 동일하게 유지된다(@supabase/ssr 미들웨어 패턴의 전제).
    //  - 로테이션 이전에 발급된 HS256 토큰이나 WebCrypto 미가용 환경에서는 라이브러리가
    //    자동으로 서버 검증(getUser)으로 폴백하므로 전환기에도 깨지지 않는다.
    //  - 로컬 검증은 신원만 확정한다. 승인/활성/admin 같은 권한은 보호 경로에서 매번
    //    member_profiles를 새로 읽어 판정하므로, member_profiles 기반 비활성화·삭제·거부는
    //    토큰 만료를 기다리지 않고 그 조회에서 즉시 걸린다.
    //  - 반면 auth 레벨 세션 취소(전역 로그아웃·비밀번호 변경·밴)는 로컬 검증이 보지
    //    못해 액세스 토큰 만료까지 반영되지 않는다. 다만 실제 데이터·변형 표면은 전부
    //    API 라우트·서버 페이지가 getUser()로 재검증하므로 그 경로는 봉쇄된다. 하류가
    //    구제하지 않는 유일한 지점(유지보수 관리자 예외)만 middleware.ts에서 getUser()로
    //    별도 재검증한다.
    const { data, error: claimsError } = await supabase.auth.getClaims()

    if (claimsError) {
      log.debug('Auth error', { isMobile, message: claimsError.message })
      authError = true
    } else {
      // 세션이 없으면 data가 null이다(에러가 아니라 익명 방문자).
      const claims = data?.claims
      user = claims?.sub ? { id: claims.sub, email: claims.email ?? null } : null
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        log.debug('Auth state', {
          pathname,
          isMobile,
          authenticated: Boolean(user),
        })
      }
    }
  } catch (error) {
    log.debug('Auth error in middleware', { isMobile, error })
    authError = true
  }

  // 인증 에러 발생 시 공개 페이지는 허용하고 보호된 페이지만 리다이렉트
  if (authError) {
    if (isProtectedPage) {
      return {
        response: redirectToLogin(request),
        shouldContinue: false,
      }
    }
    return { shouldContinue: true }
  }

  // 정의된 경로들
  const AUTH_PAGES = ['/login', '/signup']
  const REGISTRATION_PAGES = ['/register/pending', '/register/rejected']
  const isAuthPage = AUTH_PAGES.includes(authPathname)
  const isRegistrationPage = REGISTRATION_PAGES.includes(authPathname)

  // 1. 인증되지 않은 사용자 처리
  if (!user) {
    // 보호된 페이지에 접근 시 로그인 페이지로 리다이렉트
    if (isProtectedPage) {
      return {
        response: redirectToLogin(request),
        shouldContinue: false,
      }
    }
    // 인증 페이지나 공개 페이지는 그대로 진행
    return { shouldContinue: true }
  }

  // 2. 인증된 사용자 처리
  //
  // profile(member_profiles) 조회는 실제로 필요한 요청에서만 수행한다:
  //  - 보호 경로: 승인 상태·admin·이사회 권한 판정 (2.3)
  //  - 인증/등록 페이지: 상태별 리다이렉트 분기 (2.1, 2.2)
  //  - 유지보수 모드 ON: 관리자 예외 판별 (middleware.ts)
  // 그 외(로그인 사용자의 홈·아티스트·게시판 열람 등 공개 페이지)는 조회를
  // 건너뛴다 — 기존에는 모든 인증 요청에서 조회해 전 페이지 TTFB에 DB 왕복
  // 1개가 고정 가산됐다(전수감사 인증 H-1). RSC prefetch에도 동일하게 적용된다.
  const isAuthOrRegistrationPage =
    ['/login', '/signup'].includes(authPathname) ||
    ['/register/pending', '/register/rejected'].includes(authPathname)
  const needsProfile =
    isProtectedPage || isAuthOrRegistrationPage || Boolean(systemSettings?.maintenanceMode)

  if (!needsProfile) {
    return { user, shouldContinue: true }
  }

  // member_profiles 정보 가져오기 (단순화된 조회)
  let profile = null
  let profileError = null

  try {
    const data = await fetchMemberProfileForMiddleware(user.id)
    if (data) {
      profile = data
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        log.debug('Profile found', {
          isMobile,
          status: profile.registration_status,
          active: profile.is_active,
        })
      }
    }
  } catch (error) {
    log.debug('Database error in middleware', { isMobile, error })
    profileError = error

    // 모바일에서는 네트워크 오류 시 더 관대하게 처리
    if (isMobile && !isProtectedPage) {
      log.debug('Mobile public page allowed despite DB error')
      return { user, shouldContinue: true }
    }

    // 데이터베이스 에러 시 기본적으로 공개 페이지는 허용
    if (!isProtectedPage) {
      return { user, shouldContinue: true }
    }
    // 보호된 페이지는 로그인으로 리다이렉트
    return {
      response: redirectToLogin(request),
      shouldContinue: false,
    }
  }

  // 프로필이 없거나 에러 발생 시 (조합원 가입 플로우 문제일 수 있음)
  if (!profile || profileError) {
    log.warn('Profile not found or error', {
      userId: maskId(user.id),
      error: (profileError as { message?: string } | null)?.message,
    })

    // 인증 페이지나 등록 페이지는 그대로 진행
    if (isAuthPage || isRegistrationPage) {
      return { user, shouldContinue: true }
    }

    // 보호된 페이지나 기타 페이지에서는 승인 대기 페이지로 리다이렉트
    if (isProtectedPage) {
      return {
        response: redirectToPath(request, '/register/pending'),
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
    if (authPathname === '/signup' && systemSettings && !systemSettings.registrationEnabled) {
      return {
        response: new NextResponse(getRegistrationDisabledHtml(), {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
        shouldContinue: false,
      }
    }

    // 로그인 페이지는 인증된 사용자도 접근 가능하도록 허용 (로그인 페이지에서 자체 처리)
    if (authPathname === '/login') {
      return { user, profile, shouldContinue: true }
    }

    // 회원가입 페이지에 대한 기존 리다이렉트 로직
    if (authPathname === '/signup') {
      if (userStatus === 'approved' && isActive) {
        log.debug('Redirecting approved user to board from signup', { isMobile })
        return {
          response: redirectToPath(request, '/board'),
          shouldContinue: false,
        }
      } else if (userStatus === 'pending') {
        log.debug('Redirecting pending user from signup', { isMobile })
        return {
          response: redirectToPath(request, '/register/pending'),
          shouldContinue: false,
        }
      } else if (userStatus === 'rejected') {
        log.debug('Redirecting rejected user from signup', { isMobile })
        return {
          response: redirectToPath(request, '/register/rejected'),
          shouldContinue: false,
        }
      }
    }

    // 그 외의 경우는 현재 페이지 유지
    return { user, profile, shouldContinue: true }
  }

  // 2.2. 등록 관련 페이지에 접근 시 리다이렉트
  if (isRegistrationPage) {
    // 상태가 approved이고 활성화된 경우, 등록 페이지에 있으면 게시판으로
    if (userStatus === 'approved' && isActive) {
      return {
        response: redirectToPath(request, '/board'),
        shouldContinue: false,
      }
    }

    const expectedPath = userStatus === 'rejected' ? '/register/rejected' : '/register/pending'
    if (authPathname !== expectedPath) {
      // 현재 경로가 사용자의 상태와 다르면 올바른 상태 페이지로 리다이렉트
      return {
        response: redirectToPath(request, expectedPath),
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
        response: redirectToPath(request, '/register/pending'),
        shouldContinue: false,
      }
    }
    // 관리자 페이지는 is_admin도 확인
    if (authPathname.startsWith('/admin') && !isAdmin) {
      return {
        response: redirectToPath(request, '/board'), // 관리자 아니면 게시판으로
        shouldContinue: false,
      }
    }
    // 이사회 페이지는 이사·관리자·감사만 접근 (API canAccessBoardRoom과 동일 기준)
    if (isBoardRoom && !isAdmin && !profile.is_director && !profile.is_auditor) {
      return {
        response: redirectToPath(request, '/board'),
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
