/**
 * 강화된 입력 검증 유틸리티
 * SQL 인젝션, XSS, CSRF 등 다양한 보안 위협 방지
 */

import { sanitizeHtml, detectXssPatterns, logSecurityEvent } from './security'
import type { UUIDValidationResult, SecurityEventType, SecurityEventSeverity } from '@/types'

// UUID v4 검증 정규식
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 임시 ID 검증 정규식 (temp-{UUID} 형식)
const TEMP_ID_REGEX = /^temp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 데이터베이스 검증 관련 타입
interface DatabaseValidationResult {
  isValid: boolean
  sanitized: string
  errors: string[]
  warnings: string[]
}

// 폼 검증 관련 타입
interface FormValidationResult {
  isValid: boolean
  errors: Record<string, string[]>
  sanitizedData: Record<string, any>
}

/**
 * SQL 인젝션 패턴 감지 및 차단
 * 데이터베이스 쿼리에 사용되는 입력값 검증
 */
export const detectSqlInjection = (input: string): boolean => {
  if (typeof input !== 'string') return false

  // SQL 인젝션 의심 패턴들
  const sqlPatterns = [
    // 기본 SQL 키워드
    /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bCREATE\b|\bALTER\b|\bTRUNCATE\b)/i,
    // UNION 기반 공격
    /(\bUNION\b.*\bSELECT\b)/i,
    // 주석 기반 공격
    /(--|\#|\/\*|\*\/)/,
    // 문자열 이스케이프 시도
    /('.*'|".*")/,
    // 시스템 함수 호출
    /(\bEXEC\b|\bEXECUTE\b|\bSP_\b|\bXP_\b)/i,
    // 조건부 공격
    /(\bOR\b.*=.*|\bAND\b.*=.*)/i,
    // 시간 지연 공격
    /(\bWAITFOR\b|\bDELAY\b|\bSLEEP\b)/i,
    // 정보 수집 공격
    /(\bINFORMATION_SCHEMA\b|\bSYSCOLUMNS\b|\bSYSTABLES\b)/i,
    // 파일 시스템 접근
    /(\bINTO\s+OUTFILE\b|\bLOAD_FILE\b)/i,
    // 서브쿼리 공격
    /(\(.*SELECT.*\))/i,
  ]

  return sqlPatterns.some(pattern => pattern.test(input))
}

/**
 * UUID 형식 검증
 * @param value 검증할 문자열
 * @returns UUID 형식이 올바른지 여부
 */
export const isValidUUID = (value: string): boolean => {
  if (!value || typeof value !== 'string') {
    return false
  }
  return UUID_REGEX.test(value)
}

/**
 * 임시 ID 검증 (temp-{UUID} 형식)
 */
export const isValidTempId = (value: string): boolean => {
  if (!value || typeof value !== 'string') {
    return false
  }
  return TEMP_ID_REGEX.test(value)
}

/**
 * UUID 또는 임시 ID 검증
 */
export const isValidUUIDOrTempId = (value: string): boolean => {
  return isValidUUID(value) || isValidTempId(value)
}

/**
 * UUID 검증 (DatabaseValidationResult 형태로 반환)
 */
export const validateUUID = (uuid: string, paramName: string = 'ID'): UUIDValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof uuid !== 'string') {
    errors.push(`${paramName}가 문자열이 아닙니다.`)
    return {
      isValid: false,
      sanitized: '',
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      idType: 'invalid',
    }
  }

  const trimmed = uuid.trim()
  let idType: 'uuid' | 'temp-id' | 'invalid' = 'invalid'

  if (isValidUUID(trimmed)) {
    idType = 'uuid'
  } else {
    errors.push(`잘못된 ${paramName} 형식입니다. UUID 형식이어야 합니다.`)
    logSecurityEvent('INVALID_UUID_OR_TEMP_ID_FORMAT', { uuid: trimmed, paramName }, 'medium')
  }

  // XSS 및 SQL 인젝션 검증 (UUID는 이미 제한적이지만 추가 보안)
  if (detectXssPatterns(trimmed) || detectSqlInjection(trimmed)) {
    errors.push(`${paramName}에 위험한 패턴이 감지되었습니다.`)
    logSecurityEvent('MALICIOUS_UUID_ATTEMPT', { uuid: trimmed, paramName }, 'high')
  }

  const sanitized = trimmed.toLowerCase() // UUID는 소문자로 정규화

  return {
    isValid: errors.length === 0,
    sanitized,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    idType,
  } as const
}

/**
 * UUID 또는 임시 ID 검증.
 * 임시 게시글 첨부파일처럼 DB 레코드 생성 전의 명시적 임시 흐름에서만 사용한다.
 */
export const validateUUIDOrTempId = (
  uuid: string,
  paramName: string = 'ID'
): UUIDValidationResult => {
  const uuidValidation = validateUUID(uuid, paramName)
  if (uuidValidation.isValid) return uuidValidation

  if (typeof uuid !== 'string') return uuidValidation

  const trimmed = uuid.trim()
  if (!isValidTempId(trimmed)) return uuidValidation

  if (detectXssPatterns(trimmed) || detectSqlInjection(trimmed)) {
    return {
      isValid: false,
      sanitized: trimmed.toLowerCase(),
      errors: Object.freeze([`${paramName}에 위험한 패턴이 감지되었습니다.`]),
      warnings: Object.freeze([]),
      idType: 'invalid',
    } as const
  }

  logSecurityEvent('TEMP_ID_USAGE', { tempId: trimmed, paramName }, 'low')

  return {
    isValid: true,
    sanitized: trimmed.toLowerCase(),
    errors: Object.freeze([]),
    warnings: Object.freeze([`임시 ID가 사용되었습니다: ${paramName}`]),
    idType: 'temp-id',
  } as const
}

/**
 * 이메일 주소 검증
 * RFC 5322 표준 기반 이메일 형식 검증
 */
export const validateEmail = (email: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof email !== 'string') {
    errors.push('이메일 주소가 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  // 길이 검증
  if (email.length > 254) {
    errors.push('이메일 주소가 너무 깁니다.')
  }

  // 기본 형식 검증
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  if (!emailRegex.test(email)) {
    errors.push('유효하지 않은 이메일 형식입니다.')
  }

  // XSS 패턴 검증
  if (detectXssPatterns(email)) {
    errors.push('이메일 주소에 위험한 문자가 포함되어 있습니다.')
    logSecurityEvent('XSS_ATTEMPT_IN_EMAIL', { email }, 'high')
  }

  // SQL 인젝션 검증
  if (detectSqlInjection(email)) {
    errors.push('이메일 주소에 SQL 인젝션 패턴이 감지되었습니다.')
    logSecurityEvent('SQL_INJECTION_ATTEMPT', { email }, 'high')
  }

  const sanitized = sanitizeHtml(email.trim().toLowerCase())

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * 전화번호 검증
 * 한국 전화번호 형식 검증
 */
export const validatePhoneNumber = (phone: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof phone !== 'string') {
    errors.push('전화번호가 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  // 숫자와 하이픈만 허용
  const cleanPhone = phone.replace(/[^\d-]/g, '')

  // 한국 전화번호 형식 검증
  const phoneRegex = /^(010|011|016|017|018|019)-?\d{3,4}-?\d{4}$/
  if (!phoneRegex.test(cleanPhone)) {
    errors.push('유효하지 않은 전화번호 형식입니다.')
  }

  // XSS 및 SQL 인젝션 검증
  if (detectXssPatterns(phone) || detectSqlInjection(phone)) {
    errors.push('전화번호에 위험한 문자가 포함되어 있습니다.')
    logSecurityEvent('MALICIOUS_PHONE_NUMBER', { phone }, 'high')
  }

  const sanitized = cleanPhone

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * 사용자 이름 검증
 * 한글, 영문, 숫자만 허용
 */
export const validateUsername = (
  username: string,
  minLength: number = 2,
  maxLength: number = 20
): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof username !== 'string') {
    errors.push('사용자 이름이 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  const trimmed = username.trim()

  // 길이 검증
  if (trimmed.length < minLength) {
    errors.push(`사용자 이름은 최소 ${minLength}자 이상이어야 합니다.`)
  }
  if (trimmed.length > maxLength) {
    errors.push(`사용자 이름은 최대 ${maxLength}자까지 허용됩니다.`)
  }

  // 허용된 문자만 포함하는지 검증
  const allowedChars = /^[가-힣a-zA-Z0-9_\-\s]+$/
  if (!allowedChars.test(trimmed)) {
    errors.push('사용자 이름에 허용되지 않은 문자가 포함되어 있습니다.')
  }

  // XSS 및 SQL 인젝션 검증
  if (detectXssPatterns(trimmed) || detectSqlInjection(trimmed)) {
    errors.push('사용자 이름에 위험한 패턴이 감지되었습니다.')
    logSecurityEvent('MALICIOUS_USERNAME', { username }, 'high')
  }

  const sanitized = sanitizeHtml(trimmed)

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * 게시글 제목 검증
 */
export const validatePostTitle = (title: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof title !== 'string') {
    errors.push('제목이 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  const trimmed = title.trim()

  // 길이 검증
  if (trimmed.length < 1) {
    errors.push('제목을 입력해주세요.')
  }
  if (trimmed.length > 200) {
    errors.push('제목은 최대 200자까지 허용됩니다.')
  }

  // XSS 및 SQL 인젝션 검증
  if (detectXssPatterns(trimmed)) {
    errors.push('제목에 위험한 스크립트가 포함되어 있습니다.')
    logSecurityEvent('XSS_ATTEMPT_IN_TITLE', { title }, 'high')
  }

  if (detectSqlInjection(trimmed)) {
    errors.push('제목에 SQL 인젝션 패턴이 감지되었습니다.')
    logSecurityEvent('SQL_INJECTION_ATTEMPT', { title }, 'high')
  }

  const sanitized = sanitizeHtml(trimmed)

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * 게시글 내용 검증
 */
export const validatePostContent = (content: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof content !== 'string') {
    errors.push('내용이 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  const trimmed = content.trim()

  // 길이 검증
  if (trimmed.length < 1) {
    errors.push('내용을 입력해주세요.')
  }
  if (trimmed.length > 10000) {
    errors.push('내용은 최대 10,000자까지 허용됩니다.')
  }

  // XSS 패턴 검증
  if (detectXssPatterns(trimmed)) {
    errors.push('내용에 위험한 스크립트가 포함되어 있습니다.')
    logSecurityEvent('XSS_ATTEMPT_IN_CONTENT', { contentLength: content.length }, 'high')
  }

  // SQL 인젝션 검증
  if (detectSqlInjection(trimmed)) {
    errors.push('내용에 SQL 인젝션 패턴이 감지되었습니다.')
    logSecurityEvent('SQL_INJECTION_ATTEMPT', { contentLength: content.length }, 'high')
  }

  // 마크다운 형식 허용하되 위험한 HTML 제거
  const sanitized = sanitizeHtml(trimmed)

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * URL 검증
 */
export const validateUrl = (url: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof url !== 'string') {
    errors.push('URL이 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  const trimmed = url.trim()

  // 길이 검증
  if (trimmed.length > 2000) {
    errors.push('URL이 너무 깁니다.')
  }

  // URL 형식 검증
  try {
    const parsed = new URL(trimmed)

    // 허용된 프로토콜 확인
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:']
    if (!allowedProtocols.includes(parsed.protocol)) {
      errors.push('허용되지 않은 프로토콜입니다.')
    }

    // 프로덕션에서 localhost 차단
    if (parsed.hostname === 'localhost' && process.env.NODE_ENV === 'production') {
      errors.push('프로덕션에서는 localhost URL을 사용할 수 없습니다.')
    }

    // 의심스러운 도메인 차단
    const suspiciousDomains = ['bit.ly', 'tinyurl.com', 'goo.gl']
    if (suspiciousDomains.includes(parsed.hostname)) {
      warnings.push('단축 URL은 보안상 위험할 수 있습니다.')
    }
  } catch (error) {
    errors.push('유효하지 않은 URL 형식입니다.')
  }

  // XSS 및 SQL 인젝션 검증
  if (detectXssPatterns(trimmed) || detectSqlInjection(trimmed)) {
    errors.push('URL에 위험한 패턴이 감지되었습니다.')
    logSecurityEvent('MALICIOUS_URL', { url }, 'high')
  }

  const sanitized = sanitizeHtml(trimmed)

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * 폼 데이터 종합 검증
 */
export const validateFormData = (
  data: Record<string, any>,
  validationRules: Record<string, string>
): FormValidationResult => {
  const errors: Record<string, string[]> = {}
  const sanitizedData: Record<string, any> = {}

  for (const [field, rule] of Object.entries(validationRules)) {
    const value = data[field]

    switch (rule) {
      case 'email':
        const emailResult = validateEmail(value)
        if (!emailResult.isValid) {
          errors[field] = emailResult.errors
        }
        sanitizedData[field] = emailResult.sanitized
        break

      case 'phone':
        const phoneResult = validatePhoneNumber(value)
        if (!phoneResult.isValid) {
          errors[field] = phoneResult.errors
        }
        sanitizedData[field] = phoneResult.sanitized
        break

      case 'username':
        const usernameResult = validateUsername(value)
        if (!usernameResult.isValid) {
          errors[field] = usernameResult.errors
        }
        sanitizedData[field] = usernameResult.sanitized
        break

      case 'title':
        const titleResult = validatePostTitle(value)
        if (!titleResult.isValid) {
          errors[field] = titleResult.errors
        }
        sanitizedData[field] = titleResult.sanitized
        break

      case 'content':
        const contentResult = validatePostContent(value)
        if (!contentResult.isValid) {
          errors[field] = contentResult.errors
        }
        sanitizedData[field] = contentResult.sanitized
        break

      case 'url':
        const urlResult = validateUrl(value)
        if (!urlResult.isValid) {
          errors[field] = urlResult.errors
        }
        sanitizedData[field] = urlResult.sanitized
        break

      default:
        // 기본 문자열 검증
        if (typeof value === 'string') {
          const basicResult = validateUsername(value, 1, 1000)
          if (!basicResult.isValid) {
            errors[field] = basicResult.errors
          }
          sanitizedData[field] = basicResult.sanitized
        } else {
          sanitizedData[field] = value
        }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitizedData,
  }
}

/**
 * 보안 토큰 검증
 * CSRF 토큰 등 보안 토큰의 유효성 검증
 */
export const validateSecurityToken = (token: string, expectedLength: number = 32): boolean => {
  if (typeof token !== 'string') return false
  if (token.length !== expectedLength) return false

  // 토큰이 알파벳 숫자 조합인지 확인
  const tokenPattern = /^[a-zA-Z0-9]+$/
  return tokenPattern.test(token)
}

/**
 * 파일 업로드 검증
 */
export const validateFileUpload = (
  file: File,
  allowedTypes: string[] = ['image/jpeg', 'image/png', 'image/gif'],
  maxSize: number = 5 * 1024 * 1024
): {
  isValid: boolean
  errors: string[]
} => {
  const errors: string[] = []

  // 파일 타입 검증
  if (!allowedTypes.includes(file.type)) {
    errors.push('허용되지 않은 파일 형식입니다.')
  }

  // 파일 크기 검증
  if (file.size > maxSize) {
    errors.push(`파일 크기는 ${maxSize / 1024 / 1024}MB 이하여야 합니다.`)
  }

  // 파일명 검증
  const fileName = file.name
  if (detectXssPatterns(fileName) || detectSqlInjection(fileName)) {
    errors.push('파일명에 위험한 문자가 포함되어 있습니다.')
    logSecurityEvent('MALICIOUS_FILENAME', { fileName }, 'medium')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * 검색 쿼리 검증
 */
export const validateSearchQuery = (query: string): DatabaseValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof query !== 'string') {
    errors.push('검색어가 문자열이 아닙니다.')
    return { isValid: false, sanitized: '', errors, warnings }
  }

  const trimmed = query.trim()

  // 길이 검증
  if (trimmed.length > 100) {
    errors.push('검색어는 최대 100자까지 허용됩니다.')
  }

  // SQL 인젝션 검증
  if (detectSqlInjection(trimmed)) {
    errors.push('검색어에 SQL 인젝션 패턴이 감지되었습니다.')
    logSecurityEvent('SQL_INJECTION_IN_SEARCH', { query }, 'high')
  }

  // XSS 검증
  if (detectXssPatterns(trimmed)) {
    errors.push('검색어에 위험한 스크립트가 포함되어 있습니다.')
    logSecurityEvent('XSS_IN_SEARCH', { query }, 'high')
  }

  const sanitized = sanitizeHtml(trimmed)

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    warnings,
  }
}

/**
 * PostgREST .or() 필터에 삽입되는 값을 안전하게 이스케이프합니다.
 * - 따옴표, 백슬래시 이스케이프
 * - PostgREST 구분자(. , ( ))는 제거
 */
export function escapePostgrestValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[,()]/g, '')
}

// 검증 규칙 상수
export const VALIDATION_RULES = {
  EMAIL_MAX_LENGTH: 254,
  USERNAME_MIN_LENGTH: 2,
  USERNAME_MAX_LENGTH: 20,
  TITLE_MAX_LENGTH: 200,
  CONTENT_MAX_LENGTH: 10000,
  URL_MAX_LENGTH: 2000,
  SEARCH_MAX_LENGTH: 100,
  PHONE_PATTERN: /^(010|011|016|017|018|019)-?\d{3,4}-?\d{4}$/,
  ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
} as const

/**
 * 간단한 입력값 검증 함수
 */
export const validateInput = (
  input: string,
  type: 'title' | 'content' | 'email' | 'url' = 'content'
): DatabaseValidationResult => {
  switch (type) {
    case 'title':
      return validatePostTitle(input)
    case 'content':
      return validatePostContent(input)
    case 'email':
      return validateEmail(input)
    case 'url':
      return validateUrl(input)
    default:
      return validatePostContent(input)
  }
}

/**
 * 폼 데이터 검증 함수 (validateFormData의 별칭)
 */
export const validateForm = validateFormData
