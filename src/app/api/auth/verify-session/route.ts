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

    // email_confirmed_at은 requireUser()가 SessionContext에서 그대로 넘겨준다
    // (authz.ts의 getSessionContext가 이미 auth.getUser()로 채운 값). 이 값을
    // 따로 다시 조회하려고 supabase.auth.getUser()를 한 번 더 부르지 않는다 —
    // 그 왕복이 이 라우트를 4회 왕복으로 만들던 원인이었다(memberAuth.ts 리뷰).
    //
    // member_profiles는 여기서 다시 조회한다. requireUser()는 승인 대기
    // 사용자도 통과시켜야 해서 프로필을 반환하지 않도록 설계됐고(요구되는 컬럼
    // 집합도 getSessionContext 내부 조회보다 넓다 — display_name·is_artist·
    // artist_id까지 필요), 그래서 이 중복은 없애지 않는다.
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
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
        },
        profile: null,
      }).toNextResponse()
    }

    return ApiSuccess.ok({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
      },
      profile: profile,
    }).toNextResponse()
  } catch (error) {
    console.error('[VERIFY-SESSION] Unexpected error:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
