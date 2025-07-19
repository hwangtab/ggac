import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/utils/rateLimit'
import { sanitizeInput } from '@/utils/security'
import type { ActivityLogRequest } from '@/types'

/**
 * 배치 활동 로그 기록 API
 * POST /api/activities/batch-log
 */
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      }

      const { logs } = await request.json() as { logs: ActivityLogRequest[] }

      if (!Array.isArray(logs) || logs.length === 0) {
        return NextResponse.json({ error: '유효한 로그 배열이 필요합니다.' }, { status: 400 })
      }

      if (logs.length > 100) {
        return NextResponse.json({ error: '배치 크기는 100개를 초과할 수 없습니다.' }, { status: 400 })
      }

      // 클라이언트 정보 수집
      const clientIP = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'

      const results = []
      const errors = []

      // 각 로그를 순차적으로 처리
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i]
        
        try {
          if (!log.action_type) {
            errors.push({ index: i, error: 'action_type이 필수입니다.' })
            continue
          }

          // 입력 검증 및 sanitization
          const sanitizedMetadata = typeof log.metadata === 'object' && log.metadata ? 
            Object.keys(log.metadata).reduce((acc, key) => {
              acc[key] = typeof log.metadata![key] === 'string' ? 
                sanitizeInput(log.metadata![key]) : log.metadata![key]
              return acc
            }, {} as Record<string, any>) : {}

          const { data, error } = await supabase.rpc('log_user_activity', {
            p_user_id: session.user.id,
            p_action_type: log.action_type,
            p_target_type: log.target_type || null,
            p_target_id: log.target_id || null,
            p_metadata: sanitizedMetadata,
            p_ip_address: clientIP,
            p_user_agent: userAgent,
            p_session_id: sanitizedMetadata.session_id || null
          })

          if (error) {
            errors.push({ index: i, error: error.message })
          } else {
            results.push({ index: i, activity_id: data })
          }
        } catch (error) {
          errors.push({ index: i, error: error instanceof Error ? error.message : '알 수 없는 오류' })
        }
      }

      return NextResponse.json({ 
        success: errors.length === 0,
        processed: results.length,
        failed: errors.length,
        results,
        errors,
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      console.error('배치 로그 API 오류:', error)
      return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
    }
  })(request)
}
