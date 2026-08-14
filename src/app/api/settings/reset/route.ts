import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { isUserSettingKey, parseUserSettingCategory } from '@/constants/userSettings'
import { requireUser } from '@/lib/server/memberAuth'

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
      return ApiError.tooManyRequests('Too many requests').toNextResponse()
    }

    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    const rawJson = await parseJsonObjectBody(request)
    if (!rawJson) {
      return ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse()
    }

    const parsed = ResetBodySchema.safeParse(rawJson)
    if (!parsed.success) {
      return ApiError.badRequest('유효하지 않은 요청입니다.').toNextResponse()
    }
    const category = parsed.data.category ? parseUserSettingCategory(parsed.data.category) : null
    const setting_key = parsed.data.setting_key || null

    if (parsed.data.category && !category) {
      return ApiError.badRequest('유효하지 않은 설정 카테고리입니다.').toNextResponse()
    }
    if (setting_key && !category) {
      return ApiError.badRequest('설정 키를 초기화하려면 카테고리가 필요합니다.').toNextResponse()
    }
    if (category && setting_key && !isUserSettingKey(category, setting_key)) {
      return ApiError.badRequest('유효하지 않은 설정입니다.').toNextResponse()
    }

    const { data: deletedCount, error } = await supabase.rpc('reset_user_settings', {
      p_category: category || null,
      p_setting_key: setting_key || null,
    })

    if (error) {
      log.error('Settings reset error', error)
      return ApiError.badRequest('설정 초기화에 실패했습니다.').toNextResponse()
    }

    let message = ''
    if (category && setting_key) {
      message = `Setting ${category}.${setting_key} reset to default`
    } else if (category) {
      message = `All ${category} settings reset to default`
    } else {
      message = 'All settings reset to default'
    }

    return ApiSuccess.ok({ deleted_count: deletedCount }, message).toNextResponse()
  } catch (error) {
    log.error('Settings reset API error', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
