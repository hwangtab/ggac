import { createSupabaseServer } from '@/lib/supabase/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { NextRequest } from 'next/server'
import { withRateLimit } from '@/lib/server/rateLimit'
import { sanitizeInput } from '@/utils/security'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseActivityActionType, parseActivityTargetType } from '@/constants/activity'
import { validateUUID } from '@/utils/validation'
import type { ActivityLogRequest } from '@/types'

/**
 * 배치 활동 로그 기록 API
 * POST /api/activities/batch-log
 */
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const supabase = await createSupabaseServer()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
      }

      const body = await parseJsonObjectBody(request)
      if (!body) {
        return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
      }

      const logs = parseActivityLogArray(body.logs)

      if (!Array.isArray(logs) || logs.length === 0) {
        return ApiError.badRequest('유효한 로그 배열이 필요합니다.').toNextResponse()
      }

      if (logs.length > 100) {
        return ApiError.badRequest('배치 크기는 100개를 초과할 수 없습니다.').toNextResponse()
      }

      // 클라이언트 정보 수집
      const clientIP =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'

      const results = []
      const errors = []

      // 각 로그를 순차적으로 처리
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i]

        try {
          const actionType = parseActivityActionType(log.action_type)
          if (!actionType) {
            errors.push({ index: i, error: '유효한 action_type이 필요합니다.' })
            continue
          }
          const targetType = log.target_type ? parseActivityTargetType(log.target_type) : null
          if (log.target_type && !targetType) {
            errors.push({ index: i, error: '유효하지 않은 target_type입니다.' })
            continue
          }
          const targetIdValidation = log.target_id ? validateUUID(log.target_id, '대상 ID') : null
          if (targetIdValidation && !targetIdValidation.isValid) {
            errors.push({
              index: i,
              error: targetIdValidation.errors[0] || '잘못된 대상 ID입니다.',
            })
            continue
          }
          const targetId = targetIdValidation?.sanitized ?? null

          // 입력 검증 및 sanitization
          const sanitizedMetadata =
            typeof log.metadata === 'object' && log.metadata
              ? Object.keys(log.metadata).reduce(
                  (acc, key) => {
                    acc[key] =
                      typeof log.metadata![key] === 'string'
                        ? sanitizeInput(log.metadata![key])
                        : log.metadata![key]
                    return acc
                  },
                  {} as Record<string, any>
                )
              : {}

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
            console.error(`[API] 활동 로그 기록 실패 (index: ${i}):`, error)
            errors.push({ index: i, error: '활동 로그 기록에 실패했습니다.' })
          } else {
            results.push({ index: i, activity_id: data })
          }
        } catch (error) {
          console.error(`[API] 활동 로그 기록 예외 발생 (index: ${i}):`, error)
          errors.push({
            index: i,
            error: '활동 로그 기록에 실패했습니다.',
          })
        }
      }

      return ApiSuccess.ok({
        processed: results.length,
        failed: errors.length,
        results,
        errors,
        timestamp: new Date().toISOString(),
      }).toNextResponse()
    } catch (error) {
      console.error('배치 로그 API 오류:', error)
      return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
    }
  })(request)
}

function parseActivityLogArray(value: unknown): ActivityLogRequest[] | null {
  if (!Array.isArray(value)) return null

  return value.map(item => {
    const entry =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {}

    return {
      action_type: typeof entry.action_type === 'string' ? (entry.action_type as any) : ('' as any),
      target_type: typeof entry.target_type === 'string' ? (entry.target_type as any) : undefined,
      target_id: typeof entry.target_id === 'string' ? entry.target_id : undefined,
      metadata:
        entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
          ? (entry.metadata as Record<string, any>)
          : {},
    }
  })
}
