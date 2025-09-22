import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

interface SystemSettingsData {
  site: {
    maintenance_mode: { enabled: boolean; message: string }
    registration_enabled: { enabled: boolean; require_approval: boolean }
    site_title: { value: string }
    site_description: { value: string }
    max_members: { value: number; current_count: number }
    contact_info: { email: string; phone: string; address: string }
  }
  email: {
    smtp_config: {
      host: string
      port: number
      secure: boolean
      user: string
      password: string
      from_email: string
      from_name: string
    }
    email_templates: {
      welcome: { subject: string; enabled: boolean }
      approval: { subject: string; enabled: boolean }
      rejection: { subject: string; enabled: boolean }
    }
    notification_settings: {
      admin_notifications: boolean
      member_notifications: boolean
      system_notifications: boolean
    }
  }
  security: {
    session_config: {
      timeout_minutes: number
      max_concurrent_sessions: number
      require_reauth_for_sensitive: boolean
    }
    login_policy: {
      max_attempts: number
      lockout_duration_minutes: number
      require_strong_password: boolean
    }
    password_policy: {
      min_length: number
      require_uppercase: boolean
      require_lowercase: boolean
      require_numbers: boolean
      require_special: boolean
      history_count: number
    }
    email_verification: {
      required: boolean
      token_expiry_hours: number
      resend_limit: number
    }
    rate_limiting: {
      api_requests_per_minute: number
      login_attempts_per_hour: number
      registration_per_day: number
    }
  }
  features: {
    board_features: {
      enabled: boolean
      categories: string[]
      allow_anonymous: boolean
      moderation_enabled: boolean
    }
    artist_features: {
      registration_enabled: boolean
      portfolio_upload: boolean
      public_profile: boolean
      collaboration_requests: boolean
    }
    comment_features: {
      enabled: boolean
      nested_replies: boolean
      max_depth: number
      moderation_enabled: boolean
      allow_editing: boolean
    }
    file_upload: {
      enabled: boolean
      max_size_mb: number
      allowed_types: string[]
      virus_scan: boolean
    }
    social_features: {
      likes_enabled: boolean
      sharing_enabled: boolean
      follow_system: boolean
      activity_feed: boolean
    }
  }
}

// 캐시된 설정 데이터
let cachedSettings: SystemSettingsData | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5분

/**
 * 기본 시스템 설정을 반환합니다
 */
function getDefaultSettings(): SystemSettingsData {
  return {
    site: {
      maintenance_mode: { enabled: false, message: '' },
      registration_enabled: { enabled: true, require_approval: true },
      site_title: { value: '경기아트콜렉티브' },
      site_description: { value: '경계 없는 상상, 함께 만드는 울림' },
      max_members: { value: 1000, current_count: 0 },
      contact_info: {
        email: 'contact@ggac.kr',
        phone: '0507-1384-3144',
        address: '경기도 고양시 덕양구 성사동 719',
      },
    },
    email: {
      smtp_config: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
        from_email: 'noreply@ggac.kr',
        from_name: '경기아트콜렉티브',
      },
      email_templates: {
        welcome: { subject: '환영합니다', enabled: true },
        approval: { subject: '가입이 승인되었습니다', enabled: true },
        rejection: { subject: '가입이 거부되었습니다', enabled: true },
      },
      notification_settings: {
        admin_notifications: true,
        member_notifications: true,
        system_notifications: true,
      },
    },
    security: {
      session_config: {
        timeout_minutes: 480,
        max_concurrent_sessions: 3,
        require_reauth_for_sensitive: true,
      },
      login_policy: {
        max_attempts: 5,
        lockout_duration_minutes: 15,
        require_strong_password: true,
      },
      password_policy: {
        min_length: 8,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: true,
        history_count: 5,
      },
      email_verification: {
        required: false,
        token_expiry_hours: 24,
        resend_limit: 3,
      },
      rate_limiting: {
        api_requests_per_minute: 60,
        login_attempts_per_hour: 10,
        registration_per_day: 50,
      },
    },
    features: {
      board_features: {
        enabled: true,
        categories: ['공지', '잡담', '홍보', '건의'],
        allow_anonymous: false,
        moderation_enabled: true,
      },
      artist_features: {
        registration_enabled: true,
        portfolio_upload: true,
        public_profile: true,
        collaboration_requests: true,
      },
      comment_features: {
        enabled: true,
        nested_replies: true,
        max_depth: 3,
        moderation_enabled: true,
        allow_editing: true,
      },
      file_upload: {
        enabled: true,
        max_size_mb: 50,
        allowed_types: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'docx'],
        virus_scan: false,
      },
      social_features: {
        likes_enabled: true,
        sharing_enabled: true,
        follow_system: false,
        activity_feed: true,
      },
    },
  }
}

/**
 * 시스템 설정을 조회합니다 (캐시 적용)
 * @param forceRefresh 강제 새로고침 여부
 * @returns 시스템 설정 데이터
 */
export async function getSystemSettings(forceRefresh = false): Promise<SystemSettingsData | null> {
  try {
    // 캐시 확인
    if (!forceRefresh && cachedSettings && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return cachedSettings
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore as any })

    const { data: settingsData, error } = await supabase.rpc('get_system_settings', {
      include_sensitive: false,
    })

    if (error) {
      console.error('Failed to fetch system settings:', error)
      // 오류 발생 시 기본값 반환
      return getDefaultSettings()
    }

    // 데이터를 구조화
    const settings: SystemSettingsData = {
      site: {} as any,
      email: {} as any,
      security: {} as any,
      features: {} as any,
    }

    for (const row of settingsData || []) {
      const category = row.category as keyof SystemSettingsData
      const settingKey = row.setting_key
      const settingValue = row.setting_value

      if (!settings[category]) {
        settings[category] = {} as any
      }

      ;(settings[category] as any)[settingKey] = settingValue
    }

    // 캐시 업데이트
    cachedSettings = settings
    cacheTimestamp = Date.now()

    return settings
  } catch (error) {
    console.error('Get system settings error:', error)
    return null
  }
}

/**
 * 유지보수 모드 상태를 확인합니다
 */
export async function isMaintenanceMode(): Promise<{ enabled: boolean; message?: string }> {
  const settings = await getSystemSettings()
  if (!settings?.site?.maintenance_mode) {
    return { enabled: false }
  }

  return {
    enabled: settings.site.maintenance_mode.enabled,
    message: settings.site.maintenance_mode.message,
  }
}

/**
 * 회원 가입이 허용되는지 확인합니다
 */
export async function isRegistrationEnabled(): Promise<{
  enabled: boolean
  require_approval?: boolean
}> {
  const settings = await getSystemSettings()
  if (!settings?.site?.registration_enabled) {
    return { enabled: true, require_approval: true }
  }

  return {
    enabled: settings.site.registration_enabled.enabled,
    require_approval: settings.site.registration_enabled.require_approval,
  }
}

/**
 * 최대 회원 수에 도달했는지 확인합니다
 */
export async function isMaxMembersReached(): Promise<{
  reached: boolean
  current: number
  max: number
}> {
  const settings = await getSystemSettings()
  if (!settings?.site?.max_members) {
    return { reached: false, current: 0, max: 1000 }
  }

  const { value: maxMembers, current_count: currentCount } = settings.site.max_members

  return {
    reached: currentCount >= maxMembers,
    current: currentCount,
    max: maxMembers,
  }
}

/**
 * 이메일 SMTP 설정을 가져옵니다
 */
export async function getEmailConfig() {
  const settings = await getSystemSettings()
  return settings?.email?.smtp_config || null
}

/**
 * 보안 정책을 가져옵니다
 */
export async function getSecurityPolicies() {
  const settings = await getSystemSettings()
  if (!settings?.security) {
    return null
  }

  return {
    session: settings.security.session_config,
    login: settings.security.login_policy,
    password: settings.security.password_policy,
    emailVerification: settings.security.email_verification,
    rateLimiting: settings.security.rate_limiting,
  }
}

/**
 * 기능 활성화 상태를 확인합니다
 */
export async function getFeatureFlags() {
  const settings = await getSystemSettings()
  if (!settings?.features) {
    return null
  }

  return {
    board: settings.features.board_features,
    artist: settings.features.artist_features,
    comments: settings.features.comment_features,
    fileUpload: settings.features.file_upload,
    social: settings.features.social_features,
  }
}

/**
 * 특정 기능이 활성화되어 있는지 확인합니다
 */
export async function isFeatureEnabled(
  feature: 'board' | 'artist_registration' | 'comments' | 'file_upload'
): Promise<boolean> {
  const features = await getFeatureFlags()
  if (!features) {
    return true // 기본값으로 활성화
  }

  switch (feature) {
    case 'board':
      return features.board?.enabled ?? true
    case 'artist_registration':
      return features.artist?.registration_enabled ?? true
    case 'comments':
      return features.comments?.enabled ?? true
    case 'file_upload':
      return features.fileUpload?.enabled ?? true
    default:
      return true
  }
}

/**
 * 설정 캐시를 강제로 새로고침합니다
 */
export function refreshSettingsCache() {
  cachedSettings = null
  cacheTimestamp = 0
}

/**
 * 사이트 기본 정보를 가져옵니다
 */
export async function getSiteInfo() {
  const settings = await getSystemSettings()
  if (!settings?.site) {
    return {
      title: '경기아트콜렉티브',
      description: '경계 없는 상상, 함께 만드는 울림',
      contact: {
        email: 'contact@ggac.kr',
        phone: '0507-1384-3144',
        address: '경기도 고양시 덕양구 성사동 719',
      },
    }
  }

  return {
    title: settings.site.site_title?.value || '경기아트콜렉티브',
    description: settings.site.site_description?.value || '경계 없는 상상, 함께 만드는 울림',
    contact: settings.site.contact_info || {
      email: 'contact@ggac.kr',
      phone: '0507-1384-3144',
      address: '경기도 고양시 덕양구 성사동 719',
    },
  }
}
