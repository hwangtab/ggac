/**
 * Rate Limiting 호환 레이어
 *
 * 새 서버 코드의 공식 진입점은 @/lib/server/rateLimit 입니다.
 * 운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리한다.
 */

export { rateLimit, withRateLimit, type RateLimitKey } from '@/lib/server/rateLimit'
