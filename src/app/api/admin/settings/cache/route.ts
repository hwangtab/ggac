import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { refreshSettingsCache } from '@/utils/systemSettings'
import { createLogger, maskId } from '@/utils/logger'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = createLogger('admin/settings/cache')

const CacheInvalidateSchema = z
  .object({
    cacheType: z.enum(['all', 'settings', 'middleware']).optional().default('all'),
  })
  .strict()

// POST: 시스템 설정 캐시 무효화
export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/settings/cache',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_cache_invalidate'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth({
    unauthorizedResponse: () => ApiError.unauthorized('인증이 필요합니다.').toNextResponse(),
  }),
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: error => {
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
  },
  handler: async ({ body, auth }) => {
    const { user } = auth
    let cacheType: 'all' | 'settings' | 'middleware' = 'all'

    const parsed = CacheInvalidateSchema.safeParse(body)
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

    return ApiSuccess.ok(
      {
        cacheType,
        invalidatedAt: new Date().toISOString(),
      },
      '설정 캐시가 성공적으로 무효화되었습니다.'
    ).toNextResponse()
  },
})

// GET: 현재 캐시 상태 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/settings/cache',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_cache_status'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth(),
  errorResponse: error => {
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
  },
  handler: async () => {
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

    return NextResponse.json({
      success: true,
      cacheStatus,
      timestamp: new Date().toISOString(),
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
