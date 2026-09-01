import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/lib/server/rateLimit'
import { requireUser } from '@/lib/server/memberAuth'
import { sanitizeInput } from '@/utils/security'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseActivityActionType, parseActivityTargetType } from '@/constants/activity'
import { validateUUID } from '@/utils/validation'
import { logUserActivity } from '@/db/queries/activities'
import type { ActivityLogRequest } from '@/types'

/**
 * 단일 활동 로그 기록 API
 * POST /api/activities/log
 */
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const auth = await requireUser()
      if (auth instanceof NextResponse) return auth
      const { user } = auth

      const body = parseActivityLogBody(await parseJsonObjectBody(request))
      if (!body) {
        return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
      }

      const { action_type, target_type = null, target_id = null, metadata = {} } = body

      const actionType = parseActivityActionType(action_type)
      if (!actionType) {
        return ApiError.badRequest('유효한 action_type이 필요합니다.').toNextResponse()
      }
      const targetType = target_type ? parseActivityTargetType(target_type) : null
      if (target_type && !targetType) {
        return ApiError.badRequest('유효하지 않은 target_type입니다.').toNextResponse()
      }
      const targetIdValidation = target_id ? validateUUID(target_id, '대상 ID') : null
      if (targetIdValidation && !targetIdValidation.isValid) {
        return ApiError.badRequest(
          targetIdValidation.errors[0] || '잘못된 대상 ID입니다.'
        ).toNextResponse()
      }
      const targetId = targetIdValidation?.sanitized ?? null
      // 사라진 `valid_target_combination` CHECK — 대상 종류 없이 대상 id만
      // 보내는 건 금지다. 쿼리 계층(`assertValidTargetCombination`)이 같은
      // 조합을 던져서 막지만, 그건 500이 된다. 사용자 입력이 들어오는 이
      // 자리에서는 400으로 돌려준다.
      if (!targetType && targetId) {
        return ApiError.badRequest(
          'target_id를 보내려면 target_type도 함께 보내야 합니다.'
        ).toNextResponse()
      }

      // 입력 검증 및 sanitization
      const sanitizedMetadata =
        typeof metadata === 'object'
          ? Object.keys(metadata).reduce(
              (acc, key) => {
                acc[key] =
                  typeof metadata[key] === 'string' ? sanitizeInput(metadata[key]) : metadata[key]
                return acc
              },
              {} as Record<string, any>
            )
          : {}

      // 클라이언트 정보 수집
      const clientIP =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'

      // session_id는 uuid 컬럼이라 검증 없이 넘기면 쓰레기 문자열이 그대로
      // 저장된다(옛 RPC 시절엔 uuid 캐스팅 실패로 500이었다 — 지금은 조용히
      // 저장되는 게 더 나쁘다). batch-log/route.ts와 같은 방식으로 맞춘다
      // (코드리뷰 지적 — 두 라우트의 session_id 검증이 비대칭이었다).
      const rawSessionId = sanitizedMetadata.session_id
      const sessionId =
        typeof rawSessionId === 'string' && validateUUID(rawSessionId, '세션 ID').isValid
          ? rawSessionId
          : null

      // 데이터베이스에 활동 로그 기록 — 단계 4: log_user_activity RPC를
      // Turso 쿼리 계층(logUserActivity)으로 대체했다. 이 라우트 자체가
      // "활동 기록"이 본 작업이므로(activities.ts 모듈 설명의 "본 작업을
      // 막지 않는다"는 좋아요·조회 같은 다른 라우트에 해당하는 원칙이다),
      // 실패하면 그대로 500을 응답한다.
      let activityId: string
      try {
        activityId = await logUserActivity({
          user_id: user.id,
          action_type: actionType,
          target_type: targetType,
          target_id: targetId,
          metadata: sanitizedMetadata,
          ip_address: clientIP,
          user_agent: userAgent,
          session_id: sessionId,
        })
      } catch (error) {
        console.error('활동 로그 저장 오류:', error)
        return ApiError.internalServerError('활동 로그 저장에 실패했습니다.').toNextResponse()
      }

      return ApiSuccess.ok({
        activity_id: activityId,
        timestamp: new Date().toISOString(),
      }).toNextResponse()
    } catch (error) {
      console.error('활동 로그 API 오류:', error)
      return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
    }
  })(request)
}

function parseActivityLogBody(body: Record<string, unknown> | null): ActivityLogRequest | null {
  if (!body) return null

  return {
    action_type: typeof body.action_type === 'string' ? (body.action_type as any) : ('' as any),
    target_type: typeof body.target_type === 'string' ? (body.target_type as any) : undefined,
    target_id: typeof body.target_id === 'string' ? body.target_id : undefined,
    metadata:
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, any>)
        : {},
  }
}
