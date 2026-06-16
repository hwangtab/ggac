import { createSupabaseServer } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/auth/verify-session')

// Force dynamic rendering to avoid static generation issues with cookies
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const authError = error as { name?: string; message?: string }
  return (
    authError.name === 'AuthSessionMissingError' ||
    authError.message?.includes('Auth session missing') === true
  )
}

export async function GET() {
  try {
    const supabase = await createSupabaseServer()

    // 세션 확인
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser()

    if (sessionError) {
      if (isMissingSessionError(sessionError)) {
        log.debug('No session found')
        return NextResponse.json(
          {
            authenticated: false,
            error: 'No session found',
          },
          { status: 401 }
        )
      }

      log.warn('Session error', sessionError)
      return NextResponse.json(
        {
          authenticated: false,
          error: 'Session error',
        },
        { status: 401 }
      )
    }

    if (!user) {
      log.debug('No session found')
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
      .select(
        'registration_status, is_active, display_name, is_admin, is_artist, artist_id, is_director, is_auditor'
      )
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[VERIFY-SESSION] Profile error:', profileError)
      return NextResponse.json(
        {
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            email_confirmed_at: user.email_confirmed_at,
          },
          profile: null,
          error: 'Profile not found',
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
        },
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
