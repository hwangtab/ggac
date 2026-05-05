/**
 * API 응답 처리 공통 래퍼 함수
 *
 * API 호출의 일관된 성공/실패 처리, 타입 안전성, 에러 핸들링을 제공합니다.
 * - 표준화된 응답 형식
 * - 자동 에러 처리 및 로깅
 * - TypeScript 타입 안전성
 * - 로딩 상태 통합
 */

import { NextResponse } from 'next/server'
import { createErrorHandler, ApiErrorHandler } from '@/utils/errorHandler'
import { createSuccessResponse, createErrorResponse } from '@/utils/apiResponse'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('apiWrapper')

// 표준 API 응답 타입 정의
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  meta?: {
    timestamp: string
    requestId?: string
    version?: string
  }
}

// API 성공 응답 타입
export interface ApiSuccessResponse<T = unknown> extends ApiResponse<T> {
  success: true
  data: T
}

// API 에러 응답 타입
export interface ApiErrorResponse extends ApiResponse {
  success: false
  error: string
}

// API 작업 옵션
export interface ApiOperationOptions {
  /** 요청 식별자 (로깅용) */
  requestId?: string
  /** 타임아웃 (밀리초) */
  timeout?: number
  /** 성공 시 커스텀 상태 코드 */
  successStatus?: number
  /** 성공 시 커스텀 메시지 */
  successMessage?: string
  /** 캐시 헤더 추가 여부 */
  cacheable?: boolean
  /** 캐시 최대 시간 (초) */
  maxAge?: number
  /** Cache-Control 헤더를 직접 지정 (cacheable/maxAge 보다 우선) */
  cacheControl?: string
  /** 추가 응답 헤더 */
  extraHeaders?: Record<string, string>
  /** CORS 허용 여부 */
  enableCors?: boolean
  /** 로깅 비활성화 */
  disableLogging?: boolean
}

/**
 * API 성공 응답 래퍼
 */
export class ApiSuccess<T = unknown> {
  constructor(
    public data: T,
    public message?: string,
    public statusCode: number = 200
  ) {}

  /**
   * NextResponse로 변환
   */
  toNextResponse(options: ApiOperationOptions = {}): NextResponse {
    const response: ApiSuccessResponse<T> = {
      success: true,
      data: this.data,
      message: this.message || options.successMessage,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: options.requestId,
        version: process.env.npm_package_version || '1.0.0',
      },
    }

    const headers: Record<string, string> = {}

    // 캐시 헤더 설정 (cacheControl > cacheable/maxAge > 기본 private no-store)
    //
    // 캐시 TTL 정책 가이드 (혼선을 방지하기 위해 한 곳에 명시):
    //   - 게시글 목록/상세: s-maxage=60, stale-while-revalidate=300 (라우트에서 직접)
    //   - 정적 이미지/asset: public, max-age=31536000, immutable
    //   - OG/이미지 프록시: public, max-age=86400 (1일)
    //   - 일반 cacheable API: max-age=3600 (1시간) — 본 옵션 기본값
    //   - 인증/사용자 응답: private, no-store + Vary: Cookie/Authorization (기본)
    if (options.cacheControl) {
      headers['Cache-Control'] = options.cacheControl
    } else if (options.cacheable) {
      headers['Cache-Control'] = `public, max-age=${options.maxAge || 3600}`
    } else {
      headers['Cache-Control'] = 'private, no-store'
      headers['Vary'] = 'Cookie, Authorization'
    }

    // CORS 헤더 설정
    if (options.enableCors) {
      headers['Access-Control-Allow-Origin'] = '*'
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    }

    if (options.extraHeaders) {
      Object.assign(headers, options.extraHeaders)
    }

    return createSuccessResponse(response, options.successStatus || this.statusCode, headers)
  }

  /**
   * 정적 생성자들
   */
  static ok<T>(data: T, message?: string): ApiSuccess<T> {
    return new ApiSuccess(data, message, 200)
  }

  static created<T>(data: T, message?: string): ApiSuccess<T> {
    return new ApiSuccess(data, message, 201)
  }

  static accepted<T>(data: T, message?: string): ApiSuccess<T> {
    return new ApiSuccess(data, message, 202)
  }

  static noContent(message?: string): ApiSuccess<null> {
    return new ApiSuccess(null, message, 204)
  }
}

/**
 * API 에러 응답 래퍼
 */
export class ApiError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * NextResponse로 변환
   * ⚠️ details는 항상 제거 — 내부 에러 정보가 클라이언트에 누출되는 보안 취약점 방지
   */
  toNextResponse(options: ApiOperationOptions = {}): NextResponse {
    const response: ApiErrorResponse = {
      success: false,
      error: this.message,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: options.requestId,
      },
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Authorization',
    }

    if (options.enableCors) {
      headers['Access-Control-Allow-Origin'] = '*'
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    }

    if (this.statusCode === 429) {
      headers['Retry-After'] = '60'
    }

    if (options.extraHeaders) {
      Object.assign(headers, options.extraHeaders)
    }

    return createErrorResponse(
      response as { success: false; error: string; [key: string]: unknown },
      this.statusCode,
      headers
    )
  }

  /**
   * 정적 생성자들
   */
  static badRequest(message: string = '잘못된 요청입니다.'): ApiError {
    return new ApiError(message, 400, 'BAD_REQUEST')
  }

  static unauthorized(message: string = '인증이 필요합니다.'): ApiError {
    return new ApiError(message, 401, 'UNAUTHORIZED')
  }

  static forbidden(message: string = '접근 권한이 없습니다.'): ApiError {
    return new ApiError(message, 403, 'FORBIDDEN')
  }

  static notFound(message: string = '요청한 리소스를 찾을 수 없습니다.'): ApiError {
    return new ApiError(message, 404, 'NOT_FOUND')
  }

  static methodNotAllowed(message: string = '허용되지 않은 HTTP 메서드입니다.'): ApiError {
    return new ApiError(message, 405, 'METHOD_NOT_ALLOWED')
  }

  static conflict(message: string = '리소스 충돌이 발생했습니다.'): ApiError {
    return new ApiError(message, 409, 'CONFLICT')
  }

  static unprocessableEntity(message: string = '요청 데이터를 처리할 수 없습니다.'): ApiError {
    return new ApiError(message, 422, 'UNPROCESSABLE_ENTITY')
  }

  static tooManyRequests(
    message: string = '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
  ): ApiError {
    return new ApiError(message, 429, 'TOO_MANY_REQUESTS')
  }

  static internalServerError(message: string = '서버 내부 오류가 발생했습니다.'): ApiError {
    return new ApiError(message, 500, 'INTERNAL_SERVER_ERROR')
  }

  static notImplemented(message: string = '구현되지 않은 기능입니다.'): ApiError {
    return new ApiError(message, 501, 'NOT_IMPLEMENTED')
  }

  static badGateway(message: string = '게이트웨이 오류가 발생했습니다.'): ApiError {
    return new ApiError(message, 502, 'BAD_GATEWAY')
  }

  static serviceUnavailable(message: string = '서비스를 일시적으로 사용할 수 없습니다.'): ApiError {
    return new ApiError(message, 503, 'SERVICE_UNAVAILABLE')
  }

  static gatewayTimeout(message: string = '게이트웨이 시간 초과입니다.'): ApiError {
    return new ApiError(message, 504, 'GATEWAY_TIMEOUT')
  }
}

/**
 * API 작업 래퍼 함수
 */
export async function withApiWrapper<T>(
  operation: () => Promise<T>,
  context: {
    endpoint: string
    method: string
    userId?: string
  },
  options: ApiOperationOptions = {}
): Promise<NextResponse> {
  const startTime = Date.now()
  const requestId =
    options.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  // 에러 핸들러 생성
  const errorHandler = createErrorHandler(context.endpoint, context.method, context.userId)

  try {
    // 타임아웃 설정
    let timeoutId: NodeJS.Timeout | null = null
    let operationPromise: Promise<T>

    if (options.timeout) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ApiError('요청이 시간 초과되었습니다.', 408, 'REQUEST_TIMEOUT'))
        }, options.timeout)
      })

      operationPromise = Promise.race([operation(), timeoutPromise])
    } else {
      operationPromise = operation()
    }

    // 작업 실행
    const result = await operationPromise

    // 타임아웃 클리어
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    const responseTime = Date.now() - startTime

    // 성공 로깅
    if (!options.disableLogging) {
      log.info(`[SUCCESS] ${context.method} ${context.endpoint} - ${responseTime}ms`, {
        requestId,
        userId: maskId(context.userId),
        responseTime,
      })
    }

    // 성공 응답 생성
    if (result instanceof ApiSuccess) {
      return result.toNextResponse({ ...options, requestId })
    }

    // 기본 성공 응답
    return new ApiSuccess(result, options.successMessage).toNextResponse({ ...options, requestId })
  } catch (error) {
    const responseTime = Date.now() - startTime

    // ApiError 처리
    if (error instanceof ApiError) {
      if (!options.disableLogging) {
        log.error(`[ERROR] ${context.method} ${context.endpoint} - ${responseTime}ms`, {
          requestId,
          userId: maskId(context.userId),
          error: error.message,
          statusCode: error.statusCode,
          responseTime,
        })
      }
      return error.toNextResponse({ ...options, requestId })
    }

    // 일반 에러를 에러 핸들러로 처리
    return errorHandler.handleError(error, undefined, undefined, responseTime)
  }
}

/**
 * HTTP 메서드별 래퍼 함수들
 */
export const apiGet = (
  operation: () => Promise<any>,
  endpoint: string,
  options: ApiOperationOptions & { userId?: string } = {}
) => withApiWrapper(operation, { endpoint, method: 'GET', userId: options.userId }, options)

export const apiPost = (
  operation: () => Promise<any>,
  endpoint: string,
  options: ApiOperationOptions & { userId?: string } = {}
) => withApiWrapper(operation, { endpoint, method: 'POST', userId: options.userId }, options)

export const apiPut = (
  operation: () => Promise<any>,
  endpoint: string,
  options: ApiOperationOptions & { userId?: string } = {}
) => withApiWrapper(operation, { endpoint, method: 'PUT', userId: options.userId }, options)

export const apiPatch = (
  operation: () => Promise<any>,
  endpoint: string,
  options: ApiOperationOptions & { userId?: string } = {}
) => withApiWrapper(operation, { endpoint, method: 'PATCH', userId: options.userId }, options)

export const apiDelete = (
  operation: () => Promise<any>,
  endpoint: string,
  options: ApiOperationOptions & { userId?: string } = {}
) => withApiWrapper(operation, { endpoint, method: 'DELETE', userId: options.userId }, options)

/**
 * 데이터 검증 래퍼
 */
export function validateApiInput<T>(
  data: any,
  validator: (data: any) => data is T,
  errorMessage: string = '입력 데이터가 유효하지 않습니다.'
): T {
  if (!validator(data)) {
    throw ApiError.badRequest(errorMessage)
  }
  return data
}

/**
 * 인증 검증 래퍼
 */
export function requireAuth(userId?: string): string {
  if (!userId) {
    throw ApiError.unauthorized('로그인이 필요합니다.')
  }
  return userId
}

/**
 * 관리자 권한 검증 래퍼
 */
export function requireAdmin(userRole?: string): void {
  if (userRole !== 'admin') {
    throw ApiError.forbidden('관리자 권한이 필요합니다.')
  }
}

/**
 * 리소스 소유자 검증 래퍼
 */
export function requireOwnership(userId: string, resourceOwnerId: string): void {
  if (userId !== resourceOwnerId) {
    throw ApiError.forbidden('리소스에 대한 접근 권한이 없습니다.')
  }
}

/**
 * 페이지네이션 파라미터 파싱
 */
export interface PaginationParams {
  page: number
  limit: number
  offset: number
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultLimit: number = 20,
  maxLimit: number = 100
): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(searchParams.get('limit') || defaultLimit.toString(), 10))
  )
  const offset = (page - 1) * limit

  return { page, limit, offset }
}

/**
 * 정렬 파라미터 파싱
 */
export interface SortParams {
  orderBy: string
  orderDirection: 'asc' | 'desc'
}

export function parseSortParams(
  searchParams: URLSearchParams,
  allowedFields: string[] = [],
  defaultOrderBy: string = 'created_at'
): SortParams {
  const orderBy = searchParams.get('orderBy') || defaultOrderBy
  const orderDirection = (searchParams.get('orderDirection') || 'desc') as 'asc' | 'desc'

  // 허용된 필드 검증
  if (allowedFields.length > 0 && !allowedFields.includes(orderBy)) {
    throw ApiError.badRequest(`정렬 필드 '${orderBy}'는 허용되지 않습니다.`)
  }

  // 정렬 방향 검증
  if (!['asc', 'desc'].includes(orderDirection)) {
    throw ApiError.badRequest('정렬 방향은 asc 또는 desc여야 합니다.')
  }

  return { orderBy, orderDirection }
}
