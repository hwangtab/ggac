import { NextRequest, NextResponse } from 'next/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from './rateLimiter'

/**
 * Rate Limiting을 적용하는 고차 함수
 * API 핸들러를 래핑하여 rate limiting을 적용
 */
export const withRateLimit = (configKey: keyof typeof RATE_LIMIT_CONFIGS) => {
  return (handler: (request: NextRequest) => Promise<NextResponse>) => {
    return async (request: NextRequest): Promise<NextResponse> => {
      const rateLimiter = applyRateLimit(RATE_LIMIT_CONFIGS[configKey])
      const rateLimitResult = rateLimiter(request)
      
      if (!rateLimitResult.success) {
        return rateLimitResult.response!
      }
      
      return handler(request)
    }
  }
}

/**
 * 직접 rate limiting을 체크하는 함수
 * API 핸들러에서 직접 사용할 수 있음
 */
export const rateLimit = async (request: NextRequest, configKey: keyof typeof RATE_LIMIT_CONFIGS = 'GENERAL_API') => {
  const rateLimiter = applyRateLimit(RATE_LIMIT_CONFIGS[configKey])
  return rateLimiter(request)
}
