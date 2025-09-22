import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'

/**
 * 사용자 로그아웃 활동 로깅 API
 * POST /api/activities/logout
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit(RATE_LIMIT_CONFIGS.AUTH_API)
    const rateLimitResult = rateLimiter(request)

    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

    // 인증 확인
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sessionToken, metadata = {} } = body

    // IP 주소 및 User-Agent 추출
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1'
    const userAgent = request.headers.get('user-agent') || 'Unknown'

    // 세션 종료 처리
    const { data: sessionResult, error: sessionError } = await supabase.rpc('manage_user_session', {
      p_user_id: session.user.id,
      p_session_token: sessionToken,
      p_action: 'end',
      p_ip_address: ip,
      p_user_agent: userAgent,
      p_metadata: {
        ...metadata,
        logout_reason: 'user_initiated',
        timestamp: new Date().toISOString(),
      },
    })

    if (sessionError) {
      console.error('Session management error:', sessionError)
      return NextResponse.json({ error: 'Failed to manage session' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      sessionId: sessionResult,
      message: 'Logout activity logged successfully',
    })
  } catch (error) {
    console.error('Logout logging error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
