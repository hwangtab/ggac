import { createSupabaseServer } from '@/lib/supabase/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/utils/rateLimit'
import { sanitizeInput } from '@/utils/security'
import { parseJsonObjectBody } from '@/utils/requestBody'

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
      const supabase = await createSupabaseServer()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error) {
        return createErrorResponse({ success: false, error: '세션 확인 실패' }, 500)
      }

      return NextResponse.json({
        authenticated: !!user,
        user_id: user?.id || null,
        expires_at: null,
      })
    } catch (error) {
      console.error('세션 GET API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류' }, 500)
    }
  })(request)
}
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

      const body = await parseJsonObjectBody(request)

      if (!body) {
        return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
      }

      const { session_token, metadata = {} } = body
      const action = typeof body.action === 'string' ? body.action : ''

      if (!action || !['start', 'update', 'end'].includes(action)) {
        return NextResponse.json(
          { error: '유효한 action이 필요합니다. (start, update, end)' },
          { status: 400 }
        )
      }

      if (action === 'start' && typeof session_token !== 'string') {
        return createErrorResponse({ success: false, error: 'session_token이 필요합니다.' }, 400)
      }
      if (action === 'update' && typeof body.session_id !== 'string') {
        return createErrorResponse({ success: false, error: 'session_id가 필요합니다.' }, 400)
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

      // 세션 관리 함수 호출
      const { data, error } = await supabase.rpc('manage_user_session', {
        p_user_id: user.id,
        p_session_token:
          typeof session_token === 'string'
            ? session_token
            : typeof body.session_id === 'string'
              ? body.session_id
              : '',
        p_action: action,
        p_ip_address: clientIP,
        p_user_agent: userAgent,
        p_metadata: sanitizedMetadata,
      })

      if (error) {
        console.error('세션 관리 오류:', error)
        return createErrorResponse({ success: false, error: '세션 관리에 실패했습니다.' }, 500)
      }

      const response: any = {
        success: true,
        action,
        timestamp: new Date().toISOString(),
      }

      if (action === 'start') {
        response.session_id = data
      }

      return NextResponse.json(response)
    } catch (error) {
      console.error('세션 API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
    }
  })(request)
}
