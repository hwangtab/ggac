import { NextResponse } from 'next/server'
import { getProfileById } from '@/db/queries/profiles'
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

    // email_confirmed_at은 requireUser()가 SessionContext에서 그대로 넘겨준다
    // (authz.ts의 getSessionContext가 이미 auth.getUser()로 채운 값). 이 값을
    // 따로 다시 조회하려고 supabase.auth.getUser()를 한 번 더 부르지 않는다 —
    // 그 왕복이 이 라우트를 4회 왕복으로 만들던 원인이었다(memberAuth.ts 리뷰).
    //
    // member_profiles는 여기서 다시 조회한다. requireUser()는 승인 대기
    // 사용자도 통과시켜야 해서 프로필을 반환하지 않도록 설계됐고(요구되는 컬럼
    // 집합도 getSessionContext 내부 조회보다 넓다 — display_name·is_artist·
    // artist_id까지 필요), 그래서 이 중복은 없애지 않는다. 프로필의 권위는
    // Turso다(getProfileById) — 행이 없어도, 조회 자체가 실패해도 이전
    // Supabase `.single()`이 둘 다 profileError로 뭉뚱그려 profile: null(200)로
    // 응답하던 것과 같은 결과가 되도록 아래에서 합친다(이 라우트는 인가
    // 경계가 아니라 상태 조회이므로 500으로 승격하지 않는다 — 기존 그대로).
    let profile: Awaited<ReturnType<typeof getProfileById>> = null
    let profileLookupFailed = false
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('[VERIFY-SESSION] Profile error:', error)
      profileLookupFailed = true
    }

    if (profileLookupFailed || !profile) {
      if (!profileLookupFailed) {
        console.error('[VERIFY-SESSION] Profile error:', 'profile not found')
      }
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
      profile: {
        registration_status: profile.registration_status,
        is_active: profile.is_active,
        display_name: profile.display_name,
        is_admin: profile.is_admin,
        is_artist: profile.is_artist,
        artist_id: profile.artist_id,
        is_director: profile.is_director,
        is_auditor: profile.is_auditor,
        withdrawal_requested_at: profile.withdrawal_requested_at,
      },
    }).toNextResponse()
  } catch (error) {
    console.error('[VERIFY-SESSION] Unexpected error:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
