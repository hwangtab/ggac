/**
 * 이미지 URL 보안 검증 유틸리티
 * 악성 이미지 URL, 피싱 사이트, 불법 콘텐츠 차단
 */

import { sanitizeUrl, logSecurityEvent } from './security';

// 이미지 검증 결과 인터페이스
interface ImageValidationResult {
  isValid: boolean;
  sanitizedUrl: string;
  errors: string[];
  warnings: string[];
  metadata?: {
    domain: string;
    protocol: string;
    fileExtension: string;
    estimatedSize?: number;
  };
}

// 허용된 이미지 도메인 (화이트리스트)
const ALLOWED_IMAGE_DOMAINS = [
  // 일반적인 이미지 호스팅 서비스
  'imgur.com',
  'i.imgur.com',
  'images.unsplash.com',
  'unsplash.com',
  'pixabay.com',
  'pexels.com',
  'flickr.com',
  'staticflickr.com',
  
  // 소셜 미디어 플랫폼
  'instagram.com',
  'cdninstagram.com',
  'scontent.cdninstagram.com',
  'pbs.twimg.com',
  'abs.twimg.com',
  'facebook.com',
  'scontent.xx.fbcdn.net',
  
  // 구글 서비스
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'drive.google.com',
  'googleusercontent.com',
  
  // 기타 신뢰할 수 있는 서비스
  'github.com',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'vercel.app',
  'netlify.app',
  'amazonaws.com',
  'cloudfront.net',
  'azure.com',
  'gstatic.com',
  
  // 한국 서비스
  'kakaocdn.net',
  'pstatic.net',
  'naver.com',
  'daumcdn.net',
  
  // 자체 도메인
  'ggac.kr',
  'localhost' // 개발 환경에서만 허용
];

// 차단된 도메인 (블랙리스트)
const BLOCKED_IMAGE_DOMAINS = [
  // 알려진 악성 도메인
  'malware.com',
  'phishing.com',
  'spam.com',
  
  // 성인 콘텐츠 도메인
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  
  // 저작권 침해 우려 도메인
  'rapidshare.com',
  'megaupload.com',
  
  // 광고/스팸 도메인
  'doubleclick.net',
  'googleadservices.com',
];

// 허용된 이미지 확장자
const ALLOWED_IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff', '.tif'
];

// 위험한 파일 확장자
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js', '.jar', '.php', '.asp', '.aspx'
];

/**
 * 이미지 URL 종합 검증
 */
export const validateImageUrl = async (url: string): Promise<ImageValidationResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 기본 URL 검증
  if (typeof url !== 'string' || !url.trim()) {
    return {
      isValid: false,
      sanitizedUrl: '',
      errors: ['URL이 제공되지 않았습니다.'],
      warnings: []
    };
  }

  let sanitizedUrl = sanitizeUrl(url.trim());
  
  // URL 파싱
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sanitizedUrl);
  } catch (error) {
    return {
      isValid: false,
      sanitizedUrl: '',
      errors: ['유효하지 않은 URL 형식입니다.'],
      warnings: []
    };
  }

  const domain = parsedUrl.hostname.toLowerCase();
  const protocol = parsedUrl.protocol;
  const pathname = parsedUrl.pathname.toLowerCase();
  
  // 메타데이터 수집
  const metadata = {
    domain,
    protocol,
    fileExtension: getFileExtension(pathname)
  };

  // 프로토콜 검증
  if (!['http:', 'https:'].includes(protocol)) {
    errors.push('HTTP 또는 HTTPS 프로토콜만 허용됩니다.');
  }

  // 프로덕션에서 localhost 차단
  if (domain === 'localhost' && process.env.NODE_ENV === 'production') {
    errors.push('프로덕션 환경에서는 localhost URL을 사용할 수 없습니다.');
  }

  // 도메인 화이트리스트 검증
  if (!isDomainAllowed(domain)) {
    errors.push('허용되지 않은 도메인입니다.');
    logSecurityEvent('BLOCKED_IMAGE_DOMAIN', { domain, url }, 'medium');
  }

  // 도메인 블랙리스트 검증
  if (isDomainBlocked(domain)) {
    errors.push('차단된 도메인입니다.');
    logSecurityEvent('MALICIOUS_IMAGE_DOMAIN', { domain, url }, 'high');
  }

  // 파일 확장자 검증
  if (metadata.fileExtension && !ALLOWED_IMAGE_EXTENSIONS.includes(metadata.fileExtension)) {
    errors.push('허용되지 않은 이미지 파일 형식입니다.');
  }

  // 위험한 확장자 검증
  if (metadata.fileExtension && DANGEROUS_EXTENSIONS.includes(metadata.fileExtension)) {
    errors.push('위험한 파일 확장자가 감지되었습니다.');
    logSecurityEvent('DANGEROUS_FILE_EXTENSION', { extension: metadata.fileExtension, url }, 'high');
  }

  // URL 길이 검증
  if (url.length > 2000) {
    errors.push('URL이 너무 깁니다.');
  }

  // 의심스러운 URL 패턴 검증
  const suspiciousPatterns = [
    /javascript:/i,
    /data:(?!image\/)/i,
    /vbscript:/i,
    /about:blank/i,
    /\.php\?/i,
    /\.asp\?/i,
    /\/admin\//i,
    /\/wp-admin\//i,
    /\.htaccess/i,
    /\/\.\./i, // 디렉토리 탐색 공격
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url)) {
      errors.push('의심스러운 URL 패턴이 감지되었습니다.');
      logSecurityEvent('SUSPICIOUS_IMAGE_URL', { pattern: pattern.toString(), url }, 'high');
      break;
    }
  }

  // 쿼리 파라미터 검증
  const queryParams = parsedUrl.searchParams;
  const dangerousParams = ['eval', 'exec', 'system', 'cmd', 'shell'];
  
  for (const param of dangerousParams) {
    if (queryParams.has(param)) {
      errors.push('위험한 쿼리 파라미터가 감지되었습니다.');
      logSecurityEvent('DANGEROUS_QUERY_PARAM', { param, url }, 'high');
      break;
    }
  }

  // 추가 보안 검증
  await performAdvancedValidation(url, warnings);

  return {
    isValid: errors.length === 0,
    sanitizedUrl,
    errors,
    warnings,
    metadata
  };
};

/**
 * 도메인 허용 여부 검증
 */
const isDomainAllowed = (domain: string): boolean => {
  return ALLOWED_IMAGE_DOMAINS.some(allowedDomain => {
    if (allowedDomain.startsWith('*.')) {
      // 와일드카드 도메인 (예: *.example.com)
      const baseDomain = allowedDomain.slice(2);
      return domain.endsWith(baseDomain);
    }
    return domain === allowedDomain || domain.endsWith(`.${allowedDomain}`);
  });
};

/**
 * 도메인 차단 여부 검증
 */
const isDomainBlocked = (domain: string): boolean => {
  return BLOCKED_IMAGE_DOMAINS.some(blockedDomain => {
    return domain === blockedDomain || domain.endsWith(`.${blockedDomain}`);
  });
};

/**
 * 파일 확장자 추출
 */
const getFileExtension = (pathname: string): string => {
  const lastDotIndex = pathname.lastIndexOf('.');
  if (lastDotIndex === -1) return '';
  return pathname.slice(lastDotIndex).toLowerCase();
};

/**
 * 고급 검증 수행
 */
const performAdvancedValidation = async (url: string, warnings: string[]): Promise<void> => {
  try {
    // URL 단축 서비스 감지
    const shortenerDomains = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly'];
    const parsedUrl = new URL(url);
    
    if (shortenerDomains.includes(parsedUrl.hostname)) {
      warnings.push('단축 URL이 감지되었습니다. 보안상 주의가 필요합니다.');
    }

    // 의심스러운 포트 검증
    if (parsedUrl.port && !['80', '443', '8080', '8443'].includes(parsedUrl.port)) {
      warnings.push('비표준 포트가 감지되었습니다.');
    }

    // IP 주소 사용 검증
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipPattern.test(parsedUrl.hostname)) {
      warnings.push('IP 주소가 직접 사용되었습니다. 도메인 사용을 권장합니다.');
    }

    // 파일 크기 추정 (가능한 경우)
    // 실제 구현에서는 HEAD 요청으로 Content-Length 확인
    
  } catch (error) {
    // 고급 검증 실패는 경고로 처리
    warnings.push('고급 검증 중 오류가 발생했습니다.');
  }
};

/**
 * 이미지 URL 배치 검증
 */
export const validateImageUrls = async (urls: string[]): Promise<{
  results: ImageValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
  };
}> => {
  const results: ImageValidationResult[] = [];
  
  for (const url of urls) {
    const result = await validateImageUrl(url);
    results.push(result);
  }

  const summary = {
    total: urls.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid).length,
    warnings: results.filter(r => r.warnings.length > 0).length
  };

  return { results, summary };
};

/**
 * 이미지 URL 프록시 생성
 * 외부 이미지를 안전하게 표시하기 위한 프록시 URL 생성
 */
export const createImageProxy = (imageUrl: string): string => {
  // 검증된 이미지만 프록시 처리
  if (!imageUrl || typeof imageUrl !== 'string') {
    return '/images/placeholder.png';
  }

  try {
    const parsedUrl = new URL(imageUrl);
    const domain = parsedUrl.hostname.toLowerCase();
    
    // 자체 도메인은 프록시 불필요
    if (domain === 'ggac.kr' || domain === 'localhost') {
      return imageUrl;
    }
    
    // 신뢰할 수 있는 도메인은 직접 사용
    if (isDomainAllowed(domain)) {
      return imageUrl;
    }
    
    // 나머지는 프록시 서비스를 통해 처리
    const encodedUrl = encodeURIComponent(imageUrl);
    return `/api/images/proxy?url=${encodedUrl}`;
    
  } catch (error) {
    return '/images/placeholder.png';
  }
};

/**
 * 이미지 URL 캐시 키 생성
 */
export const generateImageCacheKey = (imageUrl: string): string => {
  // URL을 해시화하여 캐시 키 생성
  const hash = Buffer.from(imageUrl).toString('base64');
  return `img_${hash.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;
};

/**
 * 이미지 메타데이터 추출
 */
export const extractImageMetadata = (imageUrl: string): {
  domain: string;
  protocol: string;
  fileExtension: string;
  fileName: string;
  isSecure: boolean;
  isTrusted: boolean;
} => {
  try {
    const parsedUrl = new URL(imageUrl);
    const pathname = parsedUrl.pathname;
    const fileName = pathname.split('/').pop() || '';
    
    return {
      domain: parsedUrl.hostname.toLowerCase(),
      protocol: parsedUrl.protocol,
      fileExtension: getFileExtension(pathname),
      fileName,
      isSecure: parsedUrl.protocol === 'https:',
      isTrusted: isDomainAllowed(parsedUrl.hostname.toLowerCase())
    };
  } catch (error) {
    return {
      domain: '',
      protocol: '',
      fileExtension: '',
      fileName: '',
      isSecure: false,
      isTrusted: false
    };
  }
};

/**
 * 이미지 URL 보안 등급 계산
 */
export const calculateImageSecurityLevel = (imageUrl: string): {
  level: 'safe' | 'warning' | 'danger';
  score: number;
  reasons: string[];
} => {
  const reasons: string[] = [];
  let score = 100;

  try {
    const parsedUrl = new URL(imageUrl);
    const domain = parsedUrl.hostname.toLowerCase();
    
    // 도메인 신뢰도 평가
    if (isDomainAllowed(domain)) {
      reasons.push('신뢰할 수 있는 도메인');
    } else {
      score -= 30;
      reasons.push('알 수 없는 도메인');
    }

    if (isDomainBlocked(domain)) {
      score -= 80;
      reasons.push('차단된 도메인');
    }

    // 프로토콜 보안성 평가
    if (parsedUrl.protocol === 'https:') {
      reasons.push('보안 연결 (HTTPS)');
    } else {
      score -= 20;
      reasons.push('비보안 연결 (HTTP)');
    }

    // 파일 확장자 평가
    const extension = getFileExtension(parsedUrl.pathname);
    if (ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
      reasons.push('허용된 이미지 형식');
    } else {
      score -= 15;
      reasons.push('알 수 없는 파일 형식');
    }

    // 경로 보안성 평가
    if (parsedUrl.pathname.includes('../') || parsedUrl.pathname.includes('..\\')) {
      score -= 50;
      reasons.push('경로 탐색 공격 의심');
    }

    // 쿼리 파라미터 평가
    if (parsedUrl.search.length > 100) {
      score -= 10;
      reasons.push('긴 쿼리 파라미터');
    }

  } catch (error) {
    score = 0;
    reasons.push('잘못된 URL 형식');
  }

  score = Math.max(0, Math.min(100, score));

  let level: 'safe' | 'warning' | 'danger';
  if (score >= 80) {
    level = 'safe';
  } else if (score >= 50) {
    level = 'warning';
  } else {
    level = 'danger';
  }

  return { level, score, reasons };
};

/**
 * 이미지 화이트리스트 업데이트
 */
export const updateImageWhitelist = (newDomains: string[]): void => {
  ALLOWED_IMAGE_DOMAINS.push(...newDomains);
  logSecurityEvent('IMAGE_WHITELIST_UPDATED', { newDomains }, 'low');
};

/**
 * 이미지 블랙리스트 업데이트
 */
export const updateImageBlacklist = (newDomains: string[]): void => {
  BLOCKED_IMAGE_DOMAINS.push(...newDomains);
  logSecurityEvent('IMAGE_BLACKLIST_UPDATED', { newDomains }, 'medium');
};

const imageValidationUtils = {
  validateImageUrl,
  validateImageUrls,
  createImageProxy,
  generateImageCacheKey,
  extractImageMetadata,
  calculateImageSecurityLevel,
  updateImageWhitelist,
  updateImageBlacklist
};

export default imageValidationUtils;