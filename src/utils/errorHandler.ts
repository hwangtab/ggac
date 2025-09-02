/**
 * 공통 에러 처리 유틸리티
 * 
 * API 라우트에서 사용하는 표준화된 에러 처리와 로깅을 제공합니다.
 * - 구조화된 에러 로깅
 * - 표준화된 에러 응답
 * - 에러 타입별 분류
 * - 민감한 정보 마스킹
 */

import { NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'

// 에러 카테고리 정의
export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NOT_FOUND = 'not_found',
  DATABASE = 'database',
  EXTERNAL_SERVICE = 'external_service',
  FILE_UPLOAD = 'file_upload',
  RATE_LIMIT = 'rate_limit',
  SYSTEM = 'system',
  UNKNOWN = 'unknown'
}

// 에러 심각도 레벨
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// 구조화된 에러 정보
export interface ErrorInfo {
  category: ErrorCategory
  severity: ErrorSeverity
  message: string
  userMessage: string
  statusCode: number
  details?: Record<string, any>
  shouldLog?: boolean
  shouldNotify?: boolean
}

// API 컨텍스트 정보
export interface ApiContext {
  endpoint: string
  method: string
  userId?: string
  sessionId?: string
  userAgent?: string
  ip?: string
  timestamp?: Date
}

// 에러 로깅을 위한 구조화된 정보
export interface ErrorLogEntry {
  id: string
  context: ApiContext
  error: ErrorInfo
  originalError?: Error
  stack?: string
  requestData?: any
  responseTime?: number
}

/**
 * 미리 정의된 에러 타입들
 */
export const PREDEFINED_ERRORS = {
  // Authentication Errors
  UNAUTHORIZED: {
    category: ErrorCategory.AUTHENTICATION,
    severity: ErrorSeverity.LOW,
    message: 'User not authenticated',
    userMessage: '인증이 필요합니다.',
    statusCode: 401,
    shouldLog: true
  } as ErrorInfo,

  SESSION_EXPIRED: {
    category: ErrorCategory.AUTHENTICATION,
    severity: ErrorSeverity.LOW,
    message: 'Session expired',
    userMessage: '세션이 만료되었습니다. 다시 로그인해주세요.',
    statusCode: 401,
    shouldLog: true
  } as ErrorInfo,

  // Authorization Errors
  FORBIDDEN: {
    category: ErrorCategory.AUTHORIZATION,
    severity: ErrorSeverity.MEDIUM,
    message: 'Access denied',
    userMessage: '접근 권한이 없습니다.',
    statusCode: 403,
    shouldLog: true
  } as ErrorInfo,

  MEMBER_NOT_APPROVED: {
    category: ErrorCategory.AUTHORIZATION,
    severity: ErrorSeverity.LOW,
    message: 'Member not approved',
    userMessage: '승인된 회원만 접근할 수 있습니다.',
    statusCode: 403,
    shouldLog: true
  } as ErrorInfo,

  // Validation Errors
  INVALID_INPUT: {
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    message: 'Invalid input data',
    userMessage: '입력 데이터가 유효하지 않습니다.',
    statusCode: 400,
    shouldLog: false
  } as ErrorInfo,

  MISSING_REQUIRED_FIELD: {
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    message: 'Required field missing',
    userMessage: '필수 항목이 누락되었습니다.',
    statusCode: 400,
    shouldLog: false
  } as ErrorInfo,

  // Not Found Errors
  RESOURCE_NOT_FOUND: {
    category: ErrorCategory.NOT_FOUND,
    severity: ErrorSeverity.LOW,
    message: 'Resource not found',
    userMessage: '요청한 리소스를 찾을 수 없습니다.',
    statusCode: 404,
    shouldLog: false
  } as ErrorInfo,

  // Database Errors
  DATABASE_CONNECTION_ERROR: {
    category: ErrorCategory.DATABASE,
    severity: ErrorSeverity.HIGH,
    message: 'Database connection failed',
    userMessage: '데이터베이스 연결에 실패했습니다.',
    statusCode: 503,
    shouldLog: true,
    shouldNotify: true
  } as ErrorInfo,

  DATABASE_QUERY_ERROR: {
    category: ErrorCategory.DATABASE,
    severity: ErrorSeverity.HIGH,
    message: 'Database query failed',
    userMessage: '데이터베이스 오류가 발생했습니다.',
    statusCode: 500,
    shouldLog: true
  } as ErrorInfo,

  // External Service Errors
  SUPABASE_STORAGE_ERROR: {
    category: ErrorCategory.EXTERNAL_SERVICE,
    severity: ErrorSeverity.MEDIUM,
    message: 'Supabase Storage error',
    userMessage: '파일 저장소 오류가 발생했습니다.',
    statusCode: 503,
    shouldLog: true
  } as ErrorInfo,

  // File Upload Errors
  FILE_TOO_LARGE: {
    category: ErrorCategory.FILE_UPLOAD,
    severity: ErrorSeverity.LOW,
    message: 'File size exceeds limit',
    userMessage: '파일 크기가 제한을 초과했습니다.',
    statusCode: 413,
    shouldLog: false
  } as ErrorInfo,

  UNSUPPORTED_FILE_TYPE: {
    category: ErrorCategory.FILE_UPLOAD,
    severity: ErrorSeverity.LOW,
    message: 'Unsupported file type',
    userMessage: '지원하지 않는 파일 형식입니다.',
    statusCode: 400,
    shouldLog: false
  } as ErrorInfo,

  // Rate Limit Errors
  RATE_LIMIT_EXCEEDED: {
    category: ErrorCategory.RATE_LIMIT,
    severity: ErrorSeverity.MEDIUM,
    message: 'Rate limit exceeded',
    userMessage: '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
    statusCode: 429,
    shouldLog: true
  } as ErrorInfo,

  // System Errors
  INTERNAL_SERVER_ERROR: {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.HIGH,
    message: 'Internal server error',
    userMessage: '서버 내부 오류가 발생했습니다.',
    statusCode: 500,
    shouldLog: true
  } as ErrorInfo,

  SERVICE_UNAVAILABLE: {
    category: ErrorCategory.EXTERNAL_SERVICE,
    severity: ErrorSeverity.HIGH,
    message: 'Service temporarily unavailable',
    userMessage: '서비스를 일시적으로 사용할 수 없습니다.',
    statusCode: 503,
    shouldLog: true,
    shouldNotify: true
  } as ErrorInfo,

  // Unknown Error
  UNKNOWN: {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    message: 'Unknown error occurred',
    userMessage: '알 수 없는 오류가 발생했습니다.',
    statusCode: 500,
    shouldLog: true
  } as ErrorInfo
} as const

/**
 * 민감한 정보를 마스킹하는 함수
 */
function maskSensitiveData(data: any): any {
  if (typeof data !== 'object' || data === null) return data

  const masked = { ...data }
  const sensitiveKeys = ['password', 'token', 'key', 'secret', 'authorization', 'cookie']

  for (const key in masked) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      masked[key] = '[MASKED]'
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key])
    }
  }

  return masked
}

/**
 * 에러를 구조화된 형태로 로깅
 */
function logError(entry: ErrorLogEntry): void {
  const logData = {
    id: entry.id,
    timestamp: entry.context.timestamp || new Date(),
    endpoint: entry.context.endpoint,
    method: entry.context.method,
    userId: entry.context.userId,
    category: entry.error.category,
    severity: entry.error.severity,
    message: entry.error.message,
    statusCode: entry.error.statusCode,
    details: entry.error.details ? maskSensitiveData(entry.error.details) : undefined,
    originalError: entry.originalError?.message,
    stack: entry.stack,
    requestData: entry.requestData ? maskSensitiveData(entry.requestData) : undefined,
    responseTime: entry.responseTime,
    userAgent: entry.context.userAgent,
    ip: entry.context.ip
  }

  // 심각도에 따른 로깅 레벨 결정
  switch (entry.error.severity) {
    case ErrorSeverity.CRITICAL:
    case ErrorSeverity.HIGH:
      console.error('[API ERROR]', JSON.stringify(logData, null, 2))
      break
    case ErrorSeverity.MEDIUM:
      console.warn('[API WARNING]', JSON.stringify(logData, null, 2))
      break
    case ErrorSeverity.LOW:
    default:
      console.log('[API INFO]', JSON.stringify(logData, null, 2))
      break
  }
}

/**
 * Supabase 에러를 분석하여 적절한 ErrorInfo로 변환
 */
export function analyzeSupabaseError(error: any): ErrorInfo {
  if (!error) return PREDEFINED_ERRORS.UNKNOWN

  const message = error.message?.toLowerCase() || ''
  const code = error.code || error.status

  // 인증 관련 에러
  if (message.includes('unauthorized') || message.includes('jwt') || code === 'UNAUTHORIZED') {
    return PREDEFINED_ERRORS.UNAUTHORIZED
  }

  // 권한 관련 에러
  if (message.includes('forbidden') || message.includes('access denied') || code === 'FORBIDDEN') {
    return PREDEFINED_ERRORS.FORBIDDEN
  }

  // 데이터베이스 연결 에러
  if (message.includes('connection') || message.includes('timeout') || code === 'CONNECTION_ERROR') {
    return PREDEFINED_ERRORS.DATABASE_CONNECTION_ERROR
  }

  // 리소스 없음 에러
  if (message.includes('not found') || code === 'NOT_FOUND' || code === '404') {
    return PREDEFINED_ERRORS.RESOURCE_NOT_FOUND
  }

  // Storage 관련 에러
  if (message.includes('storage') || message.includes('bucket')) {
    return PREDEFINED_ERRORS.SUPABASE_STORAGE_ERROR
  }

  // 일반적인 데이터베이스 에러
  if (message.includes('database') || message.includes('sql') || message.includes('query')) {
    return { ...PREDEFINED_ERRORS.DATABASE_QUERY_ERROR, details: { originalError: error.message } }
  }

  // 기본값
  return { ...PREDEFINED_ERRORS.INTERNAL_SERVER_ERROR, details: { originalError: error.message } }
}

/**
 * 고유한 에러 ID 생성
 */
function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * API 에러를 처리하고 적절한 응답을 반환하는 클래스
 */
export class ApiErrorHandler {
  private context: ApiContext

  constructor(context: ApiContext) {
    this.context = {
      ...context,
      timestamp: new Date()
    }
  }

  /**
   * 에러를 처리하고 NextResponse를 반환
   */
  handleError(
    error: Error | any, 
    errorInfo?: Partial<ErrorInfo>,
    requestData?: any,
    responseTime?: number
  ): NextResponse {
    let finalErrorInfo: ErrorInfo

    if (errorInfo) {
      // 사용자 정의 에러 정보가 제공된 경우
      finalErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        message: 'Unknown error',
        userMessage: '오류가 발생했습니다.',
        statusCode: 500,
        shouldLog: true,
        ...errorInfo
      }
    } else if (error?.message && Object.values(PREDEFINED_ERRORS).find(e => e.message === error.message)) {
      // 미리 정의된 에러인 경우
      finalErrorInfo = Object.values(PREDEFINED_ERRORS).find(e => e.message === error.message)!
    } else {
      // Supabase 에러 분석 또는 일반 에러
      finalErrorInfo = error?.code || error?.status 
        ? analyzeSupabaseError(error)
        : PREDEFINED_ERRORS.INTERNAL_SERVER_ERROR
    }

    // 에러 로깅 수행
    if (finalErrorInfo.shouldLog !== false) {
      const logEntry: ErrorLogEntry = {
        id: generateErrorId(),
        context: this.context,
        error: finalErrorInfo,
        originalError: error instanceof Error ? error : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        requestData,
        responseTime
      }
      
      logError(logEntry)
    }

    // TODO: 알림이 필요한 경우 (슬랙, 이메일 등)
    if (finalErrorInfo.shouldNotify) {
      // 여기에 알림 로직 구현
      console.error('[CRITICAL ERROR NOTIFICATION NEEDED]', finalErrorInfo.message)
    }

    // NextResponse 반환
    return NextResponse.json(
      { 
        error: finalErrorInfo.userMessage,
        category: finalErrorInfo.category,
        code: finalErrorInfo.statusCode
      }, 
      { status: finalErrorInfo.statusCode }
    )
  }

  /**
   * 미리 정의된 에러 타입으로 응답 생성
   */
  respondWith(errorType: keyof typeof PREDEFINED_ERRORS, details?: Record<string, any>): NextResponse {
    const errorInfo = { ...PREDEFINED_ERRORS[errorType], details }
    return this.handleError(new Error(errorInfo.message), errorInfo)
  }

  /**
   * 커스텀 에러로 응답 생성
   */
  respondWithCustomError(
    userMessage: string,
    statusCode: number = 500,
    category: ErrorCategory = ErrorCategory.SYSTEM,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    details?: Record<string, any>
  ): NextResponse {
    const errorInfo: ErrorInfo = {
      category,
      severity,
      message: `Custom error: ${userMessage}`,
      userMessage,
      statusCode,
      details,
      shouldLog: true
    }
    
    return this.handleError(new Error(errorInfo.message), errorInfo)
  }
}

/**
 * 간편한 에러 핸들러 생성 함수
 */
export function createErrorHandler(endpoint: string, method: string, userId?: string): ApiErrorHandler {
  return new ApiErrorHandler({
    endpoint,
    method,
    userId,
    timestamp: new Date()
  })
}

/**
 * try-catch 블록을 위한 헬퍼 함수
 */
export async function withErrorHandling<T>(
  handler: ApiErrorHandler,
  operation: () => Promise<T>,
  requestData?: any
): Promise<T | NextResponse> {
  const startTime = Date.now()
  
  try {
    return await operation()
  } catch (error) {
    const responseTime = Date.now() - startTime
    return handler.handleError(error, undefined, requestData, responseTime)
  }
}