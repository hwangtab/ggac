import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Configure Content Security Policy (CSP)
 *
 * 호스트 허용 방식: 'self' + 'unsafe-inline' + 명시 호스트 허용목록
 * - 정적 prerender 호환 (nonce+strict-dynamic은 빌드/Edge 프로세스 분리로 성립 불가)
 * - Next.js 프레임워크 청크(/_next/static)는 'self'로 허용
 * - Next.js 인라인 hydration 스크립트는 'unsafe-inline'으로 허용
 * - 외부 스크립트는 https: 와일드카드가 아니라 호스트를 하나씩 적는다.
 *   현재 허용 대상은 토스 결제 SDK(https://js.tosspayments.com/v2/standard,
 *   서브도메인이 늘어날 수 있어 https://*.tosspayments.com)뿐이다.
 *
 * ⚠️ 외부 스크립트 호스트를 추가할 때는 이 파일의 script-src/script-src-elem과
 *    next.config.js의 같은 두 지시문을 **함께** 고쳐라(scripts/testing/payments-csp.test.mjs가
 *    두 파일을 모두 검사한다). 빠뜨린 호스트는 에러 없이 조용히 차단된다.
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
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.tosspayments.com"
        : "script-src 'self' 'unsafe-inline' https://*.tosspayments.com",
      "script-src-elem 'self' 'unsafe-inline' https://*.tosspayments.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      process.env.NODE_ENV === 'development'
        ? "img-src 'self' https: http://localhost:* http://127.0.0.1:* blob: data:"
        : "img-src 'self' https: blob: data:",
      process.env.NODE_ENV === 'development'
        ? "media-src 'self' http://localhost:* http://127.0.0.1:* https://www.youtube.com"
        : "media-src 'self' https://www.youtube.com",
      // 토스 결제창은 iframe으로 뜬다. 빠지면 결제 버튼이 먹통이 된다.
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://*.tosspayments.com",
      process.env.NODE_ENV === 'development'
        ? "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* https://*.tosspayments.com"
        : "connect-src 'self' https://*.tosspayments.com",
      "object-src 'none'",
      "base-uri 'self'",
      // 결제창이 카드사 인증 페이지로 폼을 제출한다(next.config.js의 같은 항목 참고).
      "form-action 'self' https://*.tosspayments.com",
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
