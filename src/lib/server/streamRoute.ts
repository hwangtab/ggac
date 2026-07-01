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

type StreamRouteAuthMode = 'admin'
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
  auth?: StreamRouteAuthMode | StreamRouteAuthResolver<TAuth>
  errorResponse?: (error: unknown) => Response
  handler: (ctx: StreamRouteContext<TAuth>) => Promise<Response> | Response
}

async function resolveStreamAuth<TAuth>(
  auth: DefineStreamRouteConfig<TAuth>['auth'],
  request: NextRequest
): Promise<TAuth | StreamRouteAuthResult | NextResponse> {
  if (!auth) return undefined

  if (typeof auth === 'function') {
    return auth({ request })
  }

  return requireAdmin()
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
