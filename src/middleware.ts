import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 시스템 설정 캐시 (5분 캐시)
let settingsCache: { 
  maintenanceMode: boolean; 
  maintenanceMessage?: string; 
  registrationEnabled: boolean;
  timestamp: number 
} | null = null;

const SETTINGS_CACHE_DURATION = 5 * 60 * 1000; // 5분

async function getSystemSettings(supabase: any) {
  // 캐시 확인
  if (settingsCache && (Date.now() - settingsCache.timestamp) < SETTINGS_CACHE_DURATION) {
    return settingsCache;
  }

  try {
    const { data, error } = await supabase
      .rpc('get_system_settings', { include_sensitive: false });

    if (error) {
      console.error('Failed to fetch system settings:', error);
      return null;
    }

    let maintenanceMode = false;
    let maintenanceMessage = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.';
    let registrationEnabled = true;

    // 설정 파싱
    for (const setting of data || []) {
      if (setting.category === 'site' && setting.setting_key === 'maintenance_mode') {
        maintenanceMode = setting.setting_value?.enabled || false;
        maintenanceMessage = setting.setting_value?.message || maintenanceMessage;
      } else if (setting.category === 'site' && setting.setting_key === 'registration_enabled') {
        registrationEnabled = setting.setting_value?.enabled !== false;
      }
    }

    // 캐시 업데이트
    settingsCache = {
      maintenanceMode,
      maintenanceMessage,
      registrationEnabled,
      timestamp: Date.now()
    };

    return settingsCache;
  } catch (error) {
    console.error('System settings fetch error in middleware:', error);
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res });

  // Skip middleware for static files and API routes to reduce API calls
  if (request.nextUrl.pathname.startsWith('/_next') || 
      request.nextUrl.pathname.startsWith('/api/') ||
      request.nextUrl.pathname.includes('.')) {
    return res;
  }

  // 시스템 설정 확인
  const systemSettings = await getSystemSettings(supabase);
  
  // 유지보수 모드 확인
  if (systemSettings?.maintenanceMode) {
    // 관리자는 유지보수 모드에서도 접근 가능
    let isAdmin = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .single();
        isAdmin = profile?.is_admin || false;
      }
    } catch (error) {
      console.error('Admin check error:', error);
    }

    if (!isAdmin) {
      // 유지보수 페이지 HTML 반환
      const maintenanceHtml = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>시스템 점검 중 - 경기아트콜렉티브</title>
          <style>
            body {
              font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
              margin: 0;
              padding: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: #333;
            }
            .container {
              text-align: center;
              background: white;
              padding: 3rem;
              border-radius: 20px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              max-width: 500px;
              margin: 1rem;
            }
            h1 {
              font-size: 2rem;
              margin-bottom: 1rem;
              color: #667eea;
            }
            p {
              font-size: 1.1rem;
              line-height: 1.6;
              color: #666;
              margin-bottom: 2rem;
            }
            .icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }
            .retry-btn {
              background: #667eea;
              color: white;
              border: none;
              padding: 1rem 2rem;
              border-radius: 10px;
              font-size: 1rem;
              cursor: pointer;
              transition: background 0.3s;
            }
            .retry-btn:hover {
              background: #5a67d8;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">🛠️</div>
            <h1>시스템 점검 중</h1>
            <p>${systemSettings.maintenanceMessage}</p>
            <button class="retry-btn" onclick="window.location.reload()">새로고침</button>
          </div>
        </body>
        </html>
      `;
      
      return new Response(maintenanceHtml, {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Retry-After': '3600' // 1시간 후 재시도 권장
        }
      });
    }
  }

  let user = null;
  let authError = false;
  
  // 모바일 디바이스 감지
  const userAgent = request.headers.get('user-agent')?.toLowerCase() || '';
  const isMobile = /android|iphone|ipod|ipad|blackberry|windows phone|mobile/.test(userAgent) ||
                   request.headers.get('sec-ch-ua-mobile') === '?1';
  
  // 크리티컬 경로 판단 (게시판 관련 경로)
  const isCriticalPath = request.nextUrl.pathname.startsWith('/board') || 
                        request.nextUrl.pathname.startsWith('/admin');
  
  try {
    // 모바일 환경에서는 더 관대한 세션 확인
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.log(`❌ [MIDDLEWARE DEBUG] Session error (Mobile: ${isMobile}):`, sessionError.message);
      authError = true;
    } else {
      user = session?.user || null;
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        console.log(`📋 [MIDDLEWARE DEBUG] Session state for ${request.nextUrl.pathname} (Mobile: ${isMobile}):`, user ? 'Authenticated' : 'Not authenticated');
      }
    }
  } catch (error) {
    console.log(`💥 [MIDDLEWARE DEBUG] Auth error in middleware (Mobile: ${isMobile}):`, error);
    authError = true;
  }

  // 인증 에러 발생 시 공개 페이지는 허용하고 보호된 페이지만 리다이렉트
  if (authError) {
    const { pathname } = request.nextUrl;
    const PROTECTED_PAGES = ['/board', '/admin'];
    const isProtectedPage = PROTECTED_PAGES.some(path => pathname.startsWith(path));
    
    if (isProtectedPage) {
      return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
    }
    // 공개 페이지는 그대로 진행
    return res;
  }

  const { pathname } = request.nextUrl;

  // 정의된 경로들
  const AUTH_PAGES = ['/login', '/signup'];
  const REGISTRATION_PAGES = ['/register/pending', '/register/rejected'];
  const PROTECTED_PAGES = ['/board', '/admin'];

  const isAuthPage = AUTH_PAGES.includes(pathname);
  const isRegistrationPage = REGISTRATION_PAGES.includes(pathname);
  const isProtectedPage = PROTECTED_PAGES.some(path => pathname.startsWith(path));

  // 1. 인증되지 않은 사용자 처리
  if (!user) {
    // 보호된 페이지에 접근 시 로그인 페이지로 리다이렉트
    if (isProtectedPage) {
      return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
    }
    // 인증 페이지는 그대로 진행
    return res;
  }

  // 2. 인증된 사용자 처리
  // member_profiles 정보 가져오기 (단순화된 조회)
  let profile = null;
  let profileError = null;
  
  try {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, is_admin, display_name')
      .eq('id', user.id)
      .single();
    
    if (data && !error) {
      profile = data;
      if (process.env.NODE_ENV === 'development' && isCriticalPath) {
        console.log(`✅ [MIDDLEWARE DEBUG] Profile found (Mobile: ${isMobile}):`, { 
          status: profile.registration_status, 
          active: profile.is_active 
        });
      }
    } else {
      profileError = error;
      if (process.env.NODE_ENV === 'development') {
        console.log(`❌ [MIDDLEWARE DEBUG] Profile error (Mobile: ${isMobile}):`, error?.message);
      }
    }
    
  } catch (error) {
    console.log(`💥 [MIDDLEWARE DEBUG] Database error in middleware (Mobile: ${isMobile}):`, error);
    profileError = error;
    
    // 모바일에서는 네트워크 오류 시 더 관대하게 처리
    if (isMobile && !isProtectedPage) {
      console.log('📱 [MIDDLEWARE DEBUG] Mobile device - allowing public page access despite DB error');
      return res;
    }
    
    // 데이터베이스 에러 시 기본적으로 공개 페이지는 허용
    if (!isProtectedPage) {
      return res;
    }
    // 보호된 페이지는 로그인으로 리다이렉트
    return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  }

  // 프로필이 없거나 에러 발생 시 (조합원 가입 플로우 문제일 수 있음)
  if (!profile || profileError) {
    console.log('Profile not found or error for user:', user.id, profileError?.message);
    
    // 인증 페이지나 등록 페이지는 그대로 진행
    if (isAuthPage || isRegistrationPage) {
      return res;
    }
    
    // 보호된 페이지나 기타 페이지에서는 승인 대기 페이지로 리다이렉트
    // (프로필이 없으면 트리거 실패이므로 대기 상태로 간주)
    if (isProtectedPage) {
      return NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin));
    }
    
    // 그 외의 페이지는 그대로 진행 (공개 페이지들)
    return res;
  }

  // 사용자의 현재 상태
  const userStatus = profile.registration_status;
  const isActive = profile.is_active;
  const isAdmin = profile.is_admin;

  // 2.1. 인증 페이지에 접근 시 리다이렉트
  if (isAuthPage) {
    // 회원 가입 페이지에서 등록이 비활성화되어 있으면 차단
    if (pathname === '/signup' && systemSettings && !systemSettings.registrationEnabled) {
      const registrationDisabledHtml = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>회원 가입 일시 중단 - 경기아트콜렉티브</title>
          <style>
            body {
              font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
              margin: 0; padding: 0; display: flex; justify-content: center; align-items: center;
              min-height: 100vh; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #333;
            }
            .container { text-align: center; background: white; padding: 3rem; border-radius: 20px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1); max-width: 500px; margin: 1rem; }
            h1 { font-size: 2rem; margin-bottom: 1rem; color: #f5576c; }
            p { font-size: 1.1rem; line-height: 1.6; color: #666; margin-bottom: 2rem; }
            .icon { font-size: 4rem; margin-bottom: 1rem; }
            .home-btn { background: #f5576c; color: white; border: none; padding: 1rem 2rem;
              border-radius: 10px; font-size: 1rem; cursor: pointer; transition: background 0.3s;
              text-decoration: none; display: inline-block; }
            .home-btn:hover { background: #e14856; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">🚫</div>
            <h1>회원 가입 일시 중단</h1>
            <p>현재 회원 가입이 일시 중단되었습니다.<br>양해 부탁드립니다.</p>
            <a href="/" class="home-btn">홈으로 돌아가기</a>
          </div>
        </body>
        </html>
      `;
      
      return new Response(registrationDisabledHtml, {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (userStatus === 'approved' && isActive) {
      console.log(`🎯 [MIDDLEWARE DEBUG] Redirecting approved user to board (Mobile: ${isMobile})`);
      return NextResponse.redirect(new URL('/board', request.nextUrl.origin)); // 승인된 사용자는 게시판으로
    } else if (userStatus === 'pending') {
      console.log(`⏳ [MIDDLEWARE DEBUG] Redirecting pending user (Mobile: ${isMobile})`);
      return NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin));
    } else if (userStatus === 'rejected') {
      console.log(`❌ [MIDDLEWARE DEBUG] Redirecting rejected user (Mobile: ${isMobile})`);
      return NextResponse.redirect(new URL('/register/rejected', request.nextUrl.origin));
    }
    // 그 외의 경우 (예: 아직 이메일 인증만 완료된 상태)는 현재 페이지 유지 (signup/login)
    return res;
  }

  // 2.2. 등록 관련 페이지에 접근 시 리다이렉트
  if (isRegistrationPage) {
    const expectedPath = `/register/${userStatus}`;
    if (pathname !== expectedPath) {
      // 현재 경로가 사용자의 상태와 다르면 올바른 상태 페이지로 리다이렉트
      return NextResponse.redirect(new URL(expectedPath, request.nextUrl.origin));
    }
    // 상태가 approved이고 활성화된 경우, 등록 페이지에 있으면 게시판으로
    if (userStatus === 'approved' && isActive) {
      return NextResponse.redirect(new URL('/board', request.nextUrl.origin));
    }
    // 현재 경로가 상태와 일치하면 그대로 진행
    return res;
  }

  // 2.3. 보호된 페이지에 접근 시 권한 확인
  if (isProtectedPage) {
    if (userStatus !== 'approved' || !isActive) {
      // 승인되지 않거나 비활성화된 사용자는 게시판/관리자 페이지 접근 불가
      return NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin));
    }
    // 관리자 페이지는 is_admin도 확인
    if (pathname.startsWith('/admin') && !isAdmin) {
      return NextResponse.redirect(new URL('/board', request.nextUrl.origin)); // 관리자 아니면 게시판으로
    }
    // 모든 조건 통과, 페이지 진행
    return res;
  }

  // 그 외의 모든 페이지 요청은 그대로 진행
  return res;
}

export const config = {
  /*
   * 모든 요청 경로에 대해 미들웨어를 실행하되, 아래 명시된 경로는 제외합니다:
   * - api (API 라우트)
   * - _next/static (정적 파일)
   * - _next/image (이미지 최적화 파일)
   * - favicon.ico (파비콘 파일)
   * - 정규식에 포함된 모든 확장자 (svg, png, jpg, jpeg, gif, webp)
   */
  matcher: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
};