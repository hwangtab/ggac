// 인증 상태 디버깅 유틸리티
export const debugAuthState = async (location: string) => {
  if (process.env.NODE_ENV === 'development') {
    const { createClientComponentClient } = await import('@supabase/auth-helpers-nextjs');
    const supabase = createClientComponentClient();
    
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      console.log(`[AUTH DEBUG - ${location}]`, {
        hasSession: !!session,
        userId: session?.user?.id,
        error: error?.message,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error(`[AUTH DEBUG ERROR - ${location}]`, e);
    }
  }
};

// 페이지 렌더링 상태 디버깅
export const debugPageRender = (pageName: string, renderState: 'start' | 'complete' | 'error') => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[PAGE RENDER - ${pageName}]`, {
      state: renderState,
      timestamp: new Date().toISOString()
    });
  }
};