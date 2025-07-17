'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

// 모바일 디바이스 감지 유틸리티
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'iphone', 'ipod', 'ipad', 'blackberry', 'windows phone', 'mobile'];
  
  return mobileKeywords.some(keyword => userAgent.includes(keyword)) || 
         window.innerWidth <= 768 || 
         ('ontouchstart' in window);
};

// 네트워크 상태 감지 유틸리티
const isOnline = () => {
  if (typeof window === 'undefined') return true;
  return window.navigator.onLine;
};

// 페이지 로딩 상태를 안정화하는 유틸리티 (모바일 최적화)
export const useStablePageLoad = (targetPath?: string) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    let stabilityTimer: NodeJS.Timeout;
    let retryTimer: NodeJS.Timeout;

    const stabilizePage = async (retryCount = 0) => {
      try {
        const isMobile = isMobileDevice();
        const online = isOnline();
        
        console.log(`📱 [ROUTE PROTECTION] Stabilizing page (Mobile: ${isMobile}, Online: ${online}, Retry: ${retryCount})`);
        
        if (!online && retryCount < 3) {
          console.log('🌐 [ROUTE PROTECTION] Offline detected, retrying...');
          setNetworkError(true);
          retryTimer = setTimeout(() => {
            if (mounted) stabilizePage(retryCount + 1);
          }, 2000);
          return;
        }
        
        setNetworkError(false);
        
        // 모바일에서는 더 긴 대기 시간
        const initialDelay = isMobile ? 200 : 100;
        await new Promise(resolve => setTimeout(resolve, initialDelay));
        
        // 세션 상태 확인 (모바일에서는 재시도 로직 추가)
        let session = null;
        let sessionError = null;
        let attempts = 0;
        const maxAttempts = isMobile ? 3 : 1;
        
        while (attempts < maxAttempts && !session) {
          try {
            const { data: { session: currentSession }, error } = await supabase.auth.getSession();
            session = currentSession;
            sessionError = error;
            
            if (session || !error) break;
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (err) {
            sessionError = err;
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
        
        if (!mounted) return;

        // 모바일에서는 더 긴 안정성 대기 시간
        const stabilityDelay = isMobile ? 150 : 50;
        
        stabilityTimer = setTimeout(() => {
          if (mounted) {
            setIsLoading(false);
            setIsReady(true);
            console.log(`✅ [ROUTE PROTECTION] Page stabilized (Mobile: ${isMobile})`);
          }
        }, stabilityDelay);

      } catch (error) {
        console.error('💥 [ROUTE PROTECTION] Error stabilizing page:', error);
        
        // 모바일에서는 에러 시 재시도
        if (isMobileDevice() && retryCount < 2) {
          console.log('🔄 [ROUTE PROTECTION] Retrying page stabilization...');
          retryTimer = setTimeout(() => {
            if (mounted) stabilizePage(retryCount + 1);
          }, 1000);
        } else {
          if (mounted) {
            setIsLoading(false);
            setIsReady(true);
          }
        }
      }
    };

    stabilizePage();
    
    // 온라인 상태 변경 감지
    const handleOnline = () => {
      console.log('🌐 [ROUTE PROTECTION] Connection restored');
      if (networkError && mounted) {
        stabilizePage();
      }
    };
    
    const handleOffline = () => {
      console.log('🌐 [ROUTE PROTECTION] Connection lost');
      setNetworkError(true);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted = false;
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [targetPath]);

  return { isLoading, isReady, networkError };
};

// 네비게이션 안전 래퍼 (모바일 최적화)
export const useSafeNavigation = () => {
  const router = useRouter();

  const navigateSafely = (path: string, delay?: number) => {
    const isMobile = isMobileDevice();
    const online = isOnline();
    
    // 모바일에서는 더 긴 지연 시간
    const defaultDelay = isMobile ? 300 : 100;
    const actualDelay = delay ?? defaultDelay;
    
    console.log(`🚀 [SAFE NAVIGATION] Navigating to ${path} (Mobile: ${isMobile}, Delay: ${actualDelay}ms)`);
    
    if (!online) {
      console.warn('🌐 [SAFE NAVIGATION] Offline - navigation may fail');
    }
    
    // 미들웨어 처리 시간을 고려한 안전한 네비게이션
    setTimeout(() => {
      try {
        router.push(path);
      } catch (error) {
        console.error('❌ [SAFE NAVIGATION] Router.push failed:', error);
        
        // 모바일에서는 fallback으로 window.location 사용
        if (isMobile) {
          console.log('🔄 [SAFE NAVIGATION] Falling back to window.location');
          window.location.href = path;
        }
      }
    }, actualDelay);
  };
  
  const navigateWithRetry = (path: string, maxRetries = 3) => {
    const isMobile = isMobileDevice();
    let attempts = 0;
    
    const attemptNavigation = () => {
      attempts++;
      console.log(`🔄 [SAFE NAVIGATION] Navigation attempt ${attempts}/${maxRetries} to ${path}`);
      
      try {
        router.push(path);
        
        // 성공 확인을 위한 URL 체크
        setTimeout(() => {
          if (window.location.pathname !== path && attempts < maxRetries) {
            console.log('⚠️ [SAFE NAVIGATION] Navigation seems to have failed, retrying...');
            attemptNavigation();
          }
        }, isMobile ? 1000 : 500);
        
      } catch (error) {
        console.error(`❌ [SAFE NAVIGATION] Attempt ${attempts} failed:`, error);
        
        if (attempts < maxRetries) {
          setTimeout(attemptNavigation, 1000);
        } else {
          console.log('🔄 [SAFE NAVIGATION] All attempts failed, using window.location');
          window.location.href = path;
        }
      }
    };
    
    attemptNavigation();
  };

  return { navigateSafely, navigateWithRetry };
};

// 모바일 특화 에러 핸들링
export const useMobileErrorHandler = () => {
  const handleAuthError = (error: any, context: string) => {
    const isMobile = isMobileDevice();
    const online = isOnline();
    
    console.error(`❌ [MOBILE ERROR] ${context} (Mobile: ${isMobile}, Online: ${online}):`, error);
    
    if (!online) {
      return {
        message: '네트워크 연결을 확인하고 다시 시도해주세요.',
        shouldRetry: true,
        retryDelay: 3000
      };
    }
    
    if (isMobile && error.message?.includes('network')) {
      return {
        message: '모바일 네트워크가 불안정합니다. 잠시 후 다시 시도해주세요.',
        shouldRetry: true,
        retryDelay: 5000
      };
    }
    
    if (error.message?.includes('session')) {
      return {
        message: '세션이 만료되었습니다. 다시 로그인해주세요.',
        shouldRetry: false,
        retryDelay: 0
      };
    }
    
    return {
      message: '오류가 발생했습니다. 다시 시도해주세요.',
      shouldRetry: true,
      retryDelay: 2000
    };
  };
  
  return { handleAuthError };
};