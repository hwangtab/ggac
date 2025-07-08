import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res });

  // Skip middleware for static files and API routes to reduce API calls
  if (request.nextUrl.pathname.startsWith('/_next') || 
      request.nextUrl.pathname.startsWith('/api/') ||
      request.nextUrl.pathname.includes('.')) {
    return res;
  }

  let user = null;
  let authError = false;
  try {
    // 세션 기반 인증 상태 확인 (더 안정적)
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.log('Session error in middleware:', sessionError);
      authError = true;
    } else {
      user = session?.user || null;
    }
  } catch (error) {
    console.log('Auth error in middleware:', error);
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
  // member_profiles 정보 가져오기 (에러 처리 개선)
  let profile = null;
  let profileError = null;
  
  try {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, is_admin')
      .eq('id', user.id)
      .single();
    
    profile = data;
    profileError = error;
  } catch (error) {
    console.log('Database error in middleware:', error);
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
    if (userStatus === 'approved' && isActive) {
      return NextResponse.redirect(new URL('/board', request.nextUrl.origin)); // 승인된 사용자는 게시판으로
    } else if (userStatus === 'pending') {
      return NextResponse.redirect(new URL('/register/pending', request.nextUrl.origin));
    } else if (userStatus === 'rejected') {
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
  matcher: [
    // 미들웨어를 적용할 경로를 명시적으로 나열하고 static 파일들 제외
    '/login',
    '/signup',
    '/board/:path*', // /board와 그 하위 경로 모두 포함
    '/admin/:path*', // /admin과 그 하위 경로 모두 포함
    '/register/pending',
    '/register/rejected',
  ],
};