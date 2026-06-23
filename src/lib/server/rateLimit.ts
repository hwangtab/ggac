import { NextResponse, type NextRequest } from 'next/server'
import {
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  addDistributedRateLimitHeaders,
  createDistributedIPKeyGenerator,
  createDistributedRouteKeyGenerator,
  createDistributedUserKeyGenerator,
  distributedRateLimiter,
  type DistributedRateLimitConfig,
  type RateLimitResult,
} from '@/utils/distributedRateLimiter'

export const RATE_LIMITS = DISTRIBUTED_RATE_LIMIT_CONFIGS
export const RATE_LIMIT_CONFIGS = RATE_LIMITS

export type RateLimitKey = keyof typeof RATE_LIMITS
export type RouteRateLimitConfig = Pick<
  DistributedRateLimitConfig,
  | 'windowMs'
  | 'maxRequests'
  | 'message'
  | 'keyGenerator'
  | 'skipSuccessfulRequests'
  | 'skipFailedRequests'
  | 'blockDuration'
>
export type RateLimitConfig = RouteRateLimitConfig
export type { DistributedRateLimitConfig, RateLimitResult }

export const createUserKeyGenerator = createDistributedUserKeyGenerator
export const createIPKeyGenerator = createDistributedIPKeyGenerator
export const createRouteKeyGenerator = createDistributedRouteKeyGenerator
export const addRateLimitHeaders = addDistributedRateLimitHeaders

export async function applyRateLimit(config: RouteRateLimitConfig) {
  return distributedRateLimiter.applyRateLimit(config)
}

export async function applyRouteRateLimit(
  request: NextRequest,
  config: RouteRateLimitConfig
): Promise<RateLimitResult> {
  const limiter = await applyRateLimit(config)
  return limiter(request)
}

export const withRateLimit = (configKey: RateLimitKey) => {
  return (handler: (request: NextRequest) => Promise<NextResponse>) => {
    return async (request: NextRequest): Promise<NextResponse> => {
      const rateLimitResult = await applyRouteRateLimit(request, RATE_LIMITS[configKey])

      if (!rateLimitResult.success) {
        return (
          rateLimitResult.response ??
          NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 })
        )
      }

      return handler(request)
    }
  }
}

export const rateLimit = async (
  request: NextRequest,
  configKey: RateLimitKey = 'GENERAL_API'
): Promise<RateLimitResult> => {
  return applyRouteRateLimit(request, RATE_LIMITS[configKey])
}

const rateLimitFacade = {
  applyRateLimit,
  applyRouteRateLimit,
  resetRateLimit: (key: string) => distributedRateLimiter.resetRateLimit(key),
  getRateLimitStats: (key: string) => distributedRateLimiter.getRateLimitStats(key),
  CONFIGS: RATE_LIMITS,
  RATE_LIMITS,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  createIPKeyGenerator,
  createRouteKeyGenerator,
  addRateLimitHeaders,
}

export default rateLimitFacade
