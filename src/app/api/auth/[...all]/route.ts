import { NextRequest } from 'next/server'
import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'
import { ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'

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

/** 로그인 시도 경로인지 판별한다(크리덴셜 스터핑 방어 대상). */
function isSignInEmailPath(request: NextRequest): boolean {
  return request.nextUrl.pathname.endsWith('/sign-in/email')
}

/**
 * 비밀번호 재설정·인증메일 발송 경로인지 판별한다(메일 폭탄 방어 대상).
 * 세 엔드포인트 모두 "이메일 주소만 있으면" 메일을 발송시킬 수 있어 로그인보다
 * 더 낮은 한도가 필요하다.
 */
function isPasswordResetFlowPath(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  return (
    pathname.endsWith('/forget-password') ||
    pathname.endsWith('/send-verification-email') ||
    pathname.endsWith('/reset-password')
  )
}

/**
 * 비밀번호 재설정·인증메일 발송용 레이트리밋(10분당 5회, IP 기준).
 *
 * Better Auth 기본 리미터는 인스턴스별 메모리 저장소라 Vercel 같은 분산
 * 환경에서는 인스턴스마다 카운터가 따로 놀아 사실상 무제한이다(CLAUDE.md
 * "Rate Limiting" 참고). 이 저장소의 다른 보호 라우트와 동일하게
 * `distributedRateLimiter`(Upstash Redis REST)를 쓴다. 로그인(AUTH_API,
 * 분당 10회)보다 한도를 더 좁게 잡은 이유는 메일 발송 자체가 비용이고,
 * 공격자가 남의 이메일로 재설정 메일을 반복 발송시키는 폭탄 공격에
 * 노출되기 때문이다.
 */
const PASSWORD_RESET_RATE_LIMIT = {
  name: 'auth_password_reset',
  windowMs: 10 * 60 * 1000, // 10분
  maxRequests: 5,
  message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  blockDuration: 30 * 60 * 1000, // 30분 차단
} as const

/**
 * `sign-up/email`을 HTTP로 직접 때리면 무조건 거부한다.
 *
 * 수정 라운드 1(조율자 실측): 레이트리밋(분당 10회)만으로는 막지 못했다 —
 * 그 한도 안에서 `POST /api/auth/sign-up/email`을 직접 세 번 때리면 세
 * 계정이 그대로 생겼고, `member_profiles`에는 `real_name`·`monthly_fee`
 * 등 7개 조합원 필드가 전부 빈 채로 들어갔다(이 엔드포인트는
 * `user.additionalFields`에 없는 body 키를 조용히 버린다 —
 * `/api/member-signup`의 파일 상단 주석 참고). 레이트리밋은 속도만
 * 늦출 뿐 막지 못하므로, 아예 열지 않는 쪽으로 바꿨다.
 *
 * **이 경로를 완전히 막아도 안전한 이유**: 이 앱에서 실제로 가입을
 * 완료시키는 두 경로 중 어느 쪽도 이 URL을 거치지 않는다.
 * - `src/app/[locale]/signup/page.tsx:260`은 `/api/member-signup`으로
 *   `fetch`한다 (`grep -rn "authClient.signUp" src/` → 0건, HTTP로
 *   `signUpEmail`을 호출하는 화면이 아예 없다).
 * - `/api/member-signup`(`src/app/api/member-signup/route.ts:169`)은
 *   `auth.api.signUpEmail()`을 **서버 프로세스 안에서 직접** 호출한다 —
 *   Better Auth가 내부적으로 같은 엔드포인트 로직을 실행하긴 하지만,
 *   그 호출은 이 `route.ts` 파일의 HTTP 핸들러를 거치지 않는다(Next.js
 *   라우팅 계층을 우회한 함수 호출이다). 그래서 여기서 HTTP 요청을
 *   막아도 `/api/member-signup`의 가입 흐름은 전혀 건드리지 않는다 —
 *   그 라우트의 레이트리밋·`registration_enabled` 검사는 원래 자리
 *   그대로 살아 있다(파일 상단 1)·2) 참고).
 *
 * **다음에 이 블록을 보는 사람에게**: "가입이 안 되는 버그"로 보고
 * 이 차단을 지우거나 우회하지 말 것. 이 URL로 들어오는 요청은 전부
 * 잘못된 경로(직접 API 호출, 오래된 북마크, 스캐너)이고, 정상적인 가입은
 * `/api/member-signup`을 통해서만 이뤄진다.
 *
 * **상태 코드는 403으로 고른다.** 존재 자체를 숨기는 404보다, "여긴 안
 * 되지만 가입은 가능하다"는 뜻을 명확히 전달하는 편이 낫다고 판단했다 —
 * 이 경로에 우연히 닿은(예: 오래된 클라이언트 코드, 스크립트) 사람이 "가입
 * 기능이 없다"고 오해하지 않고 `/signup`으로 갈 방법을 응답 메시지에서
 * 바로 읽을 수 있어야 한다. 429(레이트리밋)나 400(입력 오류)은 "다시
 * 시도하면 될 것 같다"는 오해를 주므로 쓰지 않는다.
 */
export async function POST(request: NextRequest) {
  if (isSignUpEmailPath(request)) {
    return ApiError.forbidden(
      '이 주소로는 가입할 수 없습니다. 가입 페이지(/signup)를 이용해 주세요.'
    ).toNextResponse()
  }

  // 로그인·비밀번호 재설정·인증메일에 IP 기준 분산 레이트리밋을 건다(위
  // PASSWORD_RESET_RATE_LIMIT 주석 참고). sign-up/email은 위에서 이미 전면
  // 차단되므로 여기 내려오지 않는다.
  if (isSignInEmailPath(request)) {
    const rl = await applyRouteRateLimit(request, {
      ...RATE_LIMITS.AUTH_API,
      keyGenerator: createIPKeyGenerator('auth_sign_in'),
    })
    if (!rl.success) {
      return rl.response ?? ApiError.tooManyRequests(RATE_LIMITS.AUTH_API.message).toNextResponse()
    }
  } else if (isPasswordResetFlowPath(request)) {
    const rl = await applyRouteRateLimit(request, {
      ...PASSWORD_RESET_RATE_LIMIT,
      keyGenerator: createIPKeyGenerator('auth_password_reset'),
    })
    if (!rl.success) {
      return (
        rl.response ?? ApiError.tooManyRequests(PASSWORD_RESET_RATE_LIMIT.message).toNextResponse()
      )
    }
  }

  return betterAuthPOST(request)
}
