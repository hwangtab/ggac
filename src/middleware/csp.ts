import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Strict Content Security Policy (CSP)
 *
 * CSP is enabled by default in production.
 * Set NEXT_STRICT_CSP=false to disable (not recommended in production).
 * Set NEXT_STRICT_CSP=true to enable in development.
 *
 * 2026-05 nonce 도입: script-src의 'unsafe-inline' 제거.
 *   - 요청별 base64 nonce 생성 → response 헤더(`x-nonce`)로 layout/Script 컴포넌트에 노출
 *   - 'strict-dynamic'으로 nonce 부여된 스크립트가 로드한 후속 스크립트(예: Next.js dynamic
 *     chunks)도 자동 신뢰
 *   - style-src의 'unsafe-inline'은 유지 (Tailwind CSS-in-JS 잔재 + Next.js 이미지 플레이스홀더
 *     인라인 style 호환성). 추후 별도 작업으로 nonce화 가능.
 */

function generateNonce(): string {
  // Web Crypto API (Edge runtime 및 모든 모던 환경에서 사용 가능)
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
    // Skip CSP for editor pages which might need more permissive rules
    const isEditorPath = pathname.startsWith('/board/write') || /\/board\/.+\/edit$/.test(pathname)

    if (!isEditorPath) {
      const nonce = generateNonce()
      // 후속 단계에서 layout이 headers().get('x-nonce')로 읽어 <Script nonce>에 주입.
      response.headers.set('x-nonce', nonce)
      request.headers.set('x-nonce', nonce)

      const strictCsp = [
        "default-src 'self'",
        // Scripts: nonce + strict-dynamic. 'strict-dynamic'은 nonce된 스크립트가 로드한 후속
        // 스크립트(Next.js webpack chunks 등)도 신뢰하므로 별도 host allowlist 불필요.
        // 'unsafe-inline'은 nonce/strict-dynamic 미지원 구형 브라우저용 fallback (모던 브라우저는 무시).
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
        `script-src-elem 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
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
