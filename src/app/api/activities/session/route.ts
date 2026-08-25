import { headers } from 'next/headers'
import { auth } from '@/lib/auth/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/lib/server/rateLimit'
import { sanitizeInput } from '@/utils/security'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { requireUser } from '@/lib/server/memberAuth'
import { manageUserSession } from '@/db/queries/sessions'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/activities/session')

/**
 * 사용자 세션 관리 API
 * GET /api/activities/session - 현재 세션 상태 확인
 * POST /api/activities/session - 세션 관리
 */

export const dynamic = 'force-dynamic'

/**
 * 현재 세션 상태 확인
 */
export async function GET(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      // 이 엔드포인트의 목적 자체가 "로그인 상태 여부"를 반환하는 것이라
      // 401로 강제 차단하지 않는 선택적 조회다. requireUser()로 바꾸지 않는다.
      //
      // `readSessionUser()`(session.ts)는 의도적으로 모든 예외를 삼켜 null로
      // 뭉갠다 — "세션 없음"과 "조회 오류"를 구분할 필요가 없는 소비자를 위한
      // 계약이다. 이 라우트는 그 두 결과를 구분해야 하므로(세션 없음=200,
      // 오류=500 — 단계 2b-4가 이 파일을 헬퍼 전환에서 일부러 뺀 이유),
      // `readSessionUser()`를 거치지 않고 Better Auth의 `getSession`을 직접
      // 부른다. 세션이 없으면 `null`을 반환하고, 조회 자체가 실패하면(DB 장애
      // 등) 예외를 던진다 — 아래 catch가 그 예외만 500으로 매핑한다.
      const session = await auth.api.getSession({ headers: await headers() })

      return ApiSuccess.ok({
        authenticated: !!session?.user,
        user_id: session?.user?.id || null,
        expires_at: null,
      }).toNextResponse()
    } catch (error) {
      console.error('세션 GET API 오류:', error)
      return ApiError.internalServerError('서버 오류').toNextResponse()
    }
  })(request)
}
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const auth = await requireUser()
      if (auth instanceof NextResponse) return auth
      const { user } = auth

      const body = await parseJsonObjectBody(request)

      if (!body) {
        return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
      }

      const { session_token, metadata = {} } = body
      const action = typeof body.action === 'string' ? body.action : ''

      if (!action || !['start', 'update', 'end'].includes(action)) {
        return ApiError.badRequest(
          '유효한 action이 필요합니다. (start, update, end)'
        ).toNextResponse()
      }

      if (action === 'start' && typeof session_token !== 'string') {
        return ApiError.badRequest('session_token이 필요합니다.').toNextResponse()
      }
      if (action === 'update' && typeof body.session_id !== 'string') {
        return ApiError.badRequest('session_id가 필요합니다.').toNextResponse()
      }

      // 입력 검증 및 sanitization
      const sanitizedMetadata: Record<string, unknown> =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? Object.keys(metadata).reduce(
              (acc, key) => {
                acc[key] =
                  typeof metadata[key] === 'string' ? sanitizeInput(metadata[key]) : metadata[key]
                return acc
              },
              {} as Record<string, unknown>
            )
          : {}

      // 클라이언트 정보 수집
      const clientIP =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'

      // 세션 관리 함수 호출 — 단계 4: manage_user_session RPC를 Turso 쿼리
      // 계층(manageUserSession)으로 대체했다. 활동 기록(로그인/로그아웃)만
      // 실패한 경우는 onWriteError로 로그를 남기고 세션 결과는 그대로
      // 응답한다(sessions.ts 모듈 설명, 브리프 필수 조건 1번). action이
      // 'start'인데 프로필이 아직 없는 사용자면(가입 훅이 upsertProfile
      // 실패를 삼키는 경로, sessions.ts 모듈 설명 참고) data가 null이 되고
      // 아래에서 session_id: null로 응답한다 — 500이 아니다(코드리뷰 지적,
      // 새로 생긴 회귀 수정).
      let data: string | null
      try {
        data = await manageUserSession(
          {
            user_id: user.id,
            session_token:
              typeof session_token === 'string'
                ? session_token
                : typeof body.session_id === 'string'
                  ? body.session_id
                  : '',
            action: action as 'start' | 'update' | 'end',
            ip_address: clientIP,
            user_agent: userAgent,
            metadata: sanitizedMetadata,
          },
          activityLogError =>
            log.warn('세션 활동 기록 실패', { message: (activityLogError as Error)?.message })
        )
      } catch (error) {
        console.error('세션 관리 오류:', error)
        return ApiError.internalServerError('세션 관리에 실패했습니다.').toNextResponse()
      }

      const payload: Record<string, unknown> = {
        action,
        timestamp: new Date().toISOString(),
      }

      if (action === 'start') {
        payload.session_id = data
      }

      return ApiSuccess.ok(payload).toNextResponse()
    } catch (error) {
      console.error('세션 API 오류:', error)
      return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
    }
  })(request)
}
