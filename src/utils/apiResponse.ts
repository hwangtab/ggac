/**
 * API 응답 헬퍼 유틸리티
 * 일관된 헤더와 응답 형식을 보장합니다.
 *
 * ⚠️ 신규 API 라우트는 이 모듈의 함수를 직접 호출하지 말고
 * `@/utils/apiWrapper`의 `ApiSuccess` / `ApiError` 클래스를 사용하세요.
 * 이 함수들은 wrapper 내부 구현/하위호환을 위해 유지됩니다.
 *
 * - createSuccessResponse({ url }) → 본문은 { success: true, url } (spread)
 * - ApiSuccess.ok({ url }).toNextResponse() → 본문은 { success: true, data: { url }, meta }
 *
 * 두 형식은 다르므로 라우트별로 일관성을 유지하세요.
 */

import { NextResponse } from 'next/server'

/**
 * JSON 응답 생성 헬퍼
 */
export function createJsonResponse<T = unknown>(
  data: T,
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store', // API 응답은 기본적으로 캐시하지 않음
    ...additionalHeaders,
  }

  return NextResponse.json(data, { status, headers })
}

/**
 * 성공 응답 생성
 */
export function createSuccessResponse<T = unknown>(
  data: T,
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
) {
  return createJsonResponse({ success: true, ...data }, status, additionalHeaders)
}

/**
 * 오류 응답 생성
 *
 * 메시지 문자열 또는 이미 구성된 에러 응답 본문을 받을 수 있다.
 * 객체 형태로 전달하면 `meta`/`code` 같은 부가 필드가 보존된다.
 */
export function createErrorResponse(
  errorOrBody: string | { success: false; error: string; [key: string]: unknown },
  status: number = 400,
  additionalHeaders: Record<string, string> = {}
) {
  const body =
    typeof errorOrBody === 'string' ? { success: false as const, error: errorOrBody } : errorOrBody
  return createJsonResponse(body, status, additionalHeaders)
}

/**
 * 이미지 응답 생성 헬퍼
 */
export function createImageResponse(
  buffer: Buffer,
  contentType: string,
  additionalHeaders: Record<string, string> = {}
) {
  const headers = {
    'Content-Type': contentType,
    'Content-Length': buffer.length.toString(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=86400',
    ...additionalHeaders,
  }

  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

/**
 * 캐시 가능한 응답 생성
 */
export function createCacheableResponse<T = unknown>(
  data: T,
  maxAge: number = 3600, // 1시간 기본값
  status: number = 200
) {
  return createJsonResponse(data, status, {
    'Cache-Control': `public, max-age=${maxAge}`,
  })
}

const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr'

/**
 * CORS 헤더 포함 응답 생성
 */
export function createCorsResponse<T = unknown>(
  data: T,
  status: number = 200,
  origin: string = ALLOWED_ORIGIN
) {
  return createJsonResponse(data, status, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
}

/**
 * 파일 다운로드 응답 생성
 */
export function createFileDownloadResponse(
  buffer: Buffer,
  filename: string,
  contentType: string = 'application/octet-stream'
) {
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length.toString(),
    'X-Content-Type-Options': 'nosniff',
  }

  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

/**
 * OPTIONS 요청 처리 (CORS preflight)
 */
export function createOptionsResponse(origin: string = ALLOWED_ORIGIN) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * 헬스체크 응답 생성
 */
export function createHealthCheckResponse() {
  return createJsonResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  })
}
