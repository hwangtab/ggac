/**
 * API 에러 핸들링 유틸리티
 * 모든 API 라우트에서 일관된 JSON 응답을 보장
 */

import { NextRequest, NextResponse } from 'next/server'

export interface ApiError extends Error {
  statusCode?: number
  code?: string
}

/**
 * API 핸들러를 래핑하여 에러 발생 시 항상 JSON 응답을 반환
 */
export function withErrorHandler(
  handler: (req: NextRequest, params?: any) => Promise<NextResponse | undefined>
) {
  return async (req: NextRequest, params?: any): Promise<NextResponse> => {
    try {
      const result = await handler(req, params)
      if (!result) {
        throw new Error('핸들러가 응답을 반환하지 않았습니다.')
      }
      return result
    } catch (error) {
      console.error('API 에러:', error)

      // ApiError 타입인지 확인
      if (error instanceof Error && 'statusCode' in error) {
        const apiError = error as ApiError
        return NextResponse.json(
          {
            error: apiError.message,
            code: apiError.code || 'INTERNAL_ERROR',
          },
          { status: apiError.statusCode || 500 }
        )
      }

      // 일반 Error 처리
      if (error instanceof Error) {
        return NextResponse.json(
          {
            error: error.message || '서버 오류가 발생했습니다.',
            code: 'INTERNAL_ERROR',
          },
          { status: 500 }
        )
      }

      // 알 수 없는 에러 처리
      return NextResponse.json(
        {
          error: '알 수 없는 서버 오류가 발생했습니다.',
          code: 'UNKNOWN_ERROR',
        },
        { status: 500 }
      )
    }
  }
}

/**
 * 인증 에러 생성
 */
export function createAuthError(message: string = '인증이 필요합니다.'): ApiError {
  const error = new Error(message) as ApiError
  error.statusCode = 401
  error.code = 'AUTH_REQUIRED'
  return error
}

/**
 * 권한 에러 생성
 */
export function createForbiddenError(message: string = '권한이 없습니다.'): ApiError {
  const error = new Error(message) as ApiError
  error.statusCode = 403
  error.code = 'FORBIDDEN'
  return error
}

/**
 * Not Found 에러 생성
 */
export function createNotFoundError(message: string = '리소스를 찾을 수 없습니다.'): ApiError {
  const error = new Error(message) as ApiError
  error.statusCode = 404
  error.code = 'NOT_FOUND'
  return error
}

/**
 * Bad Request 에러 생성
 */
export function createBadRequestError(message: string = '잘못된 요청입니다.'): ApiError {
  const error = new Error(message) as ApiError
  error.statusCode = 400
  error.code = 'BAD_REQUEST'
  return error
}

/**
 * Rate Limit 에러 생성
 */
export function createRateLimitError(message: string = '요청이 너무 많습니다.'): ApiError {
  const error = new Error(message) as ApiError
  error.statusCode = 429
  error.code = 'RATE_LIMIT_EXCEEDED'
  return error
}
