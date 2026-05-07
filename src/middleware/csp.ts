import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * CSP is enabled by default in production.
 * Set NEXT_STRICT_CSP=false to disable (not recommended in production).
 * Set NEXT_STRICT_CSP=true to enable in development.
 *
 * 정책 결정(2026-05-07): 콘텐츠 라우트를 정적 prerender로 전환하면서 요청별 nonce 발급이
 * 의미가 없어져 'nonce-X' / 'strict-dynamic' 정책을 'unsafe-inline'으로 복원.
 * Trade-off로 권장사항 점수가 -4 정도 떨어지지만 정적 cache hit으로 LCP/TTFB 큰 폭 개선.
 */
export function applyCSP(request: NextRequest, response: NextResponse) {
  const isProduction = process.env.NODE_ENV === 'production'
  const envOverride = process.env.NEXT_STRICT_CSP
  const enableStrictCsp = envOverride !== undefined ? envOverride === 'true' : isProduction

  if (!enableStrictCsp) {
    return response
  }

  try {
    const pathname = request.nextUrl.pathname
    // Skip CSP for editor pages which might need more permissive rules
    const isEditorPath = pathname.startsWith('/board/write') || /\/board\/.+\/edit$/.test(pathname)

    if (!isEditorPath) {
      const strictCsp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.google-analytics.com",
        "script-src-elem 'self' 'unsafe-inline' https://www.youtube.com https://www.google-analytics.com",
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
    }
  } catch (e) {
    console.error('CSP application failed:', e)
  }

  return response
}
