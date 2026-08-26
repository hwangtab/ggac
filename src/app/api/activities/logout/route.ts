import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { requireUser } from '@/lib/server/memberAuth'
import { manageUserSession } from '@/db/queries/sessions'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/activities/logout')

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

    // 세션 종료 처리 — 단계 4: manage_user_session RPC를 Turso 쿼리 계층
    // (manageUserSession)으로 대체했다. 세션 쓰기 자체가 실패하면(예: DB
    // 접속 불가) 그대로 던지고 500을 응답한다 — 로그아웃 활동 기록만
    // 실패한 경우는 onWriteError로 로그를 남기고 세션 결과는 그대로
    // 응답한다(sessions.ts 모듈 설명, 브리프 필수 조건 1번).
    let sessionResult: string | null
    try {
      sessionResult = await manageUserSession(
        {
          user_id: user.id,
          session_token: sessionToken,
          action: 'end',
          ip_address: ip,
          user_agent: userAgent,
          metadata: {
            ...metadata,
            logout_reason: 'user_initiated',
            timestamp: new Date().toISOString(),
          },
        },
        activityLogError =>
          log.warn('로그아웃 활동 기록 실패', { message: (activityLogError as Error)?.message })
      )
    } catch (sessionError) {
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
