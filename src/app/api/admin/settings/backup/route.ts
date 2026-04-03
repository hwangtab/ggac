import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function checkAdminPermission(supabase: any, userId: string) {
  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('is_admin, registration_status, is_active')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    throw new Error('프로필 정보를 조회할 수 없습니다.')
  }

  if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
    throw new Error('관리자 권한이 필요합니다.')
  }

  return profile
}

// GET: 설정 백업 파일 생성 및 다운로드
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_backup'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore as any })

    // 사용자 인증 및 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    console.log('[DEBUG] Backup API: Checking admin permission for user:', user.id)
    try {
      await checkAdminPermission(supabase, user.id)
      console.log('[DEBUG] Backup API: Admin permission check passed')
    } catch (permError) {
      console.error('[DEBUG] Backup API: Admin permission check failed:', permError)
      throw permError
    }

    // 모든 시스템 설정 조회 (민감한 정보 포함)
    console.log('[DEBUG] Backup API: Calling get_system_settings function')
    const { data: initialSettingsData, error: settingsError } = await supabase.rpc(
      'get_system_settings',
      { include_sensitive: true }
    )

    let settingsData = initialSettingsData

    console.log('[DEBUG] Backup API: get_system_settings result:', {
      hasData: !!settingsData,
      dataLength: settingsData?.length || 0,
      error: settingsError,
    })

    if (settingsError) {
      console.error('Settings backup error:', settingsError)
      console.error('Error details:', JSON.stringify(settingsError, null, 2))

      // 폴백: 직접 테이블 쿼리 시도
      console.log('[DEBUG] Backup API: Attempting fallback with direct table query')
      try {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('system_settings')
          .select('category, setting_key, setting_value, description, is_sensitive, updated_at')
          .order('category')
          .order('setting_key')

        if (fallbackError) {
          console.error('[DEBUG] Backup API: Fallback query also failed:', fallbackError)
          throw new Error(`백업을 위한 설정 테이블 조회 실패: ${fallbackError.message}`)
        }

        console.log(
          '[DEBUG] Backup API: Fallback query succeeded, data length:',
          fallbackData?.length || 0
        )
        settingsData = fallbackData
      } catch (fallbackErr) {
        console.error('[DEBUG] Backup API: Fallback mechanism failed:', fallbackErr)
        throw new Error(
          `백업을 위한 설정을 조회할 수 없습니다: ${settingsError.message || settingsError.code}`
        )
      }
    }

    // 백업 파일 생성
    const backupData = {
      metadata: {
        created_at: new Date().toISOString(),
        created_by: user.id,
        version: '1.0',
        description: '시스템 설정 백업 파일',
      },
      settings: settingsData || [],
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_BACKUP_CREATED',
      {
        adminId: user.id,
        settingsCount: settingsData?.length || 0,
      },
      'medium'
    )

    const response = new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="ggac-settings-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin settings backup error:', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_BACKUP_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'high'
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 백업 중 오류가 발생했습니다.' },
      { status: error instanceof Error && error.message.includes('권한') ? 403 : 500 }
    )
  }
}

// POST: 백업 파일에서 설정 복원
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (더 엄격한 제한)
    const rateLimiter = applyRateLimit({
      maxRequests: 3, // 복원은 더 제한적으로
      windowMs: 60 * 60 * 1000, // 1시간
      keyGenerator: createUserKeyGenerator('admin_settings_restore'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore as any })

    // 사용자 인증 및 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    await checkAdminPermission(supabase, user.id)

    // 요청 데이터 파싱
    const requestData = await request.json()

    // 백업 파일 유효성 검사
    if (!requestData || !requestData.settings || !Array.isArray(requestData.settings)) {
      return NextResponse.json({ error: '유효하지 않은 백업 파일입니다.' }, { status: 400 })
    }

    const { settings: backupSettings, metadata } = requestData

    // 백업 파일 메타데이터 검증
    if (metadata?.version !== '1.0') {
      return NextResponse.json({ error: '지원하지 않는 백업 파일 버전입니다.' }, { status: 400 })
    }

    // 설정 복원 실행
    const restoreResults: string[] = []
    const errorResults: string[] = []

    for (const setting of backupSettings) {
      try {
        const { category, setting_key, setting_value } = setting

        // 설정 유효성 검사
        if (!category || !setting_key || !setting_value) {
          errorResults.push(`${category}.${setting_key} (Invalid data)`)
          continue
        }

        // 데이터베이스 업데이트
        const { error: updateError } = await supabase.rpc('update_system_setting', {
          p_category: category,
          p_setting_key: setting_key,
          p_setting_value: setting_value,
        })

        if (updateError) {
          console.error(`Setting restore error for ${category}.${setting_key}:`, updateError)
          errorResults.push(`${category}.${setting_key}`)
        } else {
          restoreResults.push(`${category}.${setting_key}`)
        }
      } catch (err) {
        console.error(`Setting restore exception:`, err)
        errorResults.push(`${setting.category || 'unknown'}.${setting.setting_key || 'unknown'}`)
      }
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_RESTORED',
      {
        adminId: user.id,
        restored: restoreResults,
        errors: errorResults,
        backupMetadata: metadata,
      },
      'high'
    ) // 복원은 높은 보안 등급

    const response = NextResponse.json({
      success: errorResults.length === 0,
      message:
        errorResults.length === 0
          ? '설정이 성공적으로 복원되었습니다.'
          : `일부 설정 복원에 실패했습니다. 성공: ${restoreResults.length}, 실패: ${errorResults.length}`,
      details: {
        restored: restoreResults,
        errors: errorResults,
        backupInfo: metadata,
      },
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      3, // 복원 제한 수
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin settings restore error:', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_RESTORE_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'high'
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 복원 중 오류가 발생했습니다.' },
      { status: error instanceof Error && error.message.includes('권한') ? 403 : 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
