import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import {
  getSettingsCacheState,
  refreshSettingsCache,
  SETTINGS_CACHE_TTL_MS,
} from '@/utils/systemSettings'
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

    const ttlMinutes = Math.ceil(SETTINGS_CACHE_TTL_MS / 60000)

    return ApiSuccess.ok(
      {
        cacheType,
        invalidatedAt: new Date().toISOString(),
        // 이 무효화가 닿는 범위. 부르는 쪽이 "전역으로 비웠다"고 읽지 않게
        // 값으로도 적어 둔다.
        scope: 'this-instance',
        otherInstancesWithinMs: SETTINGS_CACHE_TTL_MS,
      },
      `이 요청을 처리한 인스턴스에서는 즉시 반영됩니다. 다른 인스턴스는 최대 ${ttlMinutes}분 안에 반영됩니다.`
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
    // **이 인스턴스가 실제로 아는 것만 적는다.**
    //
    // 예전에는 `cached: true`와 `lastRefresh: new Date()`를 무조건 채워
    // 넣었다. 둘 다 조회한 값이 아니라 응답을 만들 때 지어낸 값이라, 캐시가
    // 비어 있어도 "캐시됨"이라고 말했고 마지막 갱신 시각 자리에는 방금
    // 시각이 들어갔다 — 캐시 상태를 보러 온 사람이 얻을 것이 아무것도 없는
    // 대신, 뭔가 확인했다는 착각만 얻었다.
    const settings = getSettingsCacheState()

    return NextResponse.json({
      success: true,
      // 이 응답은 **이 요청을 처리한 인스턴스 한 대**의 이야기다. 다른
      // 인스턴스가 무엇을 들고 있는지는 알 수 없다.
      scope: 'this-instance',
      cacheStatus: {
        systemSettings: {
          cached: settings.cached,
          // 캐시가 비어 있으면 null이다 — 시각을 지어내지 않는다.
          cachedAt: settings.cachedAt,
          ttlMs: settings.ttlMs,
        },
        // 미들웨어 캐시(`src/middleware/settings.ts`)는 Edge isolate 안에
        // 있어 이 Node 라우트에서 읽을 수도, 비울 수도 없다. 자기 TTL이
        // 끝나면 스스로 갈아탄다. 상태를 모르므로 모른다고 적는다.
        middleware: {
          invalidatable: false,
          note: '미들웨어 설정 캐시는 Edge isolate별이라 여기서 상태를 읽거나 비울 수 없습니다. 각자의 TTL이 지나면 갈아탑니다.',
        },
      },
      timestamp: new Date().toISOString(),
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
