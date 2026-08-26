import { NextResponse, type NextRequest } from 'next/server'
import {
  RATE_LIMITS,
  applyRouteRateLimit,
  type RateLimitResult,
  type RouteRateLimitConfig,
} from '@/lib/server/rateLimit'
import { requireAdmin, type AdminAuthSuccess } from '@/lib/server/adminAuth'
import { createLogger } from '@/utils/logger'

const log = createLogger('streamRoute')

/** `apiRoute.ts`의 `ApiRouteAuthMode`와 같은 이유로 `'public'`을 명시값으로 둔다. */
type StreamRouteAuthMode = 'admin' | 'public'
type StreamRouteAuthResult = AdminAuthSuccess | undefined
type StreamRouteAuthResolver<TAuth> = (ctx: {
  request: NextRequest
}) => Promise<TAuth | NextResponse>

export type StreamRouteContext<TAuth> = {
  request: NextRequest
  auth: TAuth
  rateLimit?: RateLimitResult
}

export type DefineStreamRouteConfig<TAuth> = {
  method: 'GET'
  name: string
  rateLimit?: RouteRateLimitConfig
  /** 필수다 — 게이트가 없는 스트림도 `'public'`으로 그 사실을 적어야 한다. */
  auth: StreamRouteAuthMode | StreamRouteAuthResolver<TAuth>
  errorResponse?: (error: unknown) => Response
  handler: (ctx: StreamRouteContext<TAuth>) => Promise<Response> | Response
}

async function resolveStreamAuth<TAuth>(
  auth: DefineStreamRouteConfig<TAuth>['auth'],
  request: NextRequest
): Promise<TAuth | StreamRouteAuthResult | NextResponse> {
  if (typeof auth === 'function') {
    return auth({ request })
  }

  if (auth === 'admin') {
    return requireAdmin()
  }

  if (auth === 'public') {
    return undefined
  }

  // 타입을 우회한 누락·오타는 열지 않고 막는다(apiRoute.ts와 같은 이유).
  throw new Error('스트림 라우트 인가 설정이 올바르지 않습니다.')
}

export function defineStreamRoute<TAuth = StreamRouteAuthResult>(
  config: DefineStreamRouteConfig<TAuth>
) {
  return async (request: NextRequest): Promise<Response> => {
    let rateLimitResult: RateLimitResult | undefined

    try {
      if (config.rateLimit) {
        rateLimitResult = await applyRouteRateLimit(request, config.rateLimit)

        if (!rateLimitResult.success) {
          return (
            rateLimitResult.response ??
            NextResponse.json({ error: config.rateLimit.message }, { status: 429 })
          )
        }
      }

      const auth = await resolveStreamAuth(config.auth, request)
      if (auth instanceof NextResponse) {
        return auth
      }

      return await config.handler({
        request,
        auth: auth as TAuth,
        rateLimit: rateLimitResult,
      })
    } catch (error) {
      log.error('Stream route failed', {
        name: config.name,
        method: config.method,
        error,
      })

      return (
        config.errorResponse?.(error) ??
        NextResponse.json({ error: '스트림을 시작할 수 없습니다.' }, { status: 500 })
      )
    }
  }
}

export { RATE_LIMITS }
