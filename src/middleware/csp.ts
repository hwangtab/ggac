import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * 하이브리드 정책:
 * - 에디터 경로(`/board/write`, `/board/:slug/edit`): 요청별 nonce 발급
 *   → 'nonce-X' 'strict-dynamic'으로 script-guard 인라인 스크립트 보호
 * - 그 외 경로: 'unsafe-inline' (정적 prerender 호환)
 *   → CDN edge 캐시 hit으로 LCP/TTFB 개선
 *
 * 왜 에디터만 nonce? 게시판 쓰기는 사용자 입력이 DOM에 삽입되는 경로라
 * XSS 방어막이 critical. 정적 콘텐츠 페이지는 캐시 이득을 우선.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function applyCSP(request: NextRequest, response: NextResponse) {
  const isProduction = process.env.NODE_ENV === 'production'
  const envOverride = process.env.NEXT_STRICT_CSP
  const enableStrictCsp = envOverride !== undefined ? envOverride === 'true' : isProduction

  if (!enableStrictCsp) {
    return response
  }

  try {
    const pathname = request.nextUrl.pathname
    const isEditorPath = pathname.startsWith('/board/write') || /\/board\/.+\/edit$/.test(pathname)

    if (isEditorPath) {
      // 에디터 경로: 요청별 nonce 발급 → 인라인 스크립트 보호
      const nonce = generateNonce()
      response.headers.set('x-nonce', nonce)
      request.headers.set('x-nonce', nonce)

      const strictCsp = [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
        `script-src-elem 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
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
    } else {
      // 정적 prerender 경로: nonce 없이 'unsafe-inline' (캐시 호환)
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
