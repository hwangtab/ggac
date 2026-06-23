import { createSupabaseServer } from '@/lib/supabase/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/lib/server/rateLimit'
import { sanitizeInput } from '@/utils/security'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseActivityActionType, parseActivityTargetType } from '@/constants/activity'
import { validateUUID } from '@/utils/validation'
import type { ActivityLogRequest } from '@/types'

/**
 * 단일 활동 로그 기록 API
 * POST /api/activities/log
 */
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const supabase = await createSupabaseServer()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
      }

      const body = parseActivityLogBody(await parseJsonObjectBody(request))
      if (!body) {
        return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
      }

      const { action_type, target_type = null, target_id = null, metadata = {} } = body

      const actionType = parseActivityActionType(action_type)
      if (!actionType) {
        return createErrorResponse(
          { success: false, error: '유효한 action_type이 필요합니다.' },
          400
        )
      }
      const targetType = target_type ? parseActivityTargetType(target_type) : null
      if (target_type && !targetType) {
        return createErrorResponse(
          { success: false, error: '유효하지 않은 target_type입니다.' },
          400
        )
      }
      const targetIdValidation = target_id ? validateUUID(target_id, '대상 ID') : null
      if (targetIdValidation && !targetIdValidation.isValid) {
        return createErrorResponse(
          { success: false, error: targetIdValidation.errors[0] || '잘못된 대상 ID입니다.' },
          400
        )
      }
      const targetId = targetIdValidation?.sanitized ?? null

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

      // 데이터베이스에 활동 로그 기록
      const { data, error } = await supabase.rpc('log_user_activity', {
        p_user_id: user.id,
        p_action_type: actionType,
        p_target_type: targetType,
        p_target_id: targetId,
        p_metadata: sanitizedMetadata,
        p_ip_address: clientIP,
        p_user_agent: userAgent,
        p_session_id: sanitizedMetadata.session_id || null,
      })

      if (error) {
        console.error('활동 로그 저장 오류:', error)
        return createErrorResponse({ success: false, error: '활동 로그 저장에 실패했습니다.' }, 500)
      }

      return NextResponse.json({
        success: true,
        activity_id: data,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('활동 로그 API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
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
