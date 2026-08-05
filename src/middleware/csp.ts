import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Content Security Policy (CSP)
 *
 * 호스트 허용 방식: 'self' + 'unsafe-inline' + https:
 * - 정적 prerender 호환 (nonce+strict-dynamic은 빌드/Edge 프로세스 분리로 성립 불가)
 * - Next.js 프레임워크 청크(/_next/static)는 'self'로 허용
 * - Next.js 인라인 hydration 스크립트는 'unsafe-inline'으로 허용
 */
export function applyCSP(request: NextRequest, response: NextResponse) {
  const isProduction = process.env.NODE_ENV === 'production'
  const envOverride = process.env.NEXT_STRICT_CSP
  const enableStrictCsp = envOverride !== undefined ? envOverride === 'true' : isProduction

  if (!enableStrictCsp) {
    return response
  }

  try {
    const shouldUpgradeInsecureRequests =
      process.env.NODE_ENV === 'production' && request.nextUrl.protocol === 'https:'

    const strictCsp = [
      "default-src 'self'",
      // dev에서 NEXT_STRICT_CSP=true로 strict CSP를 검증할 때도 Next dev 런타임
      // (eval 기반 HMR/react-refresh)이 죽지 않도록 'unsafe-eval'을 dev에만 허용.
      // 이것이 빠지면 dev에서 모든 페이지의 하이드레이션이 통째로 실패한다
      // (connect-src의 dev 분기와 동일한 패턴, CLAUDE.md 문서와 일치).
      process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:"
        : "script-src 'self' 'unsafe-inline' https:",
      "script-src-elem 'self' 'unsafe-inline' https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // 로컬 스택의 Storage는 http://127.0.0.1:54321에서 서빙된다
      process.env.NODE_ENV === 'development'
        ? "img-src 'self' https: http://localhost:* http://127.0.0.1:* blob: data: https://*.supabase.co"
        : "img-src 'self' https: blob: data: https://*.supabase.co",
      process.env.NODE_ENV === 'development'
        ? "media-src 'self' http://localhost:* http://127.0.0.1:* https://www.youtube.com https://*.supabase.co"
        : "media-src 'self' https://www.youtube.com https://*.supabase.co",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      process.env.NODE_ENV === 'development'
        ? "connect-src 'self' http://localhost:* http://127.0.0.1:* https://api.supabase.io https://*.supabase.co ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* wss://*.supabase.co"
        : "connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      'report-uri /api/security/csp-report',
      'report-to default',
      ...(shouldUpgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
    ].join('; ')

    response.headers.set('Content-Security-Policy', strictCsp)
  } catch (e) {
    console.error('CSP application failed:', e)
  }

  return response
}
