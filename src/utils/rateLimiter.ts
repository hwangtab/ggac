/**
 * API Rate Limiting 유틸리티
 *
 * ⚠️ distributedRateLimiter.ts로 위임
 *
 * 분산 Rate Limiting 시스템(Upstash Redis 기반)을 사용합니다.
 * UPSTASH_REDIS_REST_URL/TOKEN 미설정 시 개발 환경에서만 인메모리 폴백으로 동작합니다.
 * 운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리합니다.
 */

import distributedRateLimiterConfig, {
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  type DistributedRateLimitConfig,
} from './distributedRateLimiter'

// RATE_LIMIT_CONFIGS는 DISTRIBUTED_RATE_LIMIT_CONFIGS와 동일 구조
export const RATE_LIMIT_CONFIGS = DISTRIBUTED_RATE_LIMIT_CONFIGS

// DistributedRateLimitConfig에서 필요한 부분만 추출 (기존 API 호환성)
type RateLimitConfig = Pick<
  DistributedRateLimitConfig,
  | 'windowMs'
  | 'maxRequests'
  | 'message'
  | 'keyGenerator'
  | 'skipSuccessfulRequests'
  | 'skipFailedRequests'
  | 'blockDuration'
>

// applyRateLimit: async 함수로 distributedRateLimiter에 위임
export const applyRateLimit = async (config: RateLimitConfig) => {
  return distributedRateLimiterConfig.applyRateLimit(config)
}

// 기존 API 호환성 re-export
export {
  createDistributedUserKeyGenerator as createUserKeyGenerator,
  createDistributedIPKeyGenerator as createIPKeyGenerator,
  createDistributedRouteKeyGenerator as createRouteKeyGenerator,
  addDistributedRateLimitHeaders as addRateLimitHeaders,
} from './distributedRateLimiter'

// Default export (기존 코드와의 호환성)
const rateLimiterConfig = {
  applyRateLimit: distributedRateLimiterConfig.applyRateLimit,
  RATE_LIMIT_CONFIGS,
}

export default rateLimiterConfig
