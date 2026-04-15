import { createSupabaseServer } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Force dynamic rendering to avoid static generation issues with cookies
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServer()

    // 세션 확인
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser()

    if (sessionError) {
      console.error('[VERIFY-SESSION] Session error:', sessionError)
      return NextResponse.json(
        {
          authenticated: false,
          error: 'Session error',
        },
        { status: 401 }
      )
    }

    if (!user) {
      console.log('[VERIFY-SESSION] No session found')
      return NextResponse.json(
        {
          authenticated: false,
          error: 'No session found',
        },
        { status: 401 }
      )
    }

    // 추가로 member_profiles 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, display_name')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[VERIFY-SESSION] Profile error:', profileError)
      return NextResponse.json(
        {
          authenticated: true,
          user: { id: user.id, email: user.email },
          profile: null,
          error: 'Profile not found',
        },
        { status: 200 }
      )
    }

    console.log('[VERIFY-SESSION] Session and profile verified successfully')
    return NextResponse.json(
      {
        authenticated: true,
        user: { id: user.id, email: user.email },
        profile: profile,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[VERIFY-SESSION] Unexpected error:', error)
    return NextResponse.json(
      {
        authenticated: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
