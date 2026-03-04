/**
 * API 응답 헬퍼 유틸리티
 * 일관된 헤더와 응답 형식을 보장합니다.
 */

import { NextResponse } from 'next/server'

/**
 * JSON 응답 생성 헬퍼
 */
export function createJsonResponse(
  data: any, 
  status: number = 200, 
  additionalHeaders: Record<string, string> = {}
) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store', // API 응답은 기본적으로 캐시하지 않음
    ...additionalHeaders
  }

  return NextResponse.json(data, { status, headers })
}

/**
 * 성공 응답 생성
 */
export function createSuccessResponse(
  data: any, 
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
) {
  return createJsonResponse(
    { success: true, ...data }, 
    status, 
    additionalHeaders
  )
}

/**
 * 오류 응답 생성
 */
export function createErrorResponse(
  error: string, 
  status: number = 400,
  additionalHeaders: Record<string, string> = {}
) {
  return createJsonResponse(
    { success: false, error }, 
    status, 
    additionalHeaders
  )
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
    ...additionalHeaders
  }

  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

/**
 * 캐시 가능한 응답 생성
 */
export function createCacheableResponse(
  data: any,
  maxAge: number = 3600, // 1시간 기본값
  status: number = 200
) {
  return createJsonResponse(data, status, {
    'Cache-Control': `public, max-age=${maxAge}`
  })
}

const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr'

/**
 * CORS 헤더 포함 응답 생성
 */
export function createCorsResponse(
  data: any,
  status: number = 200,
  origin: string = ALLOWED_ORIGIN
) {
  return createJsonResponse(data, status, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
    'X-Content-Type-Options': 'nosniff'
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
      'Access-Control-Max-Age': '86400'
    }
  })
}

/**
 * 헬스체크 응답 생성
 */
export function createHealthCheckResponse() {
  return createJsonResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
}