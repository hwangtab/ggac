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
import { refreshSettingsCache } from '@/utils/systemSettings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface SystemSettings {
  site: {
    maintenance_mode: boolean
    registration_enabled: boolean
    site_title: string
    site_description: string
    max_members: number
  }
  email: {
    smtp_host: string
    smtp_port: number
    smtp_user: string
    smtp_password: string
    from_email: string
    from_name: string
  }
  security: {
    session_timeout: number
    max_login_attempts: number
    password_min_length: number
    require_email_verification: boolean
  }
  features: {
    board_enabled: boolean
    artist_registration_enabled: boolean
    comments_enabled: boolean
    file_uploads_enabled: boolean
  }
}

// 설정 카테고리별 키 매핑
const SETTING_MAPPINGS = {
  site: {
    maintenance_mode: {
      key: 'maintenance_mode',
      transform: (value: any) => value?.enabled || false,
    },
    registration_enabled: {
      key: 'registration_enabled',
      transform: (value: any) => value?.enabled || false,
    },
    site_title: {
      key: 'site_title',
      transform: (value: any) => value?.value || '경기아트콜렉티브',
    },
    site_description: {
      key: 'site_description',
      transform: (value: any) => value?.value || '경계 없는 상상, 함께 만드는 울림',
    },
    max_members: { key: 'max_members', transform: (value: any) => value?.value || 1000 },
  },
  email: {
    smtp_host: { key: 'smtp_config', transform: (value: any) => value?.host || '' },
    smtp_port: { key: 'smtp_config', transform: (value: any) => value?.port || 587 },
    smtp_user: { key: 'smtp_config', transform: (value: any) => value?.user || '' },
    smtp_password: { key: 'smtp_config', transform: (value: any) => value?.password || '' },
    from_email: {
      key: 'smtp_config',
      transform: (value: any) => value?.from_email || 'noreply@ggac.kr',
    },
    from_name: {
      key: 'smtp_config',
      transform: (value: any) => value?.from_name || '경기아트콜렉티브',
    },
  },
  security: {
    session_timeout: {
      key: 'session_config',
      transform: (value: any) => value?.timeout_minutes || 60,
    },
    max_login_attempts: {
      key: 'login_policy',
      transform: (value: any) => value?.max_attempts || 5,
    },
    password_min_length: {
      key: 'password_policy',
      transform: (value: any) => value?.min_length || 8,
    },
    require_email_verification: {
      key: 'email_verification',
      transform: (value: any) => value?.required || true,
    },
  },
  features: {
    board_enabled: { key: 'board_features', transform: (value: any) => value?.enabled || true },
    artist_registration_enabled: {
      key: 'artist_features',
      transform: (value: any) => value?.registration_enabled || true,
    },
    comments_enabled: {
      key: 'comment_features',
      transform: (value: any) => value?.enabled || true,
    },
    file_uploads_enabled: { key: 'file_upload', transform: (value: any) => value?.enabled || true },
  },
}

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

// GET: 관리자 설정 조회
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_get'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Checking admin permission for user:', session.user.id)
    }
    try {
      await checkAdminPermission(supabase, session.user.id)
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Admin permission check passed')
      }
    } catch (permError) {
      console.error('[DEBUG] Admin permission check failed:', permError)
      throw permError
    }

    // 데이터베이스에서 시스템 설정 조회
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Calling get_system_settings function')
    }
    const { data: initialSettingsData, error: settingsError } = await supabase.rpc(
      'get_system_settings',
      { include_sensitive: true }
    )

    let settingsData = initialSettingsData

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] get_system_settings result:', {
        hasData: !!settingsData,
        dataLength: settingsData?.length || 0,
        error: settingsError,
      })
    }

    if (settingsError) {
      console.error('Settings query error:', settingsError)
      console.error('Error details:', JSON.stringify(settingsError, null, 2))

      // 폴백: 직접 테이블 쿼리 시도
      console.log('[DEBUG] Attempting fallback with direct table query')
      try {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('system_settings')
          .select('category, setting_key, setting_value, description, is_sensitive, updated_at')
          .order('category')
          .order('setting_key')

        if (fallbackError) {
          console.error('[DEBUG] Fallback query also failed:', fallbackError)
          throw new Error(`설정 테이블 조회 실패: ${fallbackError.message}`)
        }

        console.log('[DEBUG] Fallback query succeeded, data length:', fallbackData?.length || 0)
        settingsData = fallbackData
      } catch (fallbackErr) {
        console.error('[DEBUG] Fallback mechanism failed:', fallbackErr)
        throw new Error(`설정을 조회할 수 없습니다: ${settingsError.message || settingsError.code}`)
      }
    }

    // 데이터베이스 결과를 프론트엔드 형식으로 변환
    const settings: SystemSettings = {
      site: {},
      email: {},
      security: {},
      features: {},
    } as SystemSettings

    // 설정 데이터를 카테고리별로 구조화
    for (const row of settingsData || []) {
      const category = row.category
      const settingKey = row.setting_key
      const settingValue = row.setting_value

      if (!settings[category as keyof SystemSettings]) {
        continue
      }

      // 매핑을 통해 프론트엔드 키로 변환
      const categoryMappings = SETTING_MAPPINGS[category as keyof typeof SETTING_MAPPINGS]
      if (categoryMappings) {
        for (const [frontendKey, mapping] of Object.entries(categoryMappings)) {
          if (mapping.key === settingKey) {
            ;(settings[category as keyof SystemSettings] as any)[frontendKey] =
              mapping.transform(settingValue)
          }
        }
      }
    }

    const response = NextResponse.json(settings)

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin settings GET error:', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_ACCESS_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'medium'
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 조회 중 오류가 발생했습니다.' },
      { status: error instanceof Error && error.message.includes('권한') ? 403 : 500 }
    )
  }
}

// PUT: 관리자 설정 업데이트
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_update'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    await checkAdminPermission(supabase, session.user.id)

    // 요청 데이터 파싱
    const requestData: SystemSettings = await request.json()

    // 기본적인 유효성 검사
    if (!requestData || typeof requestData !== 'object') {
      return NextResponse.json({ error: '유효하지 않은 설정 데이터입니다.' }, { status: 400 })
    }

    // 설정별로 데이터베이스 업데이트
    const updateResults: string[] = []
    const errorResults: string[] = []

    for (const [category, categoryData] of Object.entries(requestData)) {
      if (!categoryData || typeof categoryData !== 'object') {
        continue
      }

      const categoryMappings = SETTING_MAPPINGS[category as keyof typeof SETTING_MAPPINGS]
      if (!categoryMappings) {
        continue
      }

      // 같은 설정 키를 사용하는 항목들을 그룹화
      const settingGroups: { [key: string]: any } = {}

      for (const [frontendKey, frontendValue] of Object.entries(categoryData)) {
        const mapping = categoryMappings[frontendKey as keyof typeof categoryMappings] as
          | { key: string; transform: (value: any) => any }
          | undefined
        if (!mapping) {
          continue
        }

        if (!settingGroups[mapping.key]) {
          settingGroups[mapping.key] = {}
        }

        // 역변환: 프론트엔드 값을 데이터베이스 형식으로 변환
        switch (mapping.key) {
          case 'maintenance_mode':
            settingGroups[mapping.key] = {
              enabled: frontendValue,
              message:
                settingGroups[mapping.key]?.message ||
                '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.',
            }
            break
          case 'registration_enabled':
            settingGroups[mapping.key] = {
              enabled: frontendValue,
              require_approval: settingGroups[mapping.key]?.require_approval || true,
            }
            break
          case 'site_title':
          case 'site_description':
            settingGroups[mapping.key] = { value: frontendValue }
            break
          case 'max_members':
            settingGroups[mapping.key] = {
              value: frontendValue,
              current_count: settingGroups[mapping.key]?.current_count || 0,
            }
            break
          case 'smtp_config':
            if (frontendKey === 'smtp_host') settingGroups[mapping.key].host = frontendValue
            else if (frontendKey === 'smtp_port') settingGroups[mapping.key].port = frontendValue
            else if (frontendKey === 'smtp_user') settingGroups[mapping.key].user = frontendValue
            else if (frontendKey === 'smtp_password')
              settingGroups[mapping.key].password = frontendValue
            else if (frontendKey === 'from_email')
              settingGroups[mapping.key].from_email = frontendValue
            else if (frontendKey === 'from_name')
              settingGroups[mapping.key].from_name = frontendValue
            break
          case 'session_config':
            if (frontendKey === 'session_timeout') {
              settingGroups[mapping.key] = {
                timeout_minutes: frontendValue,
                max_concurrent_sessions: settingGroups[mapping.key]?.max_concurrent_sessions || 5,
                require_reauth_for_sensitive:
                  settingGroups[mapping.key]?.require_reauth_for_sensitive || true,
              }
            }
            break
          case 'login_policy':
            if (frontendKey === 'max_login_attempts') {
              settingGroups[mapping.key] = {
                max_attempts: frontendValue,
                lockout_duration_minutes:
                  settingGroups[mapping.key]?.lockout_duration_minutes || 30,
                require_strong_password:
                  settingGroups[mapping.key]?.require_strong_password || true,
              }
            }
            break
          case 'password_policy':
            if (frontendKey === 'password_min_length') {
              settingGroups[mapping.key] = {
                min_length: frontendValue,
                require_uppercase: settingGroups[mapping.key]?.require_uppercase || true,
                require_lowercase: settingGroups[mapping.key]?.require_lowercase || true,
                require_numbers: settingGroups[mapping.key]?.require_numbers || true,
                require_special: settingGroups[mapping.key]?.require_special || false,
                history_count: settingGroups[mapping.key]?.history_count || 5,
              }
            }
            break
          case 'email_verification':
            if (frontendKey === 'require_email_verification') {
              settingGroups[mapping.key] = {
                required: frontendValue,
                token_expiry_hours: settingGroups[mapping.key]?.token_expiry_hours || 24,
                resend_limit: settingGroups[mapping.key]?.resend_limit || 3,
              }
            }
            break
          case 'board_features':
          case 'artist_features':
          case 'comment_features':
          case 'file_upload':
            settingGroups[mapping.key] = {
              ...settingGroups[mapping.key],
              enabled: frontendValue,
            }
            if (
              mapping.key === 'artist_features' &&
              frontendKey === 'artist_registration_enabled'
            ) {
              settingGroups[mapping.key].registration_enabled = frontendValue
            }
            break
        }
      }

      // 그룹화된 설정들을 데이터베이스에 업데이트
      for (const [settingKey, settingValue] of Object.entries(settingGroups)) {
        try {
          const { error: updateError } = await supabase.rpc('update_system_setting', {
            p_category: category,
            p_setting_key: settingKey,
            p_setting_value: settingValue,
          })

          if (updateError) {
            console.error(`Setting update error for ${category}.${settingKey}:`, updateError)
            errorResults.push(`${category}.${settingKey}`)
          } else {
            updateResults.push(`${category}.${settingKey}`)
          }
        } catch (err) {
          console.error(`Setting update exception for ${category}.${settingKey}:`, err)
          errorResults.push(`${category}.${settingKey}`)
        }
      }
    }

    // 설정 업데이트 성공 시 캐시 무효화
    if (updateResults.length > 0) {
      console.log('[DEBUG] Settings updated, invalidating cache')
      refreshSettingsCache()
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATED',
      {
        adminId: session.user.id,
        updated: updateResults,
        errors: errorResults,
      },
      'medium'
    )

    const response = NextResponse.json({
      success: errorResults.length === 0,
      message:
        errorResults.length === 0
          ? '설정이 성공적으로 업데이트되었습니다.'
          : `일부 설정 업데이트에 실패했습니다. 성공: ${updateResults.length}, 실패: ${errorResults.length}`,
      details: {
        updated: updateResults,
        errors: errorResults,
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
    console.error('Admin settings PUT error:', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATE_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'high'
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 업데이트 중 오류가 발생했습니다.' },
      { status: error instanceof Error && error.message.includes('권한') ? 403 : 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
