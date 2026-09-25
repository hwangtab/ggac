/**
 * 보안 유틸리티 함수들
 * XSS, 인젝션 공격 방지를 위한 입력 검증 및 데이터 정제
 */

import type { SecurityEventType, SecurityEventSeverity, SecurityEventContext } from '@/types'

const SECURITY_EVENT_STRING_LIMIT = 256
const REDACTED_SECURITY_VALUE = '[redacted]'

// generateSecureUUID/generateTempId/generateSecureToken은 어디서도 import되지 않는
// dead code였고, 내부의 require('crypto') 때문에 webpack이 crypto-browserify(319KB)를
// 클라이언트 vendors 청크에 강제 포함시키고 있었음 — 제거.
// 향후 필요해지면 globalThis.crypto.randomUUID() / crypto.getRandomValues() 사용 (Node 18+ 및
// 모든 모던 브라우저에서 동일 API).

/**
 * HTML 특수 문자를 안전하게 이스케이프 처리
 * XSS 공격 방지를 위해 모든 사용자 입력에 적용 필수
 */
export const sanitizeHtml = (input: string): string => {
  if (typeof input !== 'string') {
    return String(input)
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;')
}

/**
 * 일반적인 입력 문자열 정제
 * sanitizeHtml의 별칭으로 더 간단한 이름 제공
 */
export const sanitizeInput = sanitizeHtml

/**
 * URL 유효성 검증 및 안전화
 * javascript:, data:, vbscript: 등 위험한 프로토콜 차단
 */
export const sanitizeUrl = (url: string): string => {
  if (typeof url !== 'string') {
    return '#'
  }

  // 빈 문자열 처리
  if (!url.trim()) {
    return '#'
  }

  try {
    const parsed = new URL(url)

    // 허용된 프로토콜만 통과
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:']
    if (!allowedProtocols.includes(parsed.protocol)) {
      console.warn(`Blocked dangerous protocol: ${parsed.protocol}`)
      return '#'
    }

    // 추가 보안 검증
    if (parsed.hostname === 'localhost' && process.env.NODE_ENV === 'production') {
      console.warn('Blocked localhost URL in production')
      return '#'
    }

    return url
  } catch (error) {
    console.warn('Invalid URL format')
    return '#'
  }
}

// JSON-LD sanitize는 src/utils/sanitize.ts의 sanitizeJsonLd로 통합되었습니다.

/**
 * 플랫폼명 검증 및 정제
 * 티켓팅 플랫폼명에서 위험한 문자 제거
 */
export const sanitizePlatformName = (platform: string): string => {
  if (typeof platform !== 'string') {
    return '알 수 없음'
  }

  // HTML 태그 완전 제거
  const withoutTags = platform.replace(/<[^>]*>/g, '')

  // 특수 문자 이스케이프
  const escaped = sanitizeHtml(withoutTags)

  // 길이 제한 (보안상 및 UX상 이유)
  const truncated = escaped.length > 50 ? escaped.substring(0, 50) + '...' : escaped

  return truncated || '알 수 없음'
}

/**
 * 아티클 제목 및 사이트명 정제
 * 링크 프리뷰에서 사용되는 메타데이터 안전화
 */
export const sanitizeArticleData = (title: string, siteName: string) => {
  return {
    title: sanitizeHtml(title || '').substring(0, 200) || '제목 없음',
    siteName: sanitizeHtml(siteName || '').substring(0, 100) || '사이트명 없음',
  }
}

/**
 * XSS 공격 패턴 감지
 * 의심스러운 입력 패턴을 사전에 차단
 */
export const detectXssPatterns = (input: string): boolean => {
  if (typeof input !== 'string') {
    return false
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
    /onmouseout\s*=/gi,
    /onfocus\s*=/gi,
    /onblur\s*=/gi,
    /onchange\s*=/gi,
    /onsubmit\s*=/gi,
    /<iframe\b/gi,
    /<object\b/gi,
    /<embed\b/gi,
    /<form\b/gi,
    /<svg\b[^>]*onload/gi,
    /<img\b[^>]*onerror/gi,
    /expression\s*\(/gi,
    /url\s*\(\s*javascript:/gi,
    /@import\s+["']javascript:/gi,
  ]

  return dangerousPatterns.some(pattern => pattern.test(input))
}

/**
 * HTML 태그 화이트리스트 기반 정제
 * 안전한 HTML 태그만 허용하고 나머지는 제거
 */
export const sanitizeHtmlWithWhitelist = (input: string): string => {
  if (typeof input !== 'string') {
    return String(input)
  }

  // 허용된 태그와 속성 정의
  const allowedTags = [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
  ]
  const allowedAttributes = {
    a: ['href', 'title', 'target'],
    '*': ['class'], // 모든 태그에 class 속성 허용
  }

  // 모든 HTML 태그를 찾아서 검증
  return input.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi, (match, tagName) => {
    const tag = tagName.toLowerCase()

    // 허용되지 않은 태그는 제거
    if (!allowedTags.includes(tag)) {
      return ''
    }

    // 속성 검증: 이벤트 핸들러 제거 후 javascript:/vbscript: href 차단
    let cleanMatch = match.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // 이벤트 핸들러 제거
    if (tag === 'a') {
      // href에 javascript: 또는 vbscript: 프로토콜이 있으면 해당 속성 제거
      cleanMatch = cleanMatch.replace(/href\s*=\s*["'][\s\S]*?javascript:[\s\S]*?["']/gi, '')
      cleanMatch = cleanMatch.replace(/href\s*=\s*["'][\s\S]*?vbscript:[\s\S]*?["']/gi, '')
    }
    return cleanMatch
  })
}

/**
 * 마크다운을 안전한 HTML로 변환
 * XSS 방지를 위한 마크다운 전용 정제 함수
 */
export const sanitizeMarkdown = (markdown: string): string => {
  if (typeof markdown !== 'string') {
    return ''
  }

  // 위험한 마크다운 패턴 제거
  let cleaned = markdown
    // 인라인 HTML 제거
    .replace(/<[^>]*>/g, '')
    // 위험한 링크 프로토콜 제거
    .replace(/\[([^\]]*)\]\(javascript:[^)]*\)/gi, '[$1](#)')
    .replace(/\[([^\]]*)\]\(vbscript:[^)]*\)/gi, '[$1](#)')
    .replace(/\[([^\]]*)\]\(data:[^)]*\)/gi, '[$1](#)')

  return cleaned
}

/**
 * 사용자 입력 종합 검증
 * 모든 사용자 입력에 대한 통합 보안 검증
 */
export const validateUserInput = (
  input: string,
  maxLength: number = 1000
): {
  isValid: boolean
  sanitized: string
  warnings: string[]
} => {
  const warnings: string[] = []

  if (typeof input !== 'string') {
    return {
      isValid: false,
      sanitized: '',
      warnings: ['입력값이 문자열이 아닙니다.'],
    }
  }

  // XSS 패턴 감지
  if (detectXssPatterns(input)) {
    warnings.push('위험한 스크립트 패턴이 감지되었습니다.')
  }

  // 길이 검증
  if (input.length > maxLength) {
    warnings.push(`입력값이 최대 길이(${maxLength})를 초과합니다.`)
  }

  // 데이터 정제
  const sanitized = sanitizeHtml(input).substring(0, maxLength)

  return {
    isValid: warnings.length === 0,
    sanitized,
    warnings,
  }
}

function sanitizeSecurityUrl(value: string): string {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`.slice(0, SECURITY_EVENT_STRING_LIMIT)
  } catch {
    return '[invalid-url]'
  }
}

function maskSecurityEmail(value: string): string {
  const [localPart, domain] = value.split('@')
  if (!localPart || !domain) return REDACTED_SECURITY_VALUE
  return `${localPart.slice(0, 2)}***@${domain.slice(0, SECURITY_EVENT_STRING_LIMIT - 6)}`
}

function maskSecurityString(value: string): string {
  if (value.length <= 4) return REDACTED_SECURITY_VALUE
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

function sanitizeSecurityEventValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 2) return '[nested]'

  if (typeof value === 'string') {
    const normalizedKey = key.toLowerCase()

    if (
      normalizedKey.includes('token') ||
      normalizedKey.includes('secret') ||
      normalizedKey.includes('cookie') ||
      normalizedKey.includes('authorization')
    ) {
      return REDACTED_SECURITY_VALUE
    }

    if (normalizedKey.includes('url') || normalizedKey.includes('uri')) {
      return sanitizeSecurityUrl(value)
    }

    if (normalizedKey.includes('email')) {
      return maskSecurityEmail(value)
    }

    if (normalizedKey.includes('phone')) {
      return maskSecurityString(value)
    }

    return value.slice(0, SECURITY_EVENT_STRING_LIMIT)
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item, index) => sanitizeSecurityEventValue(String(index), item, depth + 1))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeSecurityEventValue(nestedKey, nestedValue, depth + 1),
      ])
    )
  }

  return value
}

function sanitizeSecurityEventDetails(details: SecurityEventContext): SecurityEventContext {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeSecurityEventValue(key, value)])
  )
}

/** 외부 알림 한 번이 함수 수명을 붙들지 않게 하는 상한. */
const SECURITY_POST_TIMEOUT_MS = 5000

/**
 * 외부 채널로 한 건 보낸다. **절대 던지지 않는다** — 호출부는 이 결과를
 * 기다리지 않고, 거절된 프로미스가 새 나가면 보안 로그 한 줄이 프로세스를
 * 흔든다.
 */
async function postSecurityPayload(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      // 없으면 응답 없는 웹훅 하나가 서버리스 함수를 수명 끝까지 붙든다.
      signal: AbortSignal.timeout(SECURITY_POST_TIMEOUT_MS),
    })
  } catch (error) {
    // 보안 로깅 실패는 콘솔에만 기록한다(무한 루프 방지).
    console.error('[Security] Failed to send security event:', error)
  }
}

/**
 * 로깅을 위한 보안 이벤트 기록
 * 보안 위반 시도를 모니터링하기 위한 로깅
 */
export const logSecurityEvent = (
  event: SecurityEventType,
  details: SecurityEventContext,
  severity: SecurityEventSeverity = 'medium'
): void => {
  const sanitizedDetails = sanitizeSecurityEventDetails(details)

  // 불변 이벤트 컨텍스트 생성
  const immutableDetails: SecurityEventContext = Object.freeze({
    ...sanitizedDetails,
    timestamp: new Date().toISOString(),
    severity,
    eventType: event,
  })

  if (process.env.NODE_ENV === 'development' && severity !== 'high') {
    console.warn(`[SECURITY ${severity.toUpperCase()}] ${event}:`, immutableDetails)
  }

  // 'high'는 환경을 가리지 않고 stderr에 남긴다.
  //
  // 전에는 이 줄이 프로덕션 분기 **안**에 있었다. 웹훅 환경변수는 어디에도
  // 설정돼 있지 않으므로(`scripts/verify-env.js`의 필수·선택 목록 어디에도
  // 없다) 'high' 이벤트가 닿는 유일한 곳은 이 console.error이고, 그게
  // 프로덕션 안에 갇혀 있으면 로컬·프리뷰·테스트에서는 크론이 조용히 깨진
  // 것과 구분되지 않는다. Vercel 런타임 로그가 지금 유일하게 확실한 통로다.
  if (severity === 'high') {
    console.error(`[CRITICAL SECURITY EVENT] ${event}`, immutableDetails)
  }

  // 외부 채널 전송은 프로덕션에서만. 응답을 기다리지 않는다(fire-and-forget) —
  // 보안 로그 한 줄이 요청 흐름을 붙들면 안 된다.
  if (process.env.NODE_ENV !== 'production') return

  if (process.env.SECURITY_WEBHOOK_URL) {
    void postSecurityPayload(
      process.env.SECURITY_WEBHOOK_URL,
      {
        type: 'security_event',
        event,
        severity,
        details: immutableDetails,
        environment: 'production',
        timestamp: immutableDetails.timestamp,
      },
      { 'User-Agent': 'GGAC-Security-Monitor/1.0' }
    )
  }

  // 알림 채널은 모니터링 전송과 **따로** 보낸다. 전에는 둘이 한 try 안에서
  // 순차 await라, 모니터링 URL이 죽어 있으면 정작 사람을 부르는 알림이 한 번도
  // 나가지 않았다.
  if (severity === 'high' && process.env.SECURITY_ALERT_WEBHOOK_URL) {
    void postSecurityPayload(process.env.SECURITY_ALERT_WEBHOOK_URL, {
      text: `🚨 Critical Security Event: ${event}`,
      attachments: [
        {
          color: 'danger',
          fields: [
            { title: 'Event', value: event, short: true },
            { title: 'Severity', value: severity.toUpperCase(), short: true },
            {
              title: 'Details',
              value: JSON.stringify(immutableDetails, null, 2),
              short: false,
            },
          ],
          timestamp: immutableDetails.timestamp,
        },
      ],
    })
  }
}

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
    "connect-src 'self' https://vercel.live",
    "media-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ]

  return policies.join('; ')
}

// 보안 상수
export const SECURITY_CONSTANTS = {
  MAX_INPUT_LENGTH: 10000,
  MAX_URL_LENGTH: 2000,
  MAX_PLATFORM_NAME_LENGTH: 50,
  MAX_TITLE_LENGTH: 200,
  ALLOWED_PROTOCOLS: ['http:', 'https:', 'mailto:', 'tel:'],
  BLOCKED_DOMAINS: ['localhost'], // 프로덕션에서 차단할 도메인
} as const
