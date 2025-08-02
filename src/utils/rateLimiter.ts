/**
 * API Rate Limiting 유틸리티
 * 무분별한 API 호출을 방지하고 서비스 안정성을 보장
 */

import { NextRequest, NextResponse } from 'next/server';
import { logSecurityEvent } from './security';

// Rate Limit 설정 인터페이스
interface RateLimitConfig {
  windowMs: number;        // 시간 윈도우 (밀리초)
  maxRequests: number;     // 허용되는 최대 요청 수
  keyGenerator?: (req: NextRequest) => string;  // 키 생성 함수
  skipSuccessfulRequests?: boolean;  // 성공한 요청 제외 여부
  skipFailedRequests?: boolean;      // 실패한 요청 제외 여부
  message?: string;        // 제한 초과 시 메시지
}

// Rate Limit 저장소 인터페이스
interface RateLimitStore {
  count: number;
  resetTime: number;
  blocked: boolean;
}

// 메모리 기반 Rate Limit 저장소
class MemoryRateLimitStore {
  private store: Map<string, RateLimitStore> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // 5분마다 만료된 항목 정리
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.store.entries());
    for (const [key, value] of entries) {
      if (now > value.resetTime) {
        this.store.delete(key);
      }
    }
  }

  get(key: string): RateLimitStore | undefined {
    return this.store.get(key);
  }

  set(key: string, value: RateLimitStore): void {
    this.store.set(key, value);
  }

  increment(key: string, windowMs: number): RateLimitStore {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now > existing.resetTime) {
      const newStore: RateLimitStore = {
        count: 1,
        resetTime: now + windowMs,
        blocked: false
      };
      this.store.set(key, newStore);
      return newStore;
    }

    existing.count++;
    return existing;
  }

  block(key: string, duration: number): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.blocked = true;
      existing.resetTime = Date.now() + duration;
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// 전역 Rate Limit 저장소
const globalStore = new MemoryRateLimitStore();

// 기본 키 생성 함수 (IP 주소 기반)
const defaultKeyGenerator = (req: NextRequest): string => {
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
  return ip;
};

// Rate Limit 적용 함수
export const applyRateLimit = (config: RateLimitConfig) => {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    message = 'Too many requests, please try again later.'
  } = config;

  return (req: NextRequest): { 
    success: boolean; 
    response?: NextResponse; 
    remaining: number;
    resetTime: number;
  } => {
    const key = keyGenerator(req);
    const store = globalStore.increment(key, windowMs);

    // 차단된 키 확인
    if (store.blocked) {
      logSecurityEvent('RATE_LIMIT_BLOCKED_ACCESS', { key, url: req.url }, 'medium');
      return {
        success: false,
        response: NextResponse.json(
          { error: 'Access temporarily blocked due to suspicious activity' },
          { 
            status: 429,
            headers: {
              'Retry-After': Math.ceil((store.resetTime - Date.now()) / 1000).toString(),
              'X-RateLimit-Limit': maxRequests.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': store.resetTime.toString()
            }
          }
        ),
        remaining: 0,
        resetTime: store.resetTime
      };
    }

    const remaining = Math.max(0, maxRequests - store.count);
    
    // Rate Limit 초과 시
    if (store.count > maxRequests) {
      logSecurityEvent('RATE_LIMIT_EXCEEDED', { 
        key, 
        count: store.count, 
        maxRequests,
        url: req.url 
      }, 'medium');

      // 과도한 요청 시 일시적으로 차단
      if (store.count > maxRequests * 2) {
        globalStore.block(key, 10 * 60 * 1000); // 10분 차단
        logSecurityEvent('RATE_LIMIT_AUTO_BLOCK', { key, url: req.url }, 'high');
      }

      return {
        success: false,
        response: NextResponse.json(
          { error: message },
          { 
            status: 429,
            headers: {
              'Retry-After': Math.ceil((store.resetTime - Date.now()) / 1000).toString(),
              'X-RateLimit-Limit': maxRequests.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': store.resetTime.toString()
            }
          }
        ),
        remaining,
        resetTime: store.resetTime
      };
    }

    return {
      success: true,
      remaining,
      resetTime: store.resetTime
    };
  };
};

// 사전 정의된 Rate Limit 설정들
export const RATE_LIMIT_CONFIGS = {
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
    message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'
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

// 사용자 기반 Rate Limit 키 생성
export const createUserKeyGenerator = (prefix: string = 'user') => {
  return (req: NextRequest): string => {
    // Authorization 헤더에서 사용자 ID 추출 (실제 구현에서는 JWT 토큰 파싱)
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      // 간단한 구현 - 실제로는 JWT 토큰을 파싱해야 함
      const token = authHeader.replace('Bearer ', '');
      return `${prefix}:${token}`;
    }
    
    // 인증되지 않은 사용자는 IP 기반
    return `${prefix}:${defaultKeyGenerator(req)}`;
  };
};

// IP 기반 Rate Limit 키 생성
export const createIPKeyGenerator = (prefix: string = 'ip') => {
  return (req: NextRequest): string => {
    const ip = defaultKeyGenerator(req);
    return `${prefix}:${ip}`;
  };
};

// 라우트 기반 Rate Limit 키 생성
export const createRouteKeyGenerator = (prefix: string = 'route') => {
  return (req: NextRequest): string => {
    const ip = defaultKeyGenerator(req);
    const pathname = new URL(req.url).pathname;
    return `${prefix}:${ip}:${pathname}`;
  };
};

// Rate Limit 미들웨어 생성기
export const createRateLimitMiddleware = (config: RateLimitConfig) => {
  const rateLimiter = applyRateLimit(config);
  
  return (req: NextRequest) => {
    const result = rateLimiter(req);
    
    if (!result.success && result.response) {
      return result.response;
    }
    
    return null; // 통과
  };
};

// 동적 Rate Limit 설정 (사용자 권한 기반)
export const createDynamicRateLimit = (req: NextRequest) => {
  const userAgent = req.headers.get('user-agent') || '';
  const isBot = /bot|crawler|spider/i.test(userAgent);
  
  if (isBot) {
    return RATE_LIMIT_CONFIGS.SEARCH_API; // 봇은 제한적 허용
  }
  
  // 관리자 경로 확인
  const pathname = new URL(req.url).pathname;
  if (pathname.startsWith('/api/admin/')) {
    return RATE_LIMIT_CONFIGS.ADMIN_API;
  }
  
  // 인증 경로 확인
  if (pathname.includes('/auth/') || pathname.includes('/login') || pathname.includes('/signup')) {
    return RATE_LIMIT_CONFIGS.AUTH_API;
  }
  
  // 검색 경로 확인
  if (pathname.includes('/search')) {
    return RATE_LIMIT_CONFIGS.SEARCH_API;
  }
  
  // 파일 업로드 경로 확인
  if (pathname.includes('/upload')) {
    return RATE_LIMIT_CONFIGS.FILE_UPLOAD;
  }
  
  return RATE_LIMIT_CONFIGS.GENERAL_API;
};

// Rate Limit 헤더 추가 함수
export const addRateLimitHeaders = (
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

// Rate Limit 통계 조회
export const getRateLimitStats = (key: string): RateLimitStore | null => {
  return globalStore.get(key) || null;
};

// 전역 정리 함수
export const cleanupRateLimitStore = (): void => {
  globalStore.destroy();
};

// 특정 키의 Rate Limit 초기화
export const resetRateLimit = (key: string): void => {
  globalStore.set(key, {
    count: 0,
    resetTime: Date.now() + 60 * 1000, // 1분 후 리셋
    blocked: false
  });
};

// 화이트리스트 기반 Rate Limit 예외 처리
export const createWhitelistKeyGenerator = (whitelist: string[] = []) => {
  return (req: NextRequest): string => {
    const ip = defaultKeyGenerator(req);
    
    // 화이트리스트에 있는 IP는 특별 처리
    if (whitelist.includes(ip)) {
      return `whitelist:${ip}`;
    }
    
    return ip;
  };
};

// 지역별 Rate Limit 설정
export const createGeoRateLimit = (req: NextRequest) => {
  const country = req.headers.get('cf-ipcountry') || 'unknown';
  
  // 한국 IP는 더 관대한 제한
  if (country === 'KR') {
    return {
      ...RATE_LIMIT_CONFIGS.GENERAL_API,
      maxRequests: RATE_LIMIT_CONFIGS.GENERAL_API.maxRequests * 2
    };
  }
  
  return RATE_LIMIT_CONFIGS.GENERAL_API;
};

const rateLimiterConfig = {
  applyRateLimit,
  createRateLimitMiddleware,
  createDynamicRateLimit,
  addRateLimitHeaders,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  createIPKeyGenerator,
  createRouteKeyGenerator
};

export default rateLimiterConfig;