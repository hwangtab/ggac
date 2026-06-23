import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { checkAdminPermission } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { createLogger, maskId } from '@/utils/logger'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = createLogger('admin/settings/cache')

const CacheInvalidateSchema = z
  .object({
    cacheType: z.enum(['all', 'settings', 'middleware']).optional().default('all'),
  })
  .strict()

// POST: 시스템 설정 캐시 무효화
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_cache_invalidate'),
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
      throw ApiError.unauthorized('인증이 필요합니다.')
    }

    await checkAdminPermission(supabase, user.id)

    // 요청 데이터 파싱 + Zod 검증
    let cacheType: 'all' | 'settings' | 'middleware' = 'all'
    const rawJson = await parseJsonObjectBody(request)
    if (!rawJson) {
      throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
    }

    const parsed = CacheInvalidateSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw ApiError.badRequest('유효하지 않은 캐시 타입입니다.')
    }
    cacheType = parsed.data.cacheType

    // 설정 캐시 무효화
    refreshSettingsCache()

    // 보안 이벤트 로깅 — adminId 평문 노출 회피
    logSecurityEvent(
      'ADMIN_SETTINGS_CACHE_INVALIDATED',
      {
        adminId: maskId(user.id),
        cacheType,
      },
      'low'
    )

    const response = ApiSuccess.ok(
      {
        cacheType,
        invalidatedAt: new Date().toISOString(),
      },
      '설정 캐시가 성공적으로 무효화되었습니다.'
    ).toNextResponse()

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return error.toNextResponse()
    }

    log.error('Admin settings cache invalidation error', error)
    logSecurityEvent(
      'ADMIN_SETTINGS_CACHE_INVALIDATION_ERROR',
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
          : '캐시 무효화 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  }
}

// GET: 현재 캐시 상태 조회
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_settings_cache_status'),
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

    // 캐시 상태 정보 수집
    const cacheStatus = {
      systemSettings: {
        cached: true, // systemSettings 유틸리티에서 캐시 상태를 확인할 수 있다면 더 정확하게
        lastRefresh: new Date().toISOString(), // 실제로는 캐시 타임스탬프를 가져와야 함
      },
      middleware: {
        cached: true, // 미들웨어 캐시 상태
        lastRefresh: new Date().toISOString(),
      },
    }

    const response = NextResponse.json({
      success: true,
      cacheStatus,
      timestamp: new Date().toISOString(),
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    log.error('Admin settings cache status error', error)

    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '캐시 상태 조회 중 오류가 발생했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
