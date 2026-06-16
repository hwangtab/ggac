import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createErrorResponse, createSuccessResponse } from '@/utils/apiResponse'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/auth/reset-password')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.AUTH_API)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return createErrorResponse('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
    }

    const body = await parseJsonObjectBody(request)
    const password = typeof body?.password === 'string' ? body.password : ''

    if (password.length < 6 || password.length > 1024) {
      return createErrorResponse('유효하지 않은 비밀번호입니다.', 400)
    }

    const supabase = await createSupabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return createErrorResponse('인증이 필요합니다.', 401)
    }

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      log.warn('Password reset update failed', { message: error.message })
      return createErrorResponse('비밀번호 변경에 실패했습니다.', 400)
    }

    return createSuccessResponse({})
  } catch (error) {
    log.error('Password reset API error', error)
    return createErrorResponse('Internal server error', 500)
  }
}
