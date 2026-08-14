import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { requireUser } from '@/lib/server/memberAuth'

/**
 * 사용자 로그아웃 활동 로깅 API
 * POST /api/activities/logout
 */

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.AUTH_API)
    const rateLimitResult = await rateLimiter(request)

    if (!rateLimitResult.success) {
      return (
        rateLimitResult.response ??
        ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
      )
    }

    // 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    const body = await parseJsonObjectBody(request)

    if (!body) {
      return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }

    const sessionToken =
      typeof body.sessionToken === 'string'
        ? body.sessionToken
        : typeof body.session_id === 'string'
          ? body.session_id
          : ''
    const metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!sessionToken) {
      return ApiError.badRequest('sessionToken이 필요합니다.').toNextResponse()
    }

    // IP 주소 및 User-Agent 추출
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1'
    const userAgent = request.headers.get('user-agent') || 'Unknown'

    // 세션 종료 처리
    const { data: sessionResult, error: sessionError } = await supabase.rpc('manage_user_session', {
      p_user_id: user.id,
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
      return ApiError.internalServerError('Failed to manage session').toNextResponse()
    }

    return ApiSuccess.ok(
      { sessionId: sessionResult },
      'Logout activity logged successfully'
    ).toNextResponse()
  } catch (error) {
    console.error('Logout logging error:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
