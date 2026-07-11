/**
 * 분산 Rate Limiting 시스템
 * Redis/Upstash 기반으로 서버리스 환경 최적화
 *
 * ⚠️ 분산 환경(Vercel 등) 운영 시 반드시 다음 환경변수 쌍 중 하나 설정 필요:
 *   - UPSTASH_REDIS_REST_URL
 *   - UPSTASH_REDIS_REST_TOKEN
 *   - KV_REST_API_URL (Vercel Marketplace Upstash Redis)
 *   - KV_REST_API_TOKEN (Vercel Marketplace Upstash Redis)
 *
 * 환경변수가 없으면 개발 환경에서만 인메모리 폴백으로 동작합니다.
 * 운영 환경에서는 분산 rate limiting이 비활성화된 상태로 요청을 처리하지 않고
 * 명시적으로 실패시켜, 서버리스 인스턴스별 카운터로 보호가 무효화되는 상황을 막습니다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logSecurityEvent } from './security'
import { createLogger } from './logger'
import { parseIntegerParam } from './queryParams'

const log = createLogger('distributedRateLimiter')

function resolveFirstNonEmptyEnv(varNames: string[]): string | undefined {
  for (const varName of varNames) {
    const value = process.env[varName]?.trim()
    if (value) return value
  }

  return undefined
}

// Upstash Redis REST API를 위한 인터페이스
interface UpstashRedisConfig {
  url: string
  token: string
}

// Rate Limit 설정 인터페이스
interface DistributedRateLimitConfig {
  windowMs: number // 시간 윈도우 (밀리초)
  maxRequests: number // 허용되는 최대 요청 수
  keyGenerator?: (req: NextRequest) => string // 키 생성 함수
  skipSuccessfulRequests?: boolean // 성공한 요청 제외 여부
  skipFailedRequests?: boolean // 실패한 요청 제외 여부
  message?: string // 제한 초과 시 메시지
  blockDuration?: number // 차단 지속 시간 (밀리초)
}

// Rate Limit 결과 인터페이스
interface RateLimitResult {
  success: boolean
  response?: NextResponse
  remaining: number
  resetTime: number
  totalHits: number
}

// Upstash Redis 클라이언트
class UpstashRedisClient {
  private config: UpstashRedisConfig

  constructor(config: UpstashRedisConfig) {
    this.config = config
  }

  private async execute(command: string[]): Promise<any> {
    const response = await fetch(`${this.config.url}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      // rate limit 확인은 모든 보호 라우트의 고정 선행 비용이다. Upstash가 행이면
      // 51개 라우트가 함수 타임아웃까지 매달리므로 짧은 상한 후 에러 경로로 넘긴다.
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok) {
      throw new Error(`Redis command failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    return result.result
  }

  async get(key: string): Promise<string | null> {
    return await this.execute(['GET', key])
  }

  async ttl(key: string): Promise<number> {
    return await this.execute(['TTL', key])
  }

  async del(key: string): Promise<number> {
    return await this.execute(['DEL', key])
  }

  // rate limit 검사 전체(차단 확인 → 증가+만료 → 임계 초과 시 자동 차단)를
  // 단일 EVAL로 수행한다. 기존에는 EXISTS + EVAL(+TTL/SETEX)로 요청당 REST
  // 왕복이 2~3회였다(전수감사 API Medium 8 — 전 보호 라우트의 고정 선행 비용).
  async checkAndConsume(
    key: string,
    blockKey: string,
    windowSeconds: number,
    maxRequests: number,
    blockSeconds: number
  ): Promise<{ blocked: boolean; count: number; ttlSeconds: number; autoBlocked: boolean }> {
    const script = `
      local blockTtl = redis.call('TTL', KEYS[2])
      if blockTtl > 0 then
        return {1, 0, blockTtl, 0}
      end
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      local autoBlocked = 0
      if current > tonumber(ARGV[2]) * 2 then
        redis.call('SETEX', KEYS[2], ARGV[3], 'blocked')
        autoBlocked = 1
      end
      return {0, current, ttl, autoBlocked}
    `

    const result = await this.execute([
      'EVAL',
      script,
      '2',
      key,
      blockKey,
      windowSeconds.toString(),
      maxRequests.toString(),
      blockSeconds.toString(),
    ])
    return {
      blocked: result[0] === 1,
      count: result[1],
      ttlSeconds: result[2],
      autoBlocked: result[3] === 1,
    }
  }
}

// 분산 Rate Limiter 클래스
class DistributedRateLimiter {
  private redis: UpstashRedisClient | null = null
  private fallbackToMemory: boolean = false
  private fallbackReported: boolean = false
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map()

  constructor() {
    const upstashUrl = resolveFirstNonEmptyEnv(['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'])
    const upstashToken = resolveFirstNonEmptyEnv(['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'])

    if (upstashUrl && upstashToken) {
      this.redis = new UpstashRedisClient({
        url: upstashUrl,
        token: upstashToken,
      })
    } else {
      this.fallbackToMemory = true
    }
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  }

  private rateLimitUnavailable(windowMs: number, maxRequests: number): RateLimitResult {
    const resetTime = Date.now() + Math.min(windowMs, 60_000)

    return {
      success: false,
      response: NextResponse.json(
        { error: 'Rate limiting is not configured for production.' },
        {
          status: 503,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetTime.toString(),
          },
        }
      ),
      remaining: 0,
      resetTime,
      totalHits: maxRequests,
    }
  }

  private reportMemoryFallbackIfNeeded(): void {
    if (!this.fallbackToMemory || this.fallbackReported) {
      return
    }

    this.fallbackReported = true

    const baseMessage =
      'Upstash Redis 자격 증명이 없어 메모리 기반 폴백으로 동작합니다. ' +
      '서버리스/분산 환경에서는 인스턴스별로 카운터가 분리되어 rate limit이 무효화됩니다. ' +
      'UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 또는 ' +
      'KV_REST_API_URL/KV_REST_API_TOKEN을 설정하세요.'

    if (process.env.NODE_ENV === 'production') {
      log.error(baseMessage)
      try {
        logSecurityEvent('RATE_LIMIT_MEMORY_FALLBACK', { env: 'production' }, 'high')
      } catch {
        // logSecurityEvent 자체 실패는 무시 (로그 채널 의존성 회피)
      }
    } else {
      log.warn(baseMessage)
    }
  }

  // Upstash 미설정/장애 시 메서드별 등급 대응: 읽기(GET/HEAD)는 rate limit이
  // 정작 보호할 upstream보다 가용성이 중요하므로 허용(fail-open)하되 high
  // 보안 로그를 남기고, 쓰기·업로드는 남용 방지를 위해 기존대로 503
  // (fail-closed)을 유지한다 — 기존에는 Upstash 순단 한 번에 보호 라우트
  // 51개가 읽기까지 일제히 503이었다(전수감사 안정성 High 1).
  private degradeByMethod(
    req: NextRequest,
    windowMs: number,
    maxRequests: number,
    reason: 'unconfigured' | 'redis_error'
  ): RateLimitResult {
    const method = req.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
      logSecurityEvent('RATE_LIMIT_DEGRADED_FAIL_OPEN', { url: req.url, method, reason }, 'high')
      return {
        success: true,
        remaining: maxRequests,
        resetTime: Date.now() + windowMs,
        totalHits: 0,
      }
    }
    return this.rateLimitUnavailable(windowMs, maxRequests)
  }

  // 기본 키 생성 함수 (IP 주소 기반)
  private defaultKeyGenerator = (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown'
    return `rate_limit:${ip}`
  }

  // 메모리 기반 폴백 구현
  private async fallbackMemoryLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now()
    const existing = this.memoryStore.get(key)

    if (!existing || now > existing.resetTime) {
      const resetTime = now + windowMs
      const newEntry = { count: 1, resetTime }
      this.memoryStore.set(key, newEntry)
      return newEntry
    }

    existing.count++
    return existing
  }

  // 참고: 구 redisRateLimit(+incrWithExpiry/setex/exists/incr/expire)은 제거됐다.
  // Redis 경로는 applyRateLimit에서 checkAndConsume(단일 Lua)로 일원화됐고, 구
  // 경로는 호출자가 없는 죽은 코드이면서 blockKey 차단 확인이 없어 부활 시
  // 차단·자동차단이 무력화되는 함정이었다(코드리뷰 CONFIRMED).

  // Rate Limit 적용 함수
  async applyRateLimit(config: DistributedRateLimitConfig) {
    const {
      windowMs,
      maxRequests,
      keyGenerator = this.defaultKeyGenerator,
      message = 'Too many requests, please try again later.',
      blockDuration = 10 * 60 * 1000, // 10분
    } = config

    return async (req: NextRequest): Promise<RateLimitResult> => {
      this.reportMemoryFallbackIfNeeded()

      if (this.isProduction() && (this.fallbackToMemory || !this.redis)) {
        return this.degradeByMethod(req, windowMs, maxRequests, 'unconfigured')
      }

      const baseKey = keyGenerator(req)
      const blockKey = `${baseKey}:blocked`

      try {
        // Redis 경로: 차단 확인→증가→자동 차단을 단일 Lua 1왕복으로 수행
        if (this.redis && !this.fallbackToMemory) {
          const windowSeconds = Math.ceil(windowMs / 1000)
          const blockSeconds = Math.ceil(blockDuration / 1000)
          const check = await this.redis.checkAndConsume(
            baseKey,
            blockKey,
            windowSeconds,
            maxRequests,
            blockSeconds
          )

          if (check.blocked) {
            const ttl = check.ttlSeconds * 1000
            logSecurityEvent(
              'RATE_LIMIT_BLOCKED_ACCESS',
              { key: baseKey, url: req.url, remainingBlockTime: ttl },
              'medium'
            )

            return {
              success: false,
              response: NextResponse.json(
                { error: 'Access temporarily blocked due to suspicious activity' },
                {
                  status: 429,
                  headers: {
                    'Retry-After': Math.ceil(ttl / 1000).toString(),
                    'X-RateLimit-Limit': maxRequests.toString(),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': (Date.now() + ttl).toString(),
                  },
                }
              ),
              remaining: 0,
              resetTime: Date.now() + ttl,
              totalHits: maxRequests + 1,
            }
          }

          if (check.autoBlocked) {
            logSecurityEvent('RATE_LIMIT_AUTO_BLOCK', { key: baseKey, url: req.url }, 'high')
          }

          const resetTime = Date.now() + Math.max(0, check.ttlSeconds) * 1000
          const remaining = Math.max(0, maxRequests - check.count)
          const success = check.count <= maxRequests

          if (!success) {
            logSecurityEvent(
              'RATE_LIMIT_EXCEEDED',
              { key: baseKey, count: check.count, maxRequests, url: req.url },
              'medium'
            )

            return {
              success: false,
              response: NextResponse.json(
                { error: message },
                {
                  status: 429,
                  headers: {
                    'Retry-After': Math.ceil((resetTime - Date.now()) / 1000).toString(),
                    'X-RateLimit-Limit': maxRequests.toString(),
                    'X-RateLimit-Remaining': remaining.toString(),
                    'X-RateLimit-Reset': resetTime.toString(),
                  },
                }
              ),
              remaining,
              resetTime,
              totalHits: check.count,
            }
          }

          return { success: true, remaining, resetTime, totalHits: check.count }
        }

        // 메모리 폴백 경로 (개발/미설정 환경)
        const isBlocked = this.memoryStore.has(blockKey)

        if (isBlocked) {
          const ttl = Math.max(0, (this.memoryStore.get(blockKey)?.resetTime || 0) - Date.now())

          logSecurityEvent(
            'RATE_LIMIT_BLOCKED_ACCESS',
            {
              key: baseKey,
              url: req.url,
              remainingBlockTime: ttl,
            },
            'medium'
          )

          return {
            success: false,
            response: NextResponse.json(
              { error: 'Access temporarily blocked due to suspicious activity' },
              {
                status: 429,
                headers: {
                  'Retry-After': Math.ceil(ttl / 1000).toString(),
                  'X-RateLimit-Limit': maxRequests.toString(),
                  'X-RateLimit-Remaining': '0',
                  'X-RateLimit-Reset': (Date.now() + ttl).toString(),
                },
              }
            ),
            remaining: 0,
            resetTime: Date.now() + ttl,
            totalHits: maxRequests + 1,
          }
        }

        {
          const result = await this.fallbackMemoryLimit(baseKey, windowMs, maxRequests)
          const remaining = Math.max(0, maxRequests - result.count)
          const success = result.count <= maxRequests

          // 과도한 요청 시 차단
          if (result.count > maxRequests * 2) {
            const blockResetTime = Date.now() + blockDuration
            this.memoryStore.set(blockKey, { count: 1, resetTime: blockResetTime })

            logSecurityEvent('RATE_LIMIT_AUTO_BLOCK', { key: baseKey, url: req.url }, 'high')
          }

          if (!success) {
            logSecurityEvent(
              'RATE_LIMIT_EXCEEDED',
              {
                key: baseKey,
                count: result.count,
                maxRequests,
                url: req.url,
              },
              'medium'
            )

            return {
              success: false,
              response: NextResponse.json(
                { error: message },
                {
                  status: 429,
                  headers: {
                    'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
                    'X-RateLimit-Limit': maxRequests.toString(),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': result.resetTime.toString(),
                  },
                }
              ),
              remaining,
              resetTime: result.resetTime,
              totalHits: result.count,
            }
          }

          return {
            success: true,
            remaining,
            resetTime: result.resetTime,
            totalHits: result.count,
          }
        }
      } catch (error) {
        log.error('Distributed rate limiting error', error)

        if (this.isProduction()) {
          return this.degradeByMethod(req, windowMs, maxRequests, 'redis_error')
        }

        // 에러 발생 시 허용 (fail-open)
        return {
          success: true,
          remaining: maxRequests,
          resetTime: Date.now() + windowMs,
          totalHits: 0,
        }
      }
    }
  }

  // 특정 키의 Rate Limit 초기화
  async resetRateLimit(key: string): Promise<void> {
    try {
      if (this.fallbackToMemory || !this.redis) {
        this.memoryStore.delete(key)
        this.memoryStore.delete(`${key}:blocked`)
      } else {
        await this.redis.del(key)
        await this.redis.del(`${key}:blocked`)
      }
    } catch (error) {
      log.error('Failed to reset rate limit', error)
    }
  }

  // Rate Limit 통계 조회
  async getRateLimitStats(key: string): Promise<{ count: number; ttl: number } | null> {
    try {
      if (this.fallbackToMemory || !this.redis) {
        const entry = this.memoryStore.get(key)
        if (!entry) return null

        return {
          count: entry.count,
          ttl: Math.max(0, entry.resetTime - Date.now()),
        }
      } else {
        const count = await this.redis.get(key)
        const ttl = await this.redis.ttl(key)

        if (count === null) return null

        return {
          count: parseIntegerParam(count, 0, { min: 0 }),
          ttl: ttl * 1000,
        }
      }
    } catch (error) {
      log.error('Failed to get rate limit stats', error)
      return null
    }
  }
}

// 전역 분산 Rate Limiter 인스턴스
const distributedRateLimiter = new DistributedRateLimiter()

// 사전 정의된 분산 Rate Limit 설정들
export const DISTRIBUTED_RATE_LIMIT_CONFIGS = {
  // 일반 API 요청 (분당 60회)
  GENERAL_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 60,
    message: '잠시 후 다시 시도해주세요.',
  },

  // 인증 API (분당 10회)
  AUTH_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 10,
    message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    blockDuration: 15 * 60 * 1000, // 15분 차단
  },

  // 게시글 작성 (분당 5회)
  POST_CREATION: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 5,
    message: '게시글 작성이 너무 빠릅니다. 잠시 후 다시 시도해주세요.',
  },

  // 검색 API (분당 30회)
  SEARCH_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 30,
    message: '검색 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  },

  // 파일 업로드 (시간당 10회)
  FILE_UPLOAD: {
    windowMs: 60 * 60 * 1000, // 1시간
    maxRequests: 10,
    message: '파일 업로드 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  },

  // 관리자 API (분당 100회)
  ADMIN_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 100,
    message: '관리자 API 요청이 너무 많습니다.',
  },

  // 대량 작업 (시간당 5회)
  BULK_OPERATIONS: {
    windowMs: 60 * 60 * 1000, // 1시간
    maxRequests: 5,
    message: '대량 작업 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  },
} as const

// 키 생성 함수들
export const createDistributedUserKeyGenerator = (prefix: string = 'user') => {
  return (req: NextRequest): string => {
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      return `rate_limit:${prefix}:${token.substring(0, 16)}`
    }

    const forwarded = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown'
    return `rate_limit:${prefix}:${ip}`
  }
}

export const createDistributedIPKeyGenerator = (prefix: string = 'ip') => {
  return (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown'
    return `rate_limit:${prefix}:${ip}`
  }
}

export const createDistributedRouteKeyGenerator = (prefix: string = 'route') => {
  return (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown'
    const pathname = new URL(req.url).pathname
    return `rate_limit:${prefix}:${ip}:${pathname.replace(/\//g, ':')}`
  }
}

// Rate Limit 헤더 추가 함수
export const addDistributedRateLimitHeaders = (
  response: NextResponse,
  limit: number,
  remaining: number,
  resetTime: number
): NextResponse => {
  response.headers.set('X-RateLimit-Limit', limit.toString())
  response.headers.set('X-RateLimit-Remaining', remaining.toString())
  response.headers.set('X-RateLimit-Reset', resetTime.toString())

  if (remaining === 0) {
    response.headers.set('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString())
  }

  return response
}

// 메인 export
export {
  distributedRateLimiter,
  DistributedRateLimiter,
  type DistributedRateLimitConfig,
  type RateLimitResult,
  UpstashRedisClient,
}

const distributedRateLimiterConfig = {
  applyRateLimit: (config: DistributedRateLimitConfig) =>
    distributedRateLimiter.applyRateLimit(config),
  resetRateLimit: (key: string) => distributedRateLimiter.resetRateLimit(key),
  getRateLimitStats: (key: string) => distributedRateLimiter.getRateLimitStats(key),
  CONFIGS: DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createUserKeyGenerator: createDistributedUserKeyGenerator,
  createIPKeyGenerator: createDistributedIPKeyGenerator,
  createRouteKeyGenerator: createDistributedRouteKeyGenerator,
  addRateLimitHeaders: addDistributedRateLimitHeaders,
}

export default distributedRateLimiterConfig
