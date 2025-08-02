/**
 * 분산 Rate Limiting 시스템
 * Redis/Upstash 기반으로 서버리스 환경 최적화
 */

import { NextRequest, NextResponse } from 'next/server';
import { logSecurityEvent } from './security';

// Upstash Redis REST API를 위한 인터페이스
interface UpstashRedisConfig {
  url: string;
  token: string;
}

// Rate Limit 설정 인터페이스
interface DistributedRateLimitConfig {
  windowMs: number;        // 시간 윈도우 (밀리초)
  maxRequests: number;     // 허용되는 최대 요청 수
  keyGenerator?: (req: NextRequest) => string;  // 키 생성 함수
  skipSuccessfulRequests?: boolean;  // 성공한 요청 제외 여부
  skipFailedRequests?: boolean;      // 실패한 요청 제외 여부
  message?: string;        // 제한 초과 시 메시지
  blockDuration?: number;  // 차단 지속 시간 (밀리초)
}

// Rate Limit 결과 인터페이스
interface RateLimitResult {
  success: boolean;
  response?: NextResponse;
  remaining: number;
  resetTime: number;
  totalHits: number;
}

// Upstash Redis 클라이언트
class UpstashRedisClient {
  private config: UpstashRedisConfig;

  constructor(config: UpstashRedisConfig) {
    this.config = config;
  }

  private async execute(command: string[]): Promise<any> {
    const response = await fetch(`${this.config.url}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis command failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result.result;
  }

  async get(key: string): Promise<string | null> {
    return await this.execute(['GET', key]);
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    return await this.execute(['SETEX', key, seconds.toString(), value]);
  }

  async incr(key: string): Promise<number> {
    return await this.execute(['INCR', key]);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.execute(['EXPIRE', key, seconds.toString()]);
  }

  async ttl(key: string): Promise<number> {
    return await this.execute(['TTL', key]);
  }

  async del(key: string): Promise<number> {
    return await this.execute(['DEL', key]);
  }

  async exists(key: string): Promise<number> {
    return await this.execute(['EXISTS', key]);
  }

  // 복합 명령어 - 원자적 증가 및 만료 시간 설정
  async incrWithExpiry(key: string, windowSeconds: number): Promise<{ value: number; ttl: number }> {
    // MULTI 트랜잭션으로 원자적 실행
    const script = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      return {current, ttl}
    `;
    
    const result = await this.execute(['EVAL', script, '1', key, windowSeconds.toString()]);
    return { value: result[0], ttl: result[1] };
  }
}

// 분산 Rate Limiter 클래스
class DistributedRateLimiter {
  private redis: UpstashRedisClient | null = null;
  private fallbackToMemory: boolean = false;
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map();

  constructor() {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl && upstashToken) {
      this.redis = new UpstashRedisClient({
        url: upstashUrl,
        token: upstashToken
      });
    } else {
      console.warn('Upstash Redis credentials not found, falling back to memory store');
      this.fallbackToMemory = true;
    }
  }

  // 기본 키 생성 함수 (IP 주소 기반)
  private defaultKeyGenerator = (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
    return `rate_limit:${ip}`;
  };

  // 메모리 기반 폴백 구현
  private async fallbackMemoryLimit(
    key: string, 
    windowMs: number, 
    maxRequests: number
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    if (!existing || now > existing.resetTime) {
      const resetTime = now + windowMs;
      const newEntry = { count: 1, resetTime };
      this.memoryStore.set(key, newEntry);
      return newEntry;
    }

    existing.count++;
    return existing;
  }

  // Redis 기반 Rate Limiting
  private async redisRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    if (!this.redis) {
      // Redis가 없으면 메모리 폴백으로 처리
      const result = await this.fallbackMemoryLimit(key, windowMs, maxRequests);
      const remaining = Math.max(0, maxRequests - result.count);
      
      return {
        success: result.count <= maxRequests,
        remaining,
        resetTime: result.resetTime,
        totalHits: result.count
      };
    }

    try {
      const windowSeconds = Math.ceil(windowMs / 1000);
      const { value: currentCount, ttl } = await this.redis.incrWithExpiry(key, windowSeconds);
      
      const resetTime = Date.now() + (ttl * 1000);
      const remaining = Math.max(0, maxRequests - currentCount);
      
      return {
        success: currentCount <= maxRequests,
        remaining,
        resetTime,
        totalHits: currentCount
      };
    } catch (error) {
      console.error('Redis rate limiting failed, falling back to memory:', error);
      
      // Redis 실패 시 메모리 폴백
      const result = await this.fallbackMemoryLimit(key, windowMs, maxRequests);
      const remaining = Math.max(0, maxRequests - result.count);
      
      return {
        success: result.count <= maxRequests,
        remaining,
        resetTime: result.resetTime,
        totalHits: result.count
      };
    }
  }

  // Rate Limit 적용 함수
  async applyRateLimit(config: DistributedRateLimitConfig) {
    const {
      windowMs,
      maxRequests,
      keyGenerator = this.defaultKeyGenerator,
      message = 'Too many requests, please try again later.',
      blockDuration = 10 * 60 * 1000 // 10분
    } = config;

    return async (req: NextRequest): Promise<RateLimitResult> => {
      const baseKey = keyGenerator(req);
      const blockKey = `${baseKey}:blocked`;
      
      try {
        // 차단 상태 확인
        const isBlocked = this.fallbackToMemory || !this.redis
          ? this.memoryStore.has(blockKey)
          : await this.redis.exists(blockKey);

        if (isBlocked) {
          const ttl = this.fallbackToMemory || !this.redis
            ? Math.max(0, (this.memoryStore.get(blockKey)?.resetTime || 0) - Date.now())
            : (await this.redis.ttl(blockKey)) * 1000;

          logSecurityEvent('RATE_LIMIT_BLOCKED_ACCESS', { 
            key: baseKey, 
            url: req.url,
            remainingBlockTime: ttl 
          }, 'medium');

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
                  'X-RateLimit-Reset': (Date.now() + ttl).toString()
                }
              }
            ),
            remaining: 0,
            resetTime: Date.now() + ttl,
            totalHits: maxRequests + 1
          };
        }

        // Rate limiting 실행
        if (this.fallbackToMemory || !this.redis) {
          const result = await this.fallbackMemoryLimit(baseKey, windowMs, maxRequests);
          const remaining = Math.max(0, maxRequests - result.count);
          const success = result.count <= maxRequests;
          
          // 과도한 요청 시 차단
          if (result.count > maxRequests * 2) {
            const blockResetTime = Date.now() + blockDuration;
            this.memoryStore.set(blockKey, { count: 1, resetTime: blockResetTime });
            
            logSecurityEvent('RATE_LIMIT_AUTO_BLOCK', { key: baseKey, url: req.url }, 'high');
          }

          if (!success) {
            logSecurityEvent('RATE_LIMIT_EXCEEDED', { 
              key: baseKey, 
              count: result.count, 
              maxRequests,
              url: req.url 
            }, 'medium');

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
                    'X-RateLimit-Reset': result.resetTime.toString()
                  }
                }
              ),
              remaining,
              resetTime: result.resetTime,
              totalHits: result.count
            };
          }

          return {
            success: true,
            remaining,
            resetTime: result.resetTime,
            totalHits: result.count
          };
        } else {
          // Redis 기반 결과 처리
          const result = await this.redisRateLimit(baseKey, windowMs, maxRequests);
          
          if (!('success' in result)) {
            throw new Error('Invalid result from Redis rate limiter');
          }

          if (result.totalHits > maxRequests * 2) {
            const blockSeconds = Math.ceil(blockDuration / 1000);
            if (this.redis) {
              await this.redis.setex(blockKey, blockSeconds, 'blocked');
            }
            
            logSecurityEvent('RATE_LIMIT_AUTO_BLOCK', { key: baseKey, url: req.url }, 'high');
          }

          if (!result.success) {
            logSecurityEvent('RATE_LIMIT_EXCEEDED', { 
              key: baseKey, 
              count: result.totalHits, 
              maxRequests,
              url: req.url 
            }, 'medium');

            return {
              ...result,
              response: NextResponse.json(
                { error: message },
                { 
                  status: 429,
                  headers: {
                    'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
                    'X-RateLimit-Limit': maxRequests.toString(),
                    'X-RateLimit-Remaining': result.remaining.toString(),
                    'X-RateLimit-Reset': result.resetTime.toString()
                  }
                }
              )
            };
          }

          return result;
        }
      } catch (error) {
        console.error('Distributed rate limiting error:', error);
        
        // 에러 발생 시 허용 (fail-open)
        return {
          success: true,
          remaining: maxRequests,
          resetTime: Date.now() + windowMs,
          totalHits: 0
        };
      }
    };
  }

  // 특정 키의 Rate Limit 초기화
  async resetRateLimit(key: string): Promise<void> {
    try {
      if (this.fallbackToMemory || !this.redis) {
        this.memoryStore.delete(key);
        this.memoryStore.delete(`${key}:blocked`);
      } else {
        await this.redis.del(key);
        await this.redis.del(`${key}:blocked`);
      }
    } catch (error) {
      console.error('Failed to reset rate limit:', error);
    }
  }

  // Rate Limit 통계 조회
  async getRateLimitStats(key: string): Promise<{ count: number; ttl: number } | null> {
    try {
      if (this.fallbackToMemory || !this.redis) {
        const entry = this.memoryStore.get(key);
        if (!entry) return null;
        
        return {
          count: entry.count,
          ttl: Math.max(0, entry.resetTime - Date.now())
        };
      } else {
        const count = await this.redis.get(key);
        const ttl = await this.redis.ttl(key);
        
        if (count === null) return null;
        
        return {
          count: parseInt(count),
          ttl: ttl * 1000
        };
      }
    } catch (error) {
      console.error('Failed to get rate limit stats:', error);
      return null;
    }
  }
}

// 전역 분산 Rate Limiter 인스턴스
const distributedRateLimiter = new DistributedRateLimiter();

// 사전 정의된 분산 Rate Limit 설정들
export const DISTRIBUTED_RATE_LIMIT_CONFIGS = {
  // 일반 API 요청 (분당 60회)
  GENERAL_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 60,
    message: '잠시 후 다시 시도해주세요.'
  },

  // 인증 API (분당 10회)
  AUTH_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 10,
    message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    blockDuration: 15 * 60 * 1000 // 15분 차단
  },

  // 게시글 작성 (분당 5회)
  POST_CREATION: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 5,
    message: '게시글 작성이 너무 빠릅니다. 잠시 후 다시 시도해주세요.'
  },

  // 검색 API (분당 30회)
  SEARCH_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 30,
    message: '검색 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
  },

  // 파일 업로드 (시간당 10회)
  FILE_UPLOAD: {
    windowMs: 60 * 60 * 1000, // 1시간
    maxRequests: 10,
    message: '파일 업로드 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
  },

  // 관리자 API (분당 100회)
  ADMIN_API: {
    windowMs: 60 * 1000, // 1분
    maxRequests: 100,
    message: '관리자 API 요청이 너무 많습니다.'
  },

  // 대량 작업 (시간당 5회)
  BULK_OPERATIONS: {
    windowMs: 60 * 60 * 1000, // 1시간
    maxRequests: 5,
    message: '대량 작업 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
  }
} as const;

// 키 생성 함수들
export const createDistributedUserKeyGenerator = (prefix: string = 'user') => {
  return (req: NextRequest): string => {
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      return `rate_limit:${prefix}:${token.substring(0, 16)}`;
    }
    
    const forwarded = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
    return `rate_limit:${prefix}:${ip}`;
  };
};

export const createDistributedIPKeyGenerator = (prefix: string = 'ip') => {
  return (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
    return `rate_limit:${prefix}:${ip}`;
  };
};

export const createDistributedRouteKeyGenerator = (prefix: string = 'route') => {
  return (req: NextRequest): string => {
    const forwarded = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
    const pathname = new URL(req.url).pathname;
    return `rate_limit:${prefix}:${ip}:${pathname.replace(/\//g, ':')}`;
  };
};

// Rate Limit 헤더 추가 함수
export const addDistributedRateLimitHeaders = (
  response: NextResponse, 
  limit: number, 
  remaining: number, 
  resetTime: number
): NextResponse => {
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', resetTime.toString());
  
  if (remaining === 0) {
    response.headers.set('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString());
  }
  
  return response;
};

// 메인 export
export {
  distributedRateLimiter,
  DistributedRateLimiter,
  type DistributedRateLimitConfig,
  type RateLimitResult,
  UpstashRedisClient
};

const distributedRateLimiterConfig = {
  applyRateLimit: (config: DistributedRateLimitConfig) => distributedRateLimiter.applyRateLimit(config),
  resetRateLimit: (key: string) => distributedRateLimiter.resetRateLimit(key),
  getRateLimitStats: (key: string) => distributedRateLimiter.getRateLimitStats(key),
  CONFIGS: DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createUserKeyGenerator: createDistributedUserKeyGenerator,
  createIPKeyGenerator: createDistributedIPKeyGenerator,
  createRouteKeyGenerator: createDistributedRouteKeyGenerator,
  addRateLimitHeaders: addDistributedRateLimitHeaders
};

export default distributedRateLimiterConfig;