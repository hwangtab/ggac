import { NextRequest } from 'next/server'
import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'
import { getSystemSettings } from '@/middleware/settings'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'

/**
 * Better Auth의 모든 엔드포인트를 노출한다.
 *
 * 기존 `/api/auth/logout`·`/api/auth/verify-session`은 더 구체적인 경로라
 * Next.js가 먼저 매칭하므로 그대로 살아 있다(Better Auth에 같은 이름
 * 엔드포인트가 없어 충돌하지 않는다). `/api/auth/reset-password`는 예전에
 * Better Auth의 같은 이름 엔드포인트(POST)를 그렇게 가리고 있었다 — 단계
 * 2b-6(재설정 화면을 Better Auth로 옮기며 실측)에서 그 Supabase 기반
 * 구버전 라우트(`src/app/api/auth/reset-password/route.ts`)를 지워 이제는
 * 이 catch-all이 `/reset-password`도 정상적으로 받는다.
 *
 * `toNextJsHandler`는 GET·POST·PATCH·PUT·DELETE 다섯을 돌려준다(실측:
 * `node_modules/better-auth/dist/integrations/next-js.d.mts`). 둘만 export하면
 * 나머지 메서드를 쓰는 엔드포인트가 405로 죽으므로 전부 내보낸다.
 */
const { GET, POST: betterAuthPOST, PATCH, PUT, DELETE } = toNextJsHandler(auth)

export { GET, PATCH, PUT, DELETE }

/**
 * `sign-up/email` 경로인지 판별한다. catch-all이라 `request.nextUrl.pathname`은
 * 항상 `/api/auth/`로 시작하므로 접미사만 본다.
 */
function isSignUpEmailPath(request: NextRequest): boolean {
  return request.nextUrl.pathname.endsWith('/sign-up/email')
}

/**
 * `sign-up/email` 경로에 자체 레이트리밋과 `registration_enabled` 검사를 건다.
 *
 * 단계 2b-6에서 `disableSignUp: true`(`src/lib/auth/server.ts`)를 지우는
 * 순간 `POST /api/auth/sign-up/email`이 인증 없이 공개된다. 이 라우트에는
 * Better Auth 기본 레이트리밋(storage: 'memory', 서버리스 인스턴스별로
 * 흩어져 분산 환경에서 사실상 무방비)만 있고 `registration_enabled` 검사는
 * 아예 없다. `/api/member-signup`(우리 자체 가입 라우트)에는 둘 다 있지만,
 * Better Auth의 기본 라우트를 직접 때리면 그 검사를 모두 건너뛰어 7개
 * 조합원 필드가 없는 반쪽 프로필이 생긴다.
 *
 * **선택: `hooks.before`가 아니라 이 catch-all의 POST를 감싼다.** 이유:
 * `hooks.before`는 Better Auth 엔드포인트 컨텍스트에 걸리므로,
 * `/api/member-signup`(`src/app/api/member-signup/route.ts`)이 HTTP 요청을
 * 거치지 않고 `auth.api.signUpEmail()`을 서버 안에서 직접 호출하는 경로에도
 * 함께 걸린다. 그 라우트는 이미 자체 레이트리밋(IP 기준)과
 * `registration_enabled` 검사를 먼저 마친 뒤 `signUpEmail`을 부르므로,
 * `hooks.before`가 같은 엔드포인트에 다시 걸리면 (1) 검사가 이중으로
 * 실행되고 (2) 프로그래매틱 호출에는 원본 `NextRequest`가 없어 IP 기반
 * 레이트리밋 키 생성이 실패하거나 엉뚱한 키로 떨어질 위험이 있다. 이
 * 라우트의 POST만 감싸면 **HTTP로 직접 이 경로를 때리는 요청만** 걸러지고,
 * 서버 내부에서 `auth.api`를 직접 부르는 `/api/member-signup` 흐름은
 * 전혀 건드리지 않는다 — 두 경로가 겹치지 않아 검증하기도 더 쉽다.
 */
export async function POST(request: NextRequest) {
  if (isSignUpEmailPath(request)) {
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.AUTH_API,
      keyGenerator: createIPKeyGenerator('better-auth-sign-up-email'),
      message: '가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return ApiError.tooManyRequests(
        '가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'
      ).toNextResponse()
    }

    // fail-open: 조회 실패 시 null → 가입을 막지 않는다(member-signup과 동일 정책).
    const settings = await getSystemSettings()
    if (settings && !settings.registrationEnabled) {
      return ApiError.forbidden('현재 신규 가입이 제한되어 있습니다.').toNextResponse()
    }
  }

  return betterAuthPOST(request)
}
