import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { buildCsp } from '@/config/cspPolicy'
import { getOfficeEditorOrigin } from '@work/lib/files/office-edit'

/**
 * Configure Content Security Policy (CSP)
 *
 * 호스트 허용 방식: 'self' + 'unsafe-inline' + 명시 호스트 허용목록
 * - 정적 prerender 호환 (nonce+strict-dynamic은 빌드/Edge 프로세스 분리로 성립 불가)
 * - Next.js 프레임워크 청크(/_next/static)는 'self'로 허용
 * - Next.js 인라인 hydration 스크립트는 'unsafe-inline'으로 허용
 * - 외부 스크립트는 https: 와일드카드가 아니라 호스트를 하나씩 적는다.
 *   현재 허용 대상은 토스 결제 SDK(https://js.tosspayments.com/v2/standard,
 *   서브도메인이 늘어날 수 있어 https://*.tosspayments.com)와 가입 화면의
 *   사람 확인 위젯(Cloudflare Turnstile, https://challenges.cloudflare.com)이다.
 *
 * 지시문의 정본은 src/config/cspPolicy.js다(next.config.js도 같은 함수를 쓴다).
 * 호스트를 더할 때는 그 파일만 고친다.
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

    const strictCsp = buildCsp({
      dev: process.env.NODE_ENV === 'development',
      officeOrigin: getOfficeEditorOrigin() || '',
      upgradeInsecure: shouldUpgradeInsecureRequests,
    })

    response.headers.set('Content-Security-Policy', strictCsp)
  } catch (e) {
    console.error('CSP application failed:', e)
  }

  return response
}
