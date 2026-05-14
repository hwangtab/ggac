import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cspNonce } from './csp-nonce'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * 단일 nonce 정책: 서버 시작 시 한 번 nonce 생성 → 모든 경로에서 공유.
 * - layout에서 headers() 불필요 → 정적 prerender 복원
 * - script-src에 'nonce-X' 적용 → 'unsafe-inline' 제거
 * - 서버 재시작 시 nonce 갱신 → 공격 창 제한
 */
export function applyCSP(_request: NextRequest, response: NextResponse) {
  const isProduction = process.env.NODE_ENV === 'production'
  const envOverride = process.env.NEXT_STRICT_CSP
  const enableStrictCsp = envOverride !== undefined ? envOverride === 'true' : isProduction

  if (!enableStrictCsp) {
    return response
  }

  try {
    const strictCsp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${cspNonce}' 'strict-dynamic' https: 'unsafe-inline'`,
      `script-src-elem 'self' 'nonce-${cspNonce}' 'strict-dynamic' https: 'unsafe-inline'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https: blob: data: https://*.supabase.co",
      "media-src 'self' https://www.youtube.com https://*.supabase.co",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      process.env.NODE_ENV === 'development'
        ? "connect-src 'self' http://localhost:* https://api.supabase.io https://*.supabase.co ws://localhost:* wss://localhost:* wss://*.supabase.co"
        : "connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      'report-uri /api/security/csp-report',
      'report-to default',
      ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
    ].join('; ')

    response.headers.set('Content-Security-Policy', strictCsp)
  } catch (e) {
    console.error('CSP application failed:', e)
  }

  return response
}
