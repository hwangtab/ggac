import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/settings')

const SettingValueSchema = z.unknown()

const SingleSettingSchema = z.object({
  category: z.string().min(1).max(64),
  setting_key: z.string().min(1).max(128),
  setting_value: SettingValueSchema,
})

const BulkSettingsSchema = z.object({
  settings: z.array(SingleSettingSchema).min(1).max(100),
})

/**
 * 사용자 설정 조회 API
 * GET /api/settings
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      )
    }

    const supabase = await createSupabaseServer()

    // 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    // URL 파라미터에서 카테고리 필터 확인
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    // 사용자 설정 조회 (기본값 포함)
    let query = supabase.rpc('get_user_settings')

    if (category) {
      // 카테고리별 필터링은 클라이언트에서 처리 (RPC 함수 한계)
      const { data: allSettings, error } = await query

      if (error) {
        log.error('Settings fetch error:', error)
        return createErrorResponse({ success: false, error: 'Failed to fetch settings' }, 500)
      }

      const filteredSettings =
        allSettings?.filter((setting: any) => setting.category === category) || []

      return NextResponse.json({
        success: true,
        settings: filteredSettings,
        category: category,
      })
    } else {
      const { data: settings, error } = await query

      if (error) {
        log.error('Settings fetch error:', error)
        return createErrorResponse({ success: false, error: 'Failed to fetch settings' }, 500)
      }

      // 카테고리별로 그룹화
      const groupedSettings =
        settings?.reduce((acc: any, setting: any) => {
          if (!acc[setting.category]) {
            acc[setting.category] = []
          }
          acc[setting.category].push(setting)
          return acc
        }, {}) || {}

      return NextResponse.json({
        success: true,
        settings: groupedSettings,
        total: settings?.length || 0,
      })
    }
  } catch (error) {
    log.error('Settings API error:', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}

/**
 * 사용자 설정 업데이트 API
 * POST /api/settings
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      )
    }

    const supabase = await createSupabaseServer()

    // 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400)
    }

    const parsed = SingleSettingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '유효하지 않은 설정 데이터입니다.', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { category, setting_key, setting_value } = parsed.data

    // 설정 업데이트
    const { data: settingId, error } = await supabase.rpc('upsert_user_setting', {
      p_category: category,
      p_setting_key: setting_key,
      p_setting_value: setting_value,
    })

    if (error) {
      log.error('Setting update error:', error)
      return createErrorResponse({ success: false, error: '설정 업데이트에 실패했습니다.' }, 400)
    }

    return NextResponse.json({
      success: true,
      setting_id: settingId,
      message: 'Setting updated successfully',
    })
  } catch (error) {
    log.error('Settings update API error:', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}

/**
 * 사용자 설정 일괄 업데이트 API
 * PUT /api/settings
 */
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      )
    }

    const supabase = await createSupabaseServer()

    // 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400)
    }

    const parsed = BulkSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '유효하지 않은 설정 데이터입니다.', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { settings } = parsed.data

    const results = []
    let successCount = 0
    let errorCount = 0

    // 각 설정을 순차적으로 업데이트 (Zod로 형식은 이미 검증됨)
    for (const { category, setting_key, setting_value } of settings) {
      try {
        const { data: settingId, error } = await supabase.rpc('upsert_user_setting', {
          p_category: category,
          p_setting_key: setting_key,
          p_setting_value: setting_value,
        })

        if (error) {
          log.error('Bulk setting update error:', error)
          results.push({
            category,
            setting_key,
            success: false,
            error: '설정 업데이트에 실패했습니다.',
          })
          errorCount++
        } else {
          results.push({
            category,
            setting_key,
            success: true,
            setting_id: settingId,
          })
          successCount++
        }
      } catch (err) {
        log.error('Bulk setting update exception:', err)
        results.push({
          category,
          setting_key,
          success: false,
          error: 'Internal error',
        })
        errorCount++
      }
    }

    return NextResponse.json({
      success: successCount > 0,
      results,
      summary: {
        total: settings.length,
        success: successCount,
        errors: errorCount,
      },
    })
  } catch (error) {
    log.error('Bulk settings update API error:', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}
