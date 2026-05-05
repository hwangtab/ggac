import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { rateLimit } from '@/utils/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/settings/reset')

const ResetBodySchema = z
  .object({
    category: z.string().min(1).max(64).nullable().optional(),
    setting_key: z.string().min(1).max(128).nullable().optional(),
  })
  .strict()

/**
 * 사용자 설정 초기화 API
 * POST /api/settings/reset
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimit(request, 'GENERAL_API')
    if (!rateLimitResult.success) {
      return createErrorResponse({ success: false, error: 'Too many requests' }, 429)
    }

    const supabase = await createSupabaseServer()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return createErrorResponse({ success: false, error: 'Unauthorized' }, 401)
    }

    const rawJson = await request.json().catch(() => ({}))
    const parsed = ResetBodySchema.safeParse(rawJson)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '유효하지 않은 요청입니다.', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { category, setting_key } = parsed.data

    const { data: deletedCount, error } = await supabase.rpc('reset_user_settings', {
      p_category: category || null,
      p_setting_key: setting_key || null,
    })

    if (error) {
      log.error('Settings reset error', error)
      return createErrorResponse({ success: false, error: '설정 초기화에 실패했습니다.' }, 400)
    }

    let message = ''
    if (category && setting_key) {
      message = `Setting ${category}.${setting_key} reset to default`
    } else if (category) {
      message = `All ${category} settings reset to default`
    } else {
      message = 'All settings reset to default'
    }

    return NextResponse.json({
      success: true,
      deleted_count: deletedCount,
      message,
    })
  } catch (error) {
    log.error('Settings reset API error', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}
