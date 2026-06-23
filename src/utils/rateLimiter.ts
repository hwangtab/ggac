/**
 * API Rate Limiting 호환 레이어
 *
 * 새 서버 코드의 공식 진입점은 @/lib/server/rateLimit 입니다.
 * 이 파일은 기존 import 경로를 보존하기 위한 얇은 re-export입니다.
 *
 * 분산 Rate Limiting 시스템(Upstash Redis 기반)을 사용합니다.
 * UPSTASH_REDIS_REST_URL/TOKEN 미설정 시 개발 환경에서만 인메모리 폴백으로 동작합니다.
 * 운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리합니다.
 */

export {
  RATE_LIMIT_CONFIGS,
  addRateLimitHeaders,
  applyRateLimit,
  createIPKeyGenerator,
  createRouteKeyGenerator,
  createUserKeyGenerator,
  type RateLimitConfig,
} from '@/lib/server/rateLimit'
export { default } from '@/lib/server/rateLimit'
