'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabase/client';
import { useStablePageLoad } from '../../utils/routeProtection';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  const { isLoading: pageLoading, isReady } = useStablePageLoad('/login');

  // 모바일 디바이스 감지 함수 (waitForAuthStateAndRedirect에서 사용)
  const isMobileDeviceForAuth = () => {
    if (typeof window === 'undefined') return false;
    
    const userAgent = window.navigator.userAgent.toLowerCase();
    const mobileKeywords = ['android', 'iphone', 'ipod', 'ipad', 'blackberry', 'windows phone', 'mobile'];
    
    return mobileKeywords.some(keyword => userAgent.includes(keyword)) || 
           window.innerWidth <= 768 || 
           ('ontouchstart' in window);
  };

  // 안전한 리다이렉트 함수 (모바일 최적화 버전)
  const waitForAuthStateAndRedirect = async () => {
    try {
      console.log('🔄 [LOGIN DEBUG] Starting auth state confirmation...');
      setMessage('로그인 성공! 인증 상태를 확인하는 중...');
      
      const isMobile = isMobileDeviceForAuth();
      console.log(`📱 [LOGIN DEBUG] Mobile device detected: ${isMobile}`);
      
      // 모바일에서는 더 긴 재시도 로직 (네트워크 불안정성 고려)
      let session = null;
      let profile = null;
      let retries = 0;
      const maxRetries = isMobile ? 5 : 3;
      const retryDelay = isMobile ? 500 : 200;
      
      while (!session && retries < maxRetries) {
        console.log(`🔄 [LOGIN DEBUG] Session check attempt ${retries + 1}/${maxRetries} (Mobile: ${isMobile})`);
        
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (currentSession && !sessionError) {
          // 프로필 확인
          const { data: currentProfile, error: profileError } = await supabase
            .from('member_profiles')
            .select('registration_status, is_active, display_name')
            .eq('id', currentSession.user.id)
            .single();
          
          if (currentProfile && !profileError) {
            session = currentSession;
            profile = currentProfile;
            console.log('✅ [LOGIN DEBUG] Session and profile confirmed');
            break;
          }
        }
        
        retries++;
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
      
      if (!session || !profile) {
        console.error('❌ [LOGIN DEBUG] Session confirmation failed');
        setMessage('인증 확인에 실패했습니다. 다시 시도해주세요.');
        return;
      }
      
      // 리다이렉트 실행 (모바일 환경 최적화)
      if (profile.registration_status === 'approved' && profile.is_active) {
        console.log('🎯 [LOGIN DEBUG] Approved user, redirecting to board...');
        setMessage('인증 완료! 게시판으로 이동합니다...');
        
        // 모바일에서는 더 긴 딜레이와 router.push 사용
        const redirectDelay = isMobile ? 800 : 300;
        
        setTimeout(() => {
          console.log('🚀 [LOGIN DEBUG] Redirecting to board...');
          
          // 모바일에서는 router.push 우선 시도, 실패 시 window.location.href 사용
          if (isMobile) {
            try {
              router.push('/board');
              console.log('📱 [LOGIN DEBUG] Mobile redirect via router.push');
            } catch (routerError) {
              console.warn('⚠️ [LOGIN DEBUG] Router.push failed, falling back to window.location');
              window.location.href = '/board';
            }
          } else {
            window.location.href = '/board';
          }
        }, redirectDelay);
        
      } else if (profile && profile.registration_status === 'pending') {
        console.log('⏳ [LOGIN DEBUG] Pending user, redirecting to pending page...');
        setMessage('승인 대기 중입니다. 대기 페이지로 이동합니다...');
        router.push('/register/pending');
      } else if (profile && profile.registration_status === 'rejected') {
        console.log('❌ [LOGIN DEBUG] Rejected user, redirecting to rejected page...');
        setMessage('승인이 거부되었습니다. 관련 페이지로 이동합니다...');
        router.push('/register/rejected');
      } else {
        console.log('❓ [LOGIN DEBUG] Unknown user status, redirecting to home');
        setMessage('홈페이지로 이동합니다...');
        router.push('/');
      }
      
    } catch (error) {
      console.error('💥 [LOGIN DEBUG] Error during auth state confirmation:', error);
      setMessage('인증 확인 중 오류가 발생했습니다. 새로고침하여 다시 시도해주세요.');
      // 에러 발생 시 3초 후 홈으로 이동
      setTimeout(() => {
        router.push('/');
      }, 3000);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          setMessage('요청이 너무 많습니다. 잠시 후 다시 시도해주세요. (약 5-10분 후)');
        } else if (error.message.includes('Invalid login credentials')) {
          setMessage('이메일 또는 비밀번호가 올바르지 않습니다.');
        } else {
          setMessage('로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
        }
        console.error('Login error:', error);
        return;
      }

      if (data.user) {
        // 이메일 인증 확인
        if (!data.user.email_confirmed_at) {
          setMessage('이메일 인증이 필요합니다. 이메일을 확인해주세요.');
          await supabase.auth.signOut();
          return;
        }

        // 로그인 활동 로깅
        try {
          await fetch('/api/activities/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionType: 'login',
              details: {
                user_agent: navigator.userAgent,
                timestamp: new Date().toISOString()
              }
            })
          });
        } catch (logError) {
          console.error('Failed to log login activity:', logError);
          // 로깅 실패는 로그인 과정을 방해하지 않음
        }

        // 인증 상태 확인 후 안전한 리다이렉트
        setMessage('로그인 성공! 인증 상태를 확인하는 중...');
        
        // 인증 상태가 완전히 설정될 때까지 기다린 후 리다이렉트
        await waitForAuthStateAndRedirect();
      }
    } catch (error) {
      console.error('Unexpected error during login:', error);
      setMessage('예상치 못한 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  // 모바일 환경 감지
  const isMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    
    const userAgent = window.navigator.userAgent.toLowerCase();
    const mobileKeywords = ['android', 'iphone', 'ipod', 'ipad', 'blackberry', 'windows phone', 'mobile'];
    
    return mobileKeywords.some(keyword => userAgent.includes(keyword)) || 
           window.innerWidth <= 768 || 
           ('ontouchstart' in window);
  };

  // 모바일에서는 로딩 화면을 건너뛰고 바로 렌더링 (하얀 화면 문제 방지)
  const isMobile = typeof window !== 'undefined' && isMobileDevice();
  
  // 페이지 안정화 중이면 로딩 표시 (모바일 제외)
  if (!isMobile && (pageLoading || !isReady)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">페이지를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        {/* 헤더 섹션 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-primary-100 mb-6">
            <svg className="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
          </div>
          <h1 className="heading-secondary text-gray-900 mb-4">
            로그인
          </h1>
          <p className="text-body text-gray-600">
            경기아트콜렉티브 협동조합에<br />
            오신 것을 환영합니다.
          </p>
        </div>
        
        {/* 메시지 표시 */}
        {message && (
          <div className={`mb-8 p-4 sm:p-6 rounded-xl shadow-sm ${
            message.includes('rate limit') || message.includes('너무 많습니다')
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : message.includes('승인') && message.includes('완료')
              ? 'bg-green-50 text-green-800 border border-green-200'
              : message.includes('이동합니다') || message.includes('확인하는 중')
              ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {message.includes('rate limit') || message.includes('너무 많습니다') ? (
                  <svg className="h-5 w-5 text-amber-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                ) : message.includes('승인') && message.includes('완료') ? (
                  <svg className="h-5 w-5 text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : message.includes('이동합니다') || message.includes('확인하는 중') ? (
                  <svg className="h-5 w-5 text-blue-400 mt-0.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <div className="text-sm leading-relaxed">
                  {message}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* 폼 섹션 */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
          <form onSubmit={handleLogin} className="p-8 space-y-6">
            <div className="space-y-6">
              <div>
                <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-2">
                  이메일 주소
                </label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="이메일 주소를 입력하세요"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  비밀번호
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="비밀번호를 입력하세요"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    로그인 중...
                  </span>
                ) : (
                  '로그인'
                )}
              </button>
            </div>
          </form>
        </div>
        
        {/* 하단 링크 */}
        <div className="text-center mt-8">
          <p className="text-gray-600">
            계정이 없으신가요?{' '}
            <Link href="/signup" className="font-medium text-primary-600 hover:text-primary-500 transition-colors">
              조합원 가입하기
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
