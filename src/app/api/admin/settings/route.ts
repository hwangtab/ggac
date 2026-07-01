import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { createLogger } from '@/utils/logger'

const log = createLogger('admin/settings')

// PUT 요청 본문 스키마 (모든 카테고리/필드는 optional, 일부 업데이트 허용)
const SystemSettingsUpdateSchema = z
  .object({
    site: z
      .object({
        maintenance_mode: z.boolean().optional(),
        registration_enabled: z.boolean().optional(),
        site_title: z.string().min(1).max(200).optional(),
        site_description: z.string().max(500).optional(),
        max_members: z.number().int().min(1).max(1_000_000).optional(),
      })
      .partial()
      .optional(),
    email: z
      .object({
        smtp_host: z.string().max(255).optional(),
        smtp_port: z.number().int().min(1).max(65535).optional(),
        smtp_user: z.string().max(255).optional(),
        smtp_password: z.string().max(255).optional(),
        from_email: z.string().email().or(z.string().length(0)).optional(),
        from_name: z.string().max(100).optional(),
      })
      .partial()
      .optional(),
    security: z
      .object({
        session_timeout: z.number().int().min(1).max(10080).optional(),
        max_login_attempts: z.number().int().min(1).max(100).optional(),
        password_min_length: z.number().int().min(4).max(64).optional(),
        require_email_verification: z.boolean().optional(),
      })
      .partial()
      .optional(),
    features: z
      .object({
        board_enabled: z.boolean().optional(),
        artist_registration_enabled: z.boolean().optional(),
        comments_enabled: z.boolean().optional(),
        file_uploads_enabled: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .strict()

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
    smtp_password: {
      key: 'smtp_config',
      transform: (value: any) => (value?.password ? '••••••••' : ''),
    },
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

// GET: 관리자 설정 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_get'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  errorResponse: error => {
    log.error('Admin settings GET error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_ACCESS_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'medium'
    )

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '설정 조회 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async ({ auth }) => {
    const supabase = auth.db

    // 데이터베이스에서 시스템 설정 조회
    const { data: initialSettingsData, error: settingsError } = await supabase.rpc(
      'get_system_settings',
      { include_sensitive: true }
    )

    let settingsData = initialSettingsData

    if (settingsError) {
      log.error('Settings query error', settingsError)

      // 폴백: 직접 테이블 쿼리 시도
      try {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('system_settings')
          .select('category, setting_key, setting_value, description, is_sensitive, updated_at')
          .order('category')
          .order('setting_key')

        if (fallbackError) {
          log.error('설정 테이블 직접 조회 실패', fallbackError)
          throw new Error('설정 테이블 조회 실패')
        }

        settingsData = fallbackData
      } catch (fallbackErr) {
        throw new Error('설정을 조회할 수 없습니다.')
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

    return NextResponse.json(settings)
  },
})

// PUT: 관리자 설정 업데이트
export const PUT = defineApiRoute<Record<string, unknown>>({
  method: 'PUT',
  name: 'api/admin/settings',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_update'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  body: {
    invalidResponse: () =>
      createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400),
  },
  errorResponse: error => {
    log.error('Admin settings PUT error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATE_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'high'
    )

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '설정 업데이트 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async ({ body, auth }) => {
    const supabase = auth.db
    const { user } = auth

    const parsed = SystemSettingsUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '유효하지 않은 설정 데이터입니다.', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const requestData: z.infer<typeof SystemSettingsUpdateSchema> = parsed.data

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
            log.error(`Setting update error for ${category}.${settingKey}`, updateError)
            errorResults.push(`${category}.${settingKey}`)
          } else {
            updateResults.push(`${category}.${settingKey}`)
          }
        } catch (err) {
          log.error(`Setting update exception for ${category}.${settingKey}`, err)
          errorResults.push(`${category}.${settingKey}`)
        }
      }
    }

    // 설정 업데이트 성공 시 캐시 무효화
    if (updateResults.length > 0) {
      refreshSettingsCache()
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_UPDATED',
      {
        adminId: user.id,
        updated: updateResults,
        errors: errorResults,
      },
      'medium'
    )

    return NextResponse.json({
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
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
