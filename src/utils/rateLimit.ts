import { NextRequest, NextResponse } from 'next/server'
import { distributedRateLimiter, DISTRIBUTED_RATE_LIMIT_CONFIGS } from './distributedRateLimiter'

/**
 * Rate Limiting을 적용하는 고차 함수
 *
 * 분산 rate limiter(Upstash Redis 기반)를 통해 적용한다.
 * UPSTASH_REDIS_REST_URL/TOKEN 미설정 시 개발 환경에서만 인메모리 폴백으로 동작한다.
 * 운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리한다.
 */
export const withRateLimit = (configKey: keyof typeof DISTRIBUTED_RATE_LIMIT_CONFIGS) => {
  return (handler: (request: NextRequest) => Promise<NextResponse>) => {
    return async (request: NextRequest): Promise<NextResponse> => {
      const limiter = await distributedRateLimiter.applyRateLimit(
        DISTRIBUTED_RATE_LIMIT_CONFIGS[configKey]
      )
      const rateLimitResult = await limiter(request)

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

/**
 * 직접 rate limiting을 체크하는 함수
 * API 핸들러에서 직접 사용할 수 있음
 */
export const rateLimit = async (
  request: NextRequest,
  configKey: keyof typeof DISTRIBUTED_RATE_LIMIT_CONFIGS = 'GENERAL_API'
) => {
  const limiter = await distributedRateLimiter.applyRateLimit(
    DISTRIBUTED_RATE_LIMIT_CONFIGS[configKey]
  )
  return limiter(request)
}
