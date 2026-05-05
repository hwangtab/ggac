import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { checkAdminPermission } from '@/lib/server/adminAuth'
import { applyRateLimit, createUserKeyGenerator, addRateLimitHeaders } from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { createLogger } from '@/utils/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = createLogger('admin/settings/reset')

const ResetRequestSchema = z
  .object({
    resetType: z.enum(['all', 'category']).optional().default('all'),
    category: z.enum(['site', 'email', 'security', 'features']).nullable().optional(),
  })
  .strict()

// 기본 설정값 정의
const DEFAULT_SETTINGS = [
  // 사이트 설정
  {
    category: 'site',
    setting_key: 'maintenance_mode',
    setting_value: { enabled: false, message: '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.' },
    description: '유지보수 모드 설정',
    is_sensitive: false,
  },
  {
    category: 'site',
    setting_key: 'registration_enabled',
    setting_value: { enabled: true, require_approval: true },
    description: '회원 가입 허용 설정',
    is_sensitive: false,
  },
  {
    category: 'site',
    setting_key: 'site_title',
    setting_value: { value: '경기아트콜렉티브' },
    description: '사이트 제목',
    is_sensitive: false,
  },
  {
    category: 'site',
    setting_key: 'site_description',
    setting_value: { value: '경계 없는 상상, 함께 만드는 울림' },
    description: '사이트 설명',
    is_sensitive: false,
  },
  {
    category: 'site',
    setting_key: 'max_members',
    setting_value: { value: 1000, current_count: 0 },
    description: '최대 회원 수',
    is_sensitive: false,
  },
  {
    category: 'site',
    setting_key: 'contact_info',
    setting_value: {
      email: 'contact@ggac.kr',
      phone: '0507-1384-3144',
      address: '경기도 고양시 덕양구 성사동 719',
    },
    description: '연락처 정보',
    is_sensitive: false,
  },
  // 이메일 설정
  {
    category: 'email',
    setting_key: 'smtp_config',
    setting_value: {
      host: '',
      port: 587,
      secure: true,
      user: '',
      password: '',
      from_email: 'noreply@ggac.kr',
      from_name: '경기아트콜렉티브',
    },
    description: 'SMTP 서버 설정',
    is_sensitive: true,
  },
  {
    category: 'email',
    setting_key: 'email_templates',
    setting_value: {
      welcome: { subject: '경기아트콜렉티브에 오신 것을 환영합니다', enabled: true },
      approval: { subject: '회원 승인 완료', enabled: true },
      rejection: { subject: '회원 가입 검토 결과', enabled: true },
    },
    description: '이메일 템플릿 설정',
    is_sensitive: false,
  },
  {
    category: 'email',
    setting_key: 'notification_settings',
    setting_value: {
      admin_notifications: true,
      member_notifications: true,
      system_notifications: true,
    },
    description: '알림 이메일 설정',
    is_sensitive: false,
  },
  // 보안 설정
  {
    category: 'security',
    setting_key: 'session_config',
    setting_value: {
      timeout_minutes: 480,
      max_concurrent_sessions: 5,
      require_reauth_for_sensitive: true,
    },
    description: '세션 관리 설정',
    is_sensitive: false,
  },
  {
    category: 'security',
    setting_key: 'login_policy',
    setting_value: {
      max_attempts: 5,
      lockout_duration_minutes: 30,
      require_strong_password: true,
    },
    description: '로그인 정책',
    is_sensitive: false,
  },
  {
    category: 'security',
    setting_key: 'password_policy',
    setting_value: {
      min_length: 8,
      require_uppercase: true,
      require_lowercase: true,
      require_numbers: true,
      require_special: false,
      history_count: 5,
    },
    description: '비밀번호 정책',
    is_sensitive: false,
  },
  {
    category: 'security',
    setting_key: 'email_verification',
    setting_value: {
      required: true,
      token_expiry_hours: 24,
      resend_limit: 3,
    },
    description: '이메일 인증 설정',
    is_sensitive: false,
  },
  {
    category: 'security',
    setting_key: 'rate_limiting',
    setting_value: {
      api_requests_per_minute: 60,
      login_attempts_per_hour: 10,
      registration_per_day: 50,
    },
    description: '요청 제한 설정',
    is_sensitive: false,
  },
  // 기능 설정
  {
    category: 'features',
    setting_key: 'board_features',
    setting_value: {
      enabled: true,
      categories: ['공지', '잡담', '홍보', '건의'],
      allow_anonymous: false,
      moderation_enabled: true,
    },
    description: '게시판 기능 설정',
    is_sensitive: false,
  },
  {
    category: 'features',
    setting_key: 'artist_features',
    setting_value: {
      registration_enabled: true,
      portfolio_upload: true,
      public_profile: true,
      collaboration_requests: true,
    },
    description: '아티스트 기능 설정',
    is_sensitive: false,
  },
  {
    category: 'features',
    setting_key: 'comment_features',
    setting_value: {
      enabled: true,
      nested_replies: true,
      max_depth: 3,
      moderation_enabled: true,
      allow_editing: true,
    },
    description: '댓글 기능 설정',
    is_sensitive: false,
  },
  {
    category: 'features',
    setting_key: 'file_upload',
    setting_value: {
      enabled: true,
      max_size_mb: 10,
      allowed_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      virus_scan: false,
    },
    description: '파일 업로드 설정',
    is_sensitive: false,
  },
  {
    category: 'features',
    setting_key: 'social_features',
    setting_value: {
      likes_enabled: true,
      sharing_enabled: true,
      follow_system: false,
      activity_feed: true,
    },
    description: '소셜 기능 설정',
    is_sensitive: false,
  },
]

// POST: 모든 설정을 기본값으로 복원
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (매우 엄격하게)
    const rateLimiter = await applyRateLimit({
      maxRequests: 1, // 1시간에 1번만
      windowMs: 60 * 60 * 1000, // 1시간
      keyGenerator: createUserKeyGenerator('admin_settings_reset'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 사용자 인증 및 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    await checkAdminPermission(supabase, user.id)

    // 요청 데이터 파싱 + Zod 검증
    let resetType: 'all' | 'category'
    let category: string | null
    try {
      const rawJson = await request.json().catch(() => ({}))
      const parsed = ResetRequestSchema.safeParse(rawJson)
      if (!parsed.success) {
        return NextResponse.json(
          { error: '유효하지 않은 요청입니다.', details: parsed.error.flatten() },
          { status: 400 }
        )
      }
      resetType = parsed.data.resetType
      category = parsed.data.category ?? null
    } catch {
      return createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400)
    }

    let settingsToReset = DEFAULT_SETTINGS

    // 특정 카테고리만 초기화하는 경우
    if (resetType === 'category' && category) {
      settingsToReset = DEFAULT_SETTINGS.filter(setting => setting.category === category)

      if (settingsToReset.length === 0) {
        return createErrorResponse({ success: false, error: '유효하지 않은 카테고리입니다.' }, 400)
      }
    }

    // 설정 복원 실행
    const resetResults: string[] = []
    const errorResults: string[] = []

    for (const setting of settingsToReset) {
      try {
        const { error: updateError } = await supabase.rpc('update_system_setting', {
          p_category: setting.category,
          p_setting_key: setting.setting_key,
          p_setting_value: setting.setting_value,
        })

        if (updateError) {
          log.error(
            `Setting reset error for ${setting.category}.${setting.setting_key}`,
            updateError
          )
          errorResults.push(`${setting.category}.${setting.setting_key}`)
        } else {
          resetResults.push(`${setting.category}.${setting.setting_key}`)
        }
      } catch (err) {
        log.error('Setting reset exception', err)
        errorResults.push(`${setting.category}.${setting.setting_key}`)
      }
    }

    // 설정 복원 성공 시 캐시 무효화
    if (resetResults.length > 0) {
      refreshSettingsCache()
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'ADMIN_SETTINGS_RESET_TO_DEFAULTS',
      {
        adminId: user.id,
        resetType,
        category,
        reset: resetResults,
        errors: errorResults,
      },
      'high'
    ) // 기본값 복원은 높은 보안 등급

    const response = NextResponse.json({
      success: errorResults.length === 0,
      message:
        errorResults.length === 0
          ? `${resetType === 'all' ? '모든' : category} 설정이 성공적으로 기본값으로 복원되었습니다.`
          : `일부 설정 복원에 실패했습니다. 성공: ${resetResults.length}, 실패: ${errorResults.length}`,
      details: {
        resetType,
        category,
        reset: resetResults,
        errors: errorResults,
      },
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      1, // 복원 제한 수
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    log.error('Admin settings reset error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_RESET_ERROR',
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
          : '설정 초기화 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
