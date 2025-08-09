import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/utils/rateLimit'
import { sanitizeInput } from '@/utils/security'

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
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        return NextResponse.json({ error: '세션 확인 실패' }, { status: 500 })
      }

      return NextResponse.json({ 
        authenticated: !!session?.user,
        user_id: session?.user?.id || null,
        expires_at: session?.expires_at || null
      })
    } catch (error) {
      console.error('세션 GET API 오류:', error)
      return NextResponse.json({ error: '서버 오류' }, { status: 500 })
    }
  })(request)
}
export async function POST(request: NextRequest) {
  return withRateLimit('GENERAL_API')(async () => {
    try {
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      }

      const body = await request.json()
      const { action, session_token, metadata = {} } = body

      if (!action || !['start', 'update', 'end'].includes(action)) {
        return NextResponse.json({ error: '유효한 action이 필요합니다. (start, update, end)' }, { status: 400 })
      }

      if ((action === 'start' || action === 'update') && !session_token) {
        return NextResponse.json({ error: 'session_token이 필요합니다.' }, { status: 400 })
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

      // 세션 관리 함수 호출
      const { data, error } = await supabase.rpc('manage_user_session', {
        p_user_id: session.user.id,
        p_session_token: session_token || body.session_id || '',
        p_action: action,
        p_ip_address: clientIP,
        p_user_agent: userAgent,
        p_metadata: sanitizedMetadata
      })

      if (error) {
        console.error('세션 관리 오류:', error)
        return NextResponse.json({ error: '세션 관리에 실패했습니다.' }, { status: 500 })
      }

      const response: any = { 
        success: true,
        action,
        timestamp: new Date().toISOString()
      }

      if (action === 'start') {
        response.session_id = data
      }

      return NextResponse.json(response)

    } catch (error) {
      console.error('세션 API 오류:', error)
      return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
    }
  })(request)
}
