'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

// 페이지 로딩 상태를 안정화하는 유틸리티
export const useStablePageLoad = (targetPath?: string) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    let stabilityTimer: NodeJS.Timeout;

    const stabilizePage = async () => {
      try {
        // 미들웨어 처리 시간을 고려한 대기
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 세션 상태 확인
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!mounted) return;

        // 안정성을 위한 추가 대기 시간
        stabilityTimer = setTimeout(() => {
          if (mounted) {
            setIsLoading(false);
            setIsReady(true);
          }
        }, 50);

      } catch (error) {
        console.error('Error stabilizing page:', error);
        if (mounted) {
          setIsLoading(false);
          setIsReady(true);
        }
      }
    };

    stabilizePage();

    return () => {
      mounted = false;
      if (stabilityTimer) {
        clearTimeout(stabilityTimer);
      }
    };
  }, [targetPath]);

  return { isLoading, isReady };
};

// 네비게이션 안전 래퍼
export const useSafeNavigation = () => {
  const router = useRouter();

  const navigateSafely = (path: string, delay = 100) => {
    // 미들웨어 처리 시간을 고려한 안전한 네비게이션
    setTimeout(() => {
      router.push(path);
    }, delay);
  };

  return { navigateSafely };
};