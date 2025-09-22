import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { rateLimit } from '@/utils/rateLimit'

/**
 * 사용자 설정 초기화 API
 * POST /api/settings/reset
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = await rateLimit(request, 'GENERAL_API')
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

    // 인증 확인
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { category, setting_key } = body

    // 설정 초기화 (기본값으로 복원)
    const { data: deletedCount, error } = await supabase.rpc('reset_user_settings', {
      p_category: category || null,
      p_setting_key: setting_key || null,
    })

    if (error) {
      console.error('Settings reset error:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to reset settings' },
        { status: 400 }
      )
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
    console.error('Settings reset API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
