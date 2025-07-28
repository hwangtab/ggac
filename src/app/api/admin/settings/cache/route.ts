import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator, addRateLimitHeaders } from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'

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

// POST: 시스템 설정 캐시 무효화
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_cache_invalidate')
    })
    
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 및 관리자 권한 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    await checkAdminPermission(supabase, session.user.id)

    // 요청 데이터 파싱
    const requestData = await request.json()
    const { cacheType = 'all' } = requestData

    console.log('[DEBUG] Cache invalidation request:', { cacheType, adminId: session.user.id })

    // 설정 캐시 무효화
    refreshSettingsCache()

    // 보안 이벤트 로깅
    logSecurityEvent('ADMIN_SETTINGS_CACHE_INVALIDATED', {
      adminId: session.user.id,
      cacheType
    }, 'low')

    const response = NextResponse.json({
      success: true,
      message: '설정 캐시가 성공적으로 무효화되었습니다.',
      timestamp: new Date().toISOString(),
      details: {
        cacheType,
        invalidatedAt: new Date().toISOString()
      }
    })
    
    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )

  } catch (error) {
    console.error('Admin settings cache invalidation error:', error)
    logSecurityEvent('ADMIN_SETTINGS_CACHE_INVALIDATION_ERROR', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 'medium')
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '캐시 무효화 중 오류가 발생했습니다.' },
      { status: error instanceof Error && error.message.includes('권한') ? 403 : 500 }
    )
  }
}

// GET: 현재 캐시 상태 조회
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_cache_status')
    })
    
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 및 관리자 권한 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    await checkAdminPermission(supabase, session.user.id)

    // 캐시 상태 정보 수집
    const cacheStatus = {
      systemSettings: {
        cached: true, // systemSettings 유틸리티에서 캐시 상태를 확인할 수 있다면 더 정확하게
        lastRefresh: new Date().toISOString() // 실제로는 캐시 타임스탬프를 가져와야 함
      },
      middleware: {
        cached: true, // 미들웨어 캐시 상태
        lastRefresh: new Date().toISOString()
      }
    }

    const response = NextResponse.json({
      success: true,
      cacheStatus,
      timestamp: new Date().toISOString()
    })
    
    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )

  } catch (error) {
    console.error('Admin settings cache status error:', error)
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '캐시 상태 조회 중 오류가 발생했습니다.' },
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}