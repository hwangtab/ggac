import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * CSP is enabled by default in production.
 * Set NEXT_STRICT_CSP=false to disable (not recommended in production).
 * Set NEXT_STRICT_CSP=true to enable in development.
 *
 * TODO(L1, 보안 강화): script-src/style-src의 'unsafe-inline'을 점진적으로 nonce 기반 정책으로 전환.
 *   1) middleware에서 요청별 base64 nonce 생성 → response 헤더(`x-nonce`)와 layout context에 노출.
 *   2) Next.js `next/script` 및 inline `<script>`에 `nonce` 속성을 주입. Next의 hydration script도
 *      `experimental.scriptLoader.nonce` 또는 NextResponse 헤더를 통해 nonce 적용.
 *   3) 외부 inline event handler(onclick 등)를 모두 제거하고 addEventListener 패턴으로 마이그레이션.
 *   4) CSS-in-JS (styled-components 등)에 nonce 지원 → style-src-elem 'unsafe-inline' 제거.
 *   5) 단계별 롤아웃: report-only 모드로 위반 사례 수집 후, 본 정책에 strict-dynamic + nonce 도입.
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
        // Scripts: unsafe-inline required for Next.js hydration inline scripts
        "script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.google-analytics.com",
        // Script elements fine-grained control
        "script-src-elem 'self' 'unsafe-inline' https://www.youtube.com https://www.google-analytics.com",
        // Styles: allow unsafe-inline for compatibility with CSS-in-JS libs and fonts
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
        // Resources
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' https: blob: data: https://*.supabase.co",
        "media-src 'self' https://www.youtube.com https://*.supabase.co",
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
        // Connect sources
        process.env.NODE_ENV === 'development'
          ? "connect-src 'self' http://localhost:* https://api.supabase.io https://*.supabase.co ws://localhost:* wss://localhost:* wss://*.supabase.co"
          : "connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        // Reporting
        'report-uri /api/security/csp-report',
        'report-to default',
        // Upgrade insecure requests in production
        ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
      ].join('; ')

      response.headers.set('Content-Security-Policy', strictCsp)
    }
  } catch (e) {
    // Ignore errors, let default headers apply
    console.error('CSP application failed:', e)
  }

  return response
}
