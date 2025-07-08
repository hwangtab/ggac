/**
 * 보안 유틸리티 함수들
 * XSS, 인젝션 공격 방지를 위한 입력 검증 및 데이터 정제
 */

/**
 * HTML 특수 문자를 안전하게 이스케이프 처리
 * XSS 공격 방지를 위해 모든 사용자 입력에 적용 필수
 */
export const sanitizeHtml = (input: string): string => {
  if (typeof input !== 'string') {
    return String(input);
  }
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;');
};

/**
 * URL 유효성 검증 및 안전화
 * javascript:, data:, vbscript: 등 위험한 프로토콜 차단
 */
export const sanitizeUrl = (url: string): string => {
  if (typeof url !== 'string') {
    return '#';
  }

  // 빈 문자열 처리
  if (!url.trim()) {
    return '#';
  }

  try {
    const parsed = new URL(url);
    
    // 허용된 프로토콜만 통과
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      console.warn(`Blocked dangerous protocol: ${parsed.protocol}`);
      return '#';
    }
    
    // 추가 보안 검증
    if (parsed.hostname === 'localhost' && process.env.NODE_ENV === 'production') {
      console.warn('Blocked localhost URL in production');
      return '#';
    }
    
    return url;
  } catch (error) {
    console.warn('Invalid URL format:', url);
    return '#';
  }
};

/**
 * JSON-LD 스키마 데이터 검증 및 정제
 * 구조화된 데이터의 XSS 위험 제거
 */
export const sanitizeJsonLd = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const sanitized: any = {};

  // 필수 스키마 속성 검증
  if (data['@context']) {
    sanitized['@context'] = sanitizeHtml(String(data['@context']));
  }
  
  if (data['@type']) {
    sanitized['@type'] = sanitizeHtml(String(data['@type']));
  }

  // 안전한 문자열 속성들
  const safeStringProps = [
    '@id', 'name', 'description', 'alternateName', 
    'url', 'sameAs', 'jobTitle', 'worksFor'
  ];

  safeStringProps.forEach(prop => {
    if (data[prop]) {
      if (prop === 'url' || prop === 'sameAs') {
        // URL 속성은 URL 검증 적용
        if (Array.isArray(data[prop])) {
          sanitized[prop] = data[prop].map((url: string) => sanitizeUrl(url));
        } else {
          sanitized[prop] = sanitizeUrl(String(data[prop]));
        }
      } else {
        // 일반 문자열 속성은 HTML 이스케이프
        sanitized[prop] = sanitizeHtml(String(data[prop]));
      }
    }
  });

  // 이미지 데이터 검증
  if (data.image) {
    if (typeof data.image === 'string') {
      sanitized.image = sanitizeUrl(data.image);
    } else if (Array.isArray(data.image)) {
      sanitized.image = data.image.map((img: string) => sanitizeUrl(img));
    }
  }

  return sanitized;
};

/**
 * 플랫폼명 검증 및 정제
 * 티켓팅 플랫폼명에서 위험한 문자 제거
 */
export const sanitizePlatformName = (platform: string): string => {
  if (typeof platform !== 'string') {
    return '알 수 없음';
  }

  // HTML 태그 완전 제거
  const withoutTags = platform.replace(/<[^>]*>/g, '');
  
  // 특수 문자 이스케이프
  const escaped = sanitizeHtml(withoutTags);
  
  // 길이 제한 (보안상 및 UX상 이유)
  const truncated = escaped.length > 50 ? escaped.substring(0, 50) + '...' : escaped;
  
  return truncated || '알 수 없음';
};

/**
 * 아티클 제목 및 사이트명 정제
 * 링크 프리뷰에서 사용되는 메타데이터 안전화
 */
export const sanitizeArticleData = (title: string, siteName: string) => {
  return {
    title: sanitizeHtml(title || '').substring(0, 200) || '제목 없음',
    siteName: sanitizeHtml(siteName || '').substring(0, 100) || '사이트명 없음'
  };
};

/**
 * XSS 공격 패턴 감지
 * 의심스러운 입력 패턴을 사전에 차단
 */
export const detectXssPatterns = (input: string): boolean => {
  if (typeof input !== 'string') {
    return false;
  }

  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi,
    /onmouseover\s*=/gi,
    /<iframe\b/gi,
    /<object\b/gi,
    /<embed\b/gi,
    /<form\b/gi
  ];

  return dangerousPatterns.some(pattern => pattern.test(input));
};

/**
 * 사용자 입력 종합 검증
 * 모든 사용자 입력에 대한 통합 보안 검증
 */
export const validateUserInput = (input: string, maxLength: number = 1000): {
  isValid: boolean;
  sanitized: string;
  warnings: string[];
} => {
  const warnings: string[] = [];
  
  if (typeof input !== 'string') {
    return {
      isValid: false,
      sanitized: '',
      warnings: ['입력값이 문자열이 아닙니다.']
    };
  }

  // XSS 패턴 감지
  if (detectXssPatterns(input)) {
    warnings.push('위험한 스크립트 패턴이 감지되었습니다.');
  }

  // 길이 검증
  if (input.length > maxLength) {
    warnings.push(`입력값이 최대 길이(${maxLength})를 초과합니다.`);
  }

  // 데이터 정제
  const sanitized = sanitizeHtml(input).substring(0, maxLength);

  return {
    isValid: warnings.length === 0,
    sanitized,
    warnings
  };
};

/**
 * 로깅을 위한 보안 이벤트 기록
 * 보안 위반 시도를 모니터링하기 위한 로깅
 */
export const logSecurityEvent = (event: string, details: any, severity: 'low' | 'medium' | 'high' = 'medium') => {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[SECURITY ${severity.toUpperCase()}] ${event}:`, details);
  }
  
  // 프로덕션에서는 보안 모니터링 서비스로 전송
  // 예: Sentry, LogRocket 등
};

/**
 * Content Security Policy 정책 생성
 * 동적 CSP 헤더 생성을 위한 헬퍼
 */
export const generateCSPPolicy = (): string => {
  const policies = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vercel.live",
    "media-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ];

  return policies.join('; ');
};

// 보안 상수
export const SECURITY_CONSTANTS = {
  MAX_INPUT_LENGTH: 10000,
  MAX_URL_LENGTH: 2000,
  MAX_PLATFORM_NAME_LENGTH: 50,
  MAX_TITLE_LENGTH: 200,
  ALLOWED_PROTOCOLS: ['http:', 'https:', 'mailto:', 'tel:'],
  BLOCKED_DOMAINS: ['localhost'], // 프로덕션에서 차단할 도메인
} as const;