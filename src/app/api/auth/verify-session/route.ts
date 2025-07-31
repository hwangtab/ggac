import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Force dynamic rendering to avoid static generation issues with cookies
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore });
    
    // 세션 확인
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.log('[VERIFY-SESSION] Session error:', sessionError);
      return NextResponse.json({ 
        authenticated: false, 
        error: 'Session error',
        details: sessionError.message 
      }, { status: 401 });
    }
    
    if (!session || !session.user) {
      console.log('[VERIFY-SESSION] No session found');
      return NextResponse.json({ 
        authenticated: false, 
        error: 'No session found' 
      }, { status: 401 });
    }
    
    // 추가로 member_profiles 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, display_name')
      .eq('id', session.user.id)
      .single();
    
    if (profileError) {
      console.log('[VERIFY-SESSION] Profile error:', profileError);
      return NextResponse.json({ 
        authenticated: true, 
        user: session.user,
        profile: null,
        error: 'Profile not found',
        details: profileError.message
      }, { status: 200 });
    }
    
    console.log('[VERIFY-SESSION] Session and profile verified successfully');
    return NextResponse.json({ 
      authenticated: true, 
      user: session.user,
      profile: profile,
      sessionId: session.access_token?.substring(0, 10) + '...' // 디버깅용 세션 ID 일부
    }, { status: 200 });
    
  } catch (error) {
    console.error('[VERIFY-SESSION] Unexpected error:', error);
    return NextResponse.json({ 
      authenticated: false, 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}