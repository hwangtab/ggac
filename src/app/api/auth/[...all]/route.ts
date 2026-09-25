import { NextRequest, NextResponse } from 'next/server'
import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'
import {
  EMAIL_NOT_VERIFIED_CODE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  isEmailVerificationEnforced,
  refusesUnverifiedLogin,
} from '@/lib/auth/emailVerificationGate'
import { normalizeLoginEmail } from '@/lib/auth/loginEmail'
import { getLoginVerificationSubject } from '@/db/queries/profiles'
import { ApiError } from '@/utils/apiWrapper'
import { logSecurityEvent } from '@/utils/security'
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
 * 이 요청이 `suffix` 엔드포인트를 향하는가.
 *
 * **두 경로를 모두 본다.** Better Auth의 라우터는 `new URL(request.url)`의
 * 경로로 엔드포인트를 고르는데(better-call `dist/router.mjs`), 이 파일은
 * 편의상 `request.nextUrl.pathname`을 읽어 왔다. 평소에는 같은 값이지만
 * 둘이 갈라지는 순간 **여기서 건너뛴 요청을 Better Auth는 처리한다** —
 * 이 관문이 뚫린 방식과 정확히 같은 종류의 어긋남이다. 한쪽이라도 그
 * 엔드포인트를 가리키면 관문을 건다(더 많이 붙잡는 쪽으로 틀린다).
 */
function targetsAuthEndpoint(request: NextRequest, suffix: string): boolean {
  if (request.nextUrl.pathname.endsWith(suffix)) return true
  try {
    return new URL(request.url).pathname.endsWith(suffix)
  } catch {
    return false
  }
}

/** `sign-up/email` 경로인지 판별한다. */
function isSignUpEmailPath(request: NextRequest): boolean {
  return targetsAuthEndpoint(request, '/sign-up/email')
}

/** 로그인 시도 경로인지 판별한다(크리덴셜 스터핑 방어 대상). */
function isSignInEmailPath(request: NextRequest): boolean {
  return targetsAuthEndpoint(request, '/sign-in/email')
}

/**
 * 비밀번호 재설정·인증메일 발송 경로인지 판별한다(메일 폭탄 방어 대상).
 * 세 엔드포인트 모두 "이메일 주소만 있으면" 메일을 발송시킬 수 있어 로그인보다
 * 더 낮은 한도가 필요하다.
 */
/**
 * 메일을 **발송시키는** 경로. 이메일 주소만 있으면 남의 편지함에 메일을 쏟을
 * 수 있어 가장 좁은 한도가 필요하다.
 *
 * `/request-password-reset`이 better-auth 1.6.26이 실제로 여는 주소다
 * (`authClient.requestPasswordReset()`이 이걸 부른다). `/forget-password`는
 * 옛 별칭이라 둘 다 본다 — 별칭만 보고 있으면 리밋이 아무것도 막지 못한다.
 */
function isPasswordResetRequestPath(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  return (
    pathname.endsWith('/request-password-reset') ||
    pathname.endsWith('/forget-password') ||
    pathname.endsWith('/send-verification-email')
  )
}

/**
 * 토큰을 **제출하는** 경로. 발송과 버킷을 나눈다 — 합쳐 두면 새 비밀번호를
 * 몇 번 잘못 입력한 사람이 발송 한도까지 소진해, 정작 메일을 다시 받지 못한
 * 채로 토큰이 만료된다.
 */
function isPasswordResetSubmitPath(request: NextRequest): boolean {
  return request.nextUrl.pathname.endsWith('/reset-password')
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
/**
 * 한도를 적용하되, **리미터 자체가 없을 때는 통과시킨다.**
 *
 * 분산 리미터는 운영에서 Upstash가 없거나 순단이면 쓰기 요청에 503을 준다.
 * 그 판단은 게시글 작성 같은 쓰기에는 옳지만 로그인에는 옳지 않다 — 선택
 * 환경변수 하나가 비어 있다는 이유로 **전 조합원이 로그인하지 못하는**
 * 전면 장애가 된다. Upstash는 CLAUDE.md가 선택으로 분류한 값이다.
 *
 * 그래서 429(진짜 한도 초과)만 막고, 503(리미터 없음·오류)은 통과시킨다.
 * 통과시켜도 무방비는 아니다 — better-auth 자체 리미터가 여전히 바닥을
 * 받치고, 리미터 부재는 부팅 시점에 이미 high 심각도로 기록된다.
 */
async function enforce(
  request: NextRequest,
  config: { name: string; windowMs: number; maxRequests: number; message?: string },
  prefix: string
) {
  const rl = await applyRouteRateLimit(request, {
    ...config,
    keyGenerator: createIPKeyGenerator(prefix),
  })
  if (rl.success) return null
  if (rl.response && rl.response.status !== 429) return null
  return (
    rl.response ??
    ApiError.tooManyRequests(config.message ?? '요청이 너무 많습니다.').toNextResponse()
  )
}

/**
 * better-call이 JSON으로 읽는 Content-Type. 정규식은 better-call
 * `dist/utils.mjs`의 `jsonContentTypeRegex`를 그대로 옮긴 것이다.
 */
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i

/**
 * 로그인 요청 본문에서 이메일을 **Better Auth가 읽는 것과 같은 방식으로** 꺼낸다.
 *
 * 예전에는 `request.clone().json()` 한 줄이었다. 그게 두 번째 우회로였다 —
 * `/sign-in/email`은 `allowedMediaTypes: ['application/x-www-form-urlencoded',
 * 'application/json']`으로 열려 있어(better-auth
 * `dist/api/routes/sign-in.mjs`) 폼 인코딩 본문으로도 정상 로그인이 된다.
 * 그런 요청에서 `.json()`은 예외를 던지고, 관문은 그 예외를 삼키고 통과시켰다.
 * 쿠키·Origin·Sec-Fetch-* 가 없는 요청은 Better Auth의 폼 CSRF 검사도 그냥
 * 지나간다(`dist/api/middlewares/origin-check.mjs`) — 즉 curl 한 줄이면
 * 관문이 아예 눈을 감았다.
 *
 * 그래서 두 형식을 **better-call과 같은 순서로** 읽는다. 그 밖의
 * Content-Type은 better-call이 415로 돌려보내므로 볼 필요가 없다.
 */
async function readSignInEmail(request: NextRequest): Promise<string> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  const baseType = contentType.split(';')[0].trim()

  if (JSON_CONTENT_TYPE.test(contentType)) {
    const body = await request.clone().json()
    return normalizeLoginEmail((body as Record<string, unknown> | null)?.email)
  }
  if (baseType.includes('application/x-www-form-urlencoded')) {
    const form = await request.clone().formData()
    return normalizeLoginEmail(form.get('email'))
  }
  return ''
}

/**
 * 이메일 인증 관문. 켜져 있으면 인증하지 않은 계정의 로그인을 **세션이
 * 만들어지기 전에** 돌려보낸다.
 *
 * 판정은 요청마다 설정을 읽어서 한다 — Better Auth의
 * `requireEmailVerification`은 모듈 로드 시점에 한 번 읽히는 값이라, 그걸
 * 쓰려면 부팅 때 Turso를 읽어야 하고 그 순간 DB 한 번 삐끗하면 사이트
 * 전체의 로그인이 함께 죽는다(`@/lib/auth/emailVerificationGate` 참고).
 *
 * ## 계정을 찾지 못하면 — 통과시킨다. 그리고 그게 왜 안전한가
 *
 * 처음엔 "찾지 못하면 통과"가 이 관문을 뚫은 원인처럼 보였다. 아니다.
 * 원인은 **관문과 Better Auth가 서로 다른 계정을 찾은 것**이다. 관문은
 * 받은 글자 그대로 찾고 Better Auth는 소문자로 접어 찾았으니,
 * `User@Example.com`은 관문에는 없는 계정이고 Better Auth에는 있는 계정이었다.
 *
 * 이제 두 조회가 **같은 함수로 같은 값을 만들어** 같은 행을 본다
 * (`normalizeLoginEmail` 참고). 그래서 관문이 못 찾은 주소는 Better Auth도
 * 못 찾고, 그 요청은 곧바로 401(자격 증명 오류)이 된다 — 통과시켜도 아무도
 * 들어오지 않는다.
 *
 * 반대로 **모르는 주소를 전부 막으면** 로그인 창이 계정 존재 여부를 알려
 * 주는 기계가 된다: 없는 주소는 403(인증 필요), 있고 인증된 주소는 401.
 * 비밀번호 없이 명부를 훑을 수 있게 되고, 얻는 것은 없다. 그래서 막지 않는다.
 *
 * ## 정말로 판정하지 못했을 때 — 통과시키되, 조용히 넘어가지 않는다
 *
 * 설정·프로필 조회가 **실패**하는 것은 다른 이야기다. 그때도 통과시킨다
 * (Turso가 흔들린다고 전 조합원이 문 앞에 서면 안 되고, 어차피 그 상태에서는
 * Better Auth도 인증하지 못한다). 다만 예전처럼 빈 `catch`로 삼키지 않고
 * 보안 로그를 남긴다 — 관문이 열려 있던 시간을 나중에 셀 수 있어야 한다.
 *
 * 돌려보내는 응답은 Better Auth의 오류 본문과 같은 모양(`{code, message}`)
 * 이다 — `authClient`가 그 JSON을 그대로 `error`에 실어 주므로 로그인 화면이
 * 두 경로를 따로 다루지 않아도 된다.
 */
async function refuseUnverifiedSignIn(request: NextRequest) {
  if ((await isEmailVerificationEnforced()) === false) return null

  let email = ''
  try {
    email = await readSignInEmail(request)
  } catch {
    // 본문을 읽지 못했다. Better Auth도 같은 형식을 같은 방식으로 읽으므로
    // 여기서 깨진 본문은 거기서도 400이 된다 — 통과시켜도 들어오지 않는다.
    return null
  }
  if (email === '') return null

  let subject
  try {
    subject = await getLoginVerificationSubject(email)
  } catch (error) {
    logSecurityEvent(
      'EMAIL_VERIFICATION_GATE_FAILED_OPEN',
      { reason: 'lookup_failed', error: error instanceof Error ? error.message : String(error) },
      'high'
    )
    return null
  }

  if (refusesUnverifiedLogin(subject) === false) return null

  return NextResponse.json(
    { code: EMAIL_NOT_VERIFIED_CODE, message: EMAIL_NOT_VERIFIED_MESSAGE },
    { status: 403 }
  )
}

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
    const blocked = await enforce(request, RATE_LIMITS.AUTH_API, 'auth_sign_in')
    if (blocked) return blocked
    const unverified = await refuseUnverifiedSignIn(request)
    if (unverified) return unverified
  } else if (isPasswordResetRequestPath(request)) {
    const blocked = await enforce(request, PASSWORD_RESET_RATE_LIMIT, 'auth_password_reset')
    if (blocked) return blocked
  } else if (isPasswordResetSubmitPath(request)) {
    const blocked = await enforce(request, PASSWORD_RESET_RATE_LIMIT, 'auth_password_reset_submit')
    if (blocked) return blocked
  }

  return betterAuthPOST(request)
}
