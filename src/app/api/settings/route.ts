import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { rateLimit } from '@/utils/rateLimit'

/**
 * 사용자 설정 조회 API
 * GET /api/settings
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = await rateLimit(request, 'GENERAL_API')
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
        console.error('Settings fetch error:', error)
        return NextResponse.json(
          { error: 'Failed to fetch settings' },
          { status: 500 }
        )
      }

      const filteredSettings = allSettings?.filter((setting: any) => 
        setting.category === category
      ) || []

      return NextResponse.json({
        success: true,
        settings: filteredSettings,
        category: category
      })
    } else {
      const { data: settings, error } = await query

      if (error) {
        console.error('Settings fetch error:', error)
        return NextResponse.json(
          { error: 'Failed to fetch settings' },
          { status: 500 }
        )
      }

      // 카테고리별로 그룹화
      const groupedSettings = settings?.reduce((acc: any, setting: any) => {
        if (!acc[setting.category]) {
          acc[setting.category] = []
        }
        acc[setting.category].push(setting)
        return acc
      }, {}) || {}

      return NextResponse.json({
        success: true,
        settings: groupedSettings,
        total: settings?.length || 0
      })
    }

  } catch (error) {
    console.error('Settings API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * 사용자 설정 업데이트 API
 * POST /api/settings
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = await rateLimit(request, 'GENERAL_API')
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { category, setting_key, setting_value } = body

    // 입력 유효성 검사
    if (!category || !setting_key || setting_value === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: category, setting_key, setting_value' },
        { status: 400 }
      )
    }

    // 설정 업데이트
    const { data: settingId, error } = await supabase.rpc('upsert_user_setting', {
      p_category: category,
      p_setting_key: setting_key,
      p_setting_value: setting_value
    })

    if (error) {
      console.error('Setting update error:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to update setting' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      setting_id: settingId,
      message: 'Setting updated successfully'
    })

  } catch (error) {
    console.error('Settings update API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * 사용자 설정 일괄 업데이트 API
 * PUT /api/settings
 */
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = await rateLimit(request, 'GENERAL_API')
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { settings } = body

    // 입력 유효성 검사
    if (!Array.isArray(settings) || settings.length === 0) {
      return NextResponse.json(
        { error: 'Settings must be a non-empty array' },
        { status: 400 }
      )
    }

    const results = []
    let successCount = 0
    let errorCount = 0

    // 각 설정을 순차적으로 업데이트
    for (const setting of settings) {
      const { category, setting_key, setting_value } = setting

      if (!category || !setting_key || setting_value === undefined) {
        results.push({
          category,
          setting_key,
          success: false,
          error: 'Missing required fields'
        })
        errorCount++
        continue
      }

      try {
        const { data: settingId, error } = await supabase.rpc('upsert_user_setting', {
          p_category: category,
          p_setting_key: setting_key,
          p_setting_value: setting_value
        })

        if (error) {
          results.push({
            category,
            setting_key,
            success: false,
            error: error.message
          })
          errorCount++
        } else {
          results.push({
            category,
            setting_key,
            success: true,
            setting_id: settingId
          })
          successCount++
        }
      } catch (err) {
        results.push({
          category,
          setting_key,
          success: false,
          error: 'Internal error'
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
        errors: errorCount
      }
    })

  } catch (error) {
    console.error('Bulk settings update API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}