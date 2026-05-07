import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * 현재 정책: script-src/style-src에 'unsafe-inline' 사용. Lighthouse csp-xss 감사 -4점.
 *
 * Hash 기반 CSP는 시도해 봤으나 Next.js App Router의 streaming RSC 인라인 스크립트가
 * 빌드 ID와 webpack chunk 파일명을 본문에 임베드해 빌드마다 522±10개로 출렁이고,
 * postbuild에서 hash를 추출해도 middleware 번들은 그 전에 만들어지기 때문에 단일
 * 빌드 안에서 일관성 보장 불가. 두-pass 빌드는 가능하지만 비용 대비 4점이라 보류.
 *
 * Real nonce CSP는 layout.tsx의 await headers() 호출이 필요한데, 이는 모든 페이지를
 * dynamic으로 강제해 정적 prerender의 LCP/TTFB 이득을 잃게 됨. 보안 4점 vs 성능 trade-off
 * 에서 성능을 선택.
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
