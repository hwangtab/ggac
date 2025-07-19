import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/utils/rateLimit'
import { sanitizeInput } from '@/utils/security'
import type { ActivityLogRequest } from '@/types'

/**
 * 단일 활동 로그 기록 API
 * POST /api/activities/log
 */
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      }

      const body = await request.json() as ActivityLogRequest
      const {
        action_type,
        target_type = null,
        target_id = null,
        metadata = {}
      } = body

      if (!action_type) {
        return NextResponse.json({ error: 'action_type이 필요합니다.' }, { status: 400 })
      }

      // 입력 검증 및 sanitization
      const sanitizedMetadata = typeof metadata === 'object' ? 
        Object.keys(metadata).reduce((acc, key) => {
          acc[key] = typeof metadata[key] === 'string' ? 
            sanitizeInput(metadata[key]) : metadata[key]
          return acc
        }, {} as Record<string, any>) : {}

      // 클라이언트 정보 수집
      const clientIP = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'

      // 데이터베이스에 활동 로그 기록
      const { data, error } = await supabase.rpc('log_user_activity', {
        p_user_id: session.user.id,
        p_action_type: action_type,
        p_target_type: target_type,
        p_target_id: target_id,
        p_metadata: sanitizedMetadata,
        p_ip_address: clientIP,
        p_user_agent: userAgent,
        p_session_id: sanitizedMetadata.session_id || null
      })

      if (error) {
        console.error('활동 로그 저장 오류:', error)
        return NextResponse.json({ error: '활동 로그 저장에 실패했습니다.' }, { status: 500 })
      }

      return NextResponse.json({ 
        success: true, 
        activity_id: data,
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      console.error('활동 로그 API 오류:', error)
      return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
    }
  })(request)
}
