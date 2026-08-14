import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireUser } from '@/lib/server/memberAuth'

// Force dynamic rendering to avoid static generation issues with cookies
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    // requireUser()는 id/email만 돌려준다. 이 라우트의 성공 응답 본문은
    // email_confirmed_at도 포함해야 하므로(동작 불변 원칙) 한 번 더 조회한다.
    const {
      data: { user: fullUser },
    } = await supabase.auth.getUser()

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
      return ApiSuccess.ok({
        authenticated: true,
        user: {
          id: user.id,
          email: fullUser?.email ?? user.email,
          email_confirmed_at: fullUser?.email_confirmed_at,
        },
        profile: null,
      }).toNextResponse()
    }

    return ApiSuccess.ok({
      authenticated: true,
      user: {
        id: user.id,
        email: fullUser?.email ?? user.email,
        email_confirmed_at: fullUser?.email_confirmed_at,
      },
      profile: profile,
    }).toNextResponse()
  } catch (error) {
    console.error('[VERIFY-SESSION] Unexpected error:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
