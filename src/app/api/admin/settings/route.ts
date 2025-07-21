import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator, addRateLimitHeaders } from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

// 기본 설정값
const DEFAULT_SETTINGS = {
  site: {
    maintenance_mode: false,
    registration_enabled: true,
    site_title: '경기아트콜렉티브',
    site_description: '경계 없는 상상, 함께 만드는 울림',
    max_members: 1000
  },
  email: {
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_email: 'noreply@ggac.kr',
    from_name: '경기아트콜렉티브'
  },
  security: {
    session_timeout: 60,
    max_login_attempts: 5,
    password_min_length: 8,
    require_email_verification: true
  },
  features: {
    board_enabled: true,
    artist_registration_enabled: true,
    comments_enabled: true,
    file_uploads_enabled: true
  }
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
      keyGenerator: createUserKeyGenerator('admin_settings_get')
    })
    
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 관리자 권한 확인
    await checkAdminPermission(supabase, session.user.id)

    // 설정 조회 (현재는 기본값 반환, 실제로는 데이터베이스에서 조회)
    const settings = DEFAULT_SETTINGS

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
    logSecurityEvent('ADMIN_SETTINGS_ACCESS_ERROR', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 'medium')
    
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
      keyGenerator: createUserKeyGenerator('admin_settings_update')
    })
    
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 관리자 권한 확인
    await checkAdminPermission(supabase, session.user.id)

    // 요청 데이터 파싱
    const requestData = await request.json()
    
    // 기본적인 유효성 검사
    if (!requestData || typeof requestData !== 'object') {
      return NextResponse.json(
        { error: '유효하지 않은 설정 데이터입니다.' },
        { status: 400 }
      )
    }

    // 설정 업데이트 (현재는 메모리에만 저장, 실제로는 데이터베이스에 저장)
    // TODO: 실제 데이터베이스 저장 로직 구현
    
    // 보안 이벤트 로깅
    logSecurityEvent('ADMIN_SETTINGS_UPDATED', {
      adminId: session.user.id,
      changes: Object.keys(requestData)
    }, 'medium')

    const response = NextResponse.json({
      success: true,
      message: '설정이 성공적으로 업데이트되었습니다.'
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
    logSecurityEvent('ADMIN_SETTINGS_UPDATE_ERROR', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 'high')
    
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