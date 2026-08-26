/**
 * 자체 가입 라우트 — Better Auth `POST /sign-up/email` + 조합원 프로필 7필드.
 *
 * 왜 이 라우트가 필요한가: `POST /sign-up/email`은 선언되지 않은 body 키를
 * 검증은 통과시키지만 `parseUserInput`이 `user.additionalFields`에 없는
 * 키를 조용히 버린다(node_modules/better-auth/dist/db/schema.mjs 실측).
 * `user.additionalFields`로 일곱 필드를 받으려면 `user` 테이블에 컬럼을
 * 더해야 하고, 그건 `member_profiles`와 중복이다. 그래서 이 라우트가
 * `signUpEmail`을 호출한 뒤 프로필을 직접 업서트한다.
 *
 * 순서: 레이트리밋 → registration_enabled 확인 → 입력 검증 →
 * `auth.api.signUpEmail`(Set-Cookie 확보) → 프로필 업서트(Turso) →
 * 응답에 Set-Cookie 전달.
 *
 * 단계 2b-6(Task 4)에서 `disableSignUp: true`가 제거돼 `signUpEmail`이 실제로
 * 계정을 만든다. 그 순간 `POST /api/auth/sign-up/email`이 인증 없이 공개되므로,
 * 직접 호출 봉쇄는 catch-all 라우트(`src/app/api/auth/[...all]/route.ts`)가
 * `ApiError.forbidden`으로 전담한다 — 조합원 7필드를 받는 정상 경로는 이
 * 라우트뿐이다.
 *
 * 가입 화면(`src/app/[locale]/signup/page.tsx`)은 이 라우트를 호출한다
 * (`fetch('/api/member-signup')`). Supabase `auth.signUp` 경로는 없다.
 */

import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth/server'
import { buildSignupProfileRow, isValidBirthDate } from '@/lib/auth/signupProfile'
import { safeErrorMessage } from '@/lib/auth/errorMessage'
import { getSystemSettings } from '@/middleware/settings'
import { upsertProfile, type UpsertProfileInput } from '@/db/queries/profiles'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError as HttpApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/member-signup')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 실측(로컬 스택, 2026-08-19): member_profiles.monthly_fee는
// CHECK (monthly_fee >= 10000 AND monthly_fee <= 50000). 컬럼 자체는
// nullable이라 값을 안 보내는 건 허용하지만, 보낸 값이 이 범위를 벗어나면
// DB가 23514로 거부한다 — 여기서 미리 걸러 500 대신 400을 준다.
const MONTHLY_FEE_MIN = 10000
const MONTHLY_FEE_MAX = 50000

/**
 * `auth.api.signUpEmail`이 던지는 better-call `APIError`/`ValidationError`는
 * 둘 다 `{ statusCode, body?: { code?, message? } }` 모양이다(둘이 같은
 * `APIError`를 상속하는 게 아니라 나란히 `InternalAPIError`를 상속하므로
 * `instanceof APIError`로는 `ValidationError`를 못 잡는다 —
 * node_modules/better-call/dist/error.mjs 실측). 그래서 타입 대신 모양으로
 * 판별한다.
 */
function isBetterAuthApiError(
  error: unknown
): error is { statusCode: number; message?: string; body?: { code?: string; message?: string } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  )
}

/**
 * Better Auth 에러의 `code`(안정적인 식별자 — node_modules/@better-auth/core/
 * dist/error/codes.mjs가 정의하는 문자열 키)를 한글 안내 문구로 매핑한다.
 * 메시지 문자열(`error.message`)로 매칭하지 않는다 — 버전이 바뀌면 조용히
 * 깨진다. 여기 없는 code는 GENERIC_SIGN_UP_ERROR_MESSAGE로 폴백하되, 원문은
 * (매핑 여부와 무관하게) 항상 로그에 남긴다 — 진단 정보를 버리지 않는다.
 *
 * USER_ALREADY_EXISTS류는 단순히 "이미 가입된 이메일입니다"로 끝내지 않는다
 * — 이 라우트가 만드는 계정은 프로필 upsert가 실패해도(202 경로) 그대로
 * 존재하므로, 재가입을 시도하는 사람은 프로필이 깨진 채로 방치된 자기 계정을
 * 다시 만들려는 것일 수 있다. 202 경로와 같은 톤으로 사무국 문의를 안내한다.
 */
const SIGN_UP_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_PASSWORD_SIGN_UP_DISABLED: '지금은 신규 가입을 받지 않습니다. 잠시 후 다시 시도해 주세요.',
  USER_ALREADY_EXISTS:
    '이미 가입된 이메일입니다. 이전 가입 시도가 끝까지 완료되지 않았을 수 있으니, 같은 이메일로 다시 가입하지 마시고 사무국으로 문의해 주세요.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    '이미 가입된 이메일입니다. 이전 가입 시도가 끝까지 완료되지 않았을 수 있으니, 같은 이메일로 다시 가입하지 마시고 사무국으로 문의해 주세요.',
  INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
  INVALID_PASSWORD: '비밀번호를 다시 확인해 주세요.',
  PASSWORD_TOO_SHORT: '비밀번호가 너무 짧습니다. 8자 이상 입력해 주세요.',
  PASSWORD_TOO_LONG: '비밀번호가 너무 깁니다.',
  FAILED_TO_CREATE_USER:
    '가입 처리 중 문제가 발생했습니다. 잠시 후 다시 시도하거나 사무국으로 문의해 주세요.',
  FAILED_TO_CREATE_SESSION:
    '계정은 생성되었지만 로그인 세션을 만드는 데 실패했습니다. 로그인 페이지에서 다시 로그인해 주세요.',
  VALIDATION_ERROR: '입력값을 다시 확인해 주세요.',
}

const GENERIC_SIGN_UP_ERROR_MESSAGE =
  '가입 처리 중 문제가 발생했습니다. 잠시 후 다시 시도하거나 사무국으로 문의해 주세요.'

export async function POST(request: NextRequest) {
  try {
    // 1) 레이트리밋 — 인증 없는 공개 엔드포인트다.
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.AUTH_API,
      keyGenerator: createIPKeyGenerator('member-signup'),
      message: '가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return HttpApiError.tooManyRequests(
        '가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'
      ).toNextResponse()
    }

    // 2) registration_enabled 확인. 지금은 화면(signup/page.tsx)에서만 보는
    // system_settings.registration_enabled를 서비스롤로 재확인한다.
    // fail-open(조회 실패 시 null)은 미들웨어 정책과 동일 — 설정 조회 장애가
    // 가입 자체를 막지 않는다.
    const settings = await getSystemSettings()
    if (settings && !settings.registrationEnabled) {
      return HttpApiError.forbidden('현재 신규 가입이 제한되어 있습니다.').toNextResponse()
    }

    // 3) 본문 검증.
    const body = await parseJsonObjectBody(request)
    if (!body) {
      return HttpApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''

    if (!email || !password || !displayName) {
      return HttpApiError.badRequest('이메일, 비밀번호, 표시명은 필수입니다.').toNextResponse()
    }

    const monthlyFeeRaw = body.monthly_fee
    if (monthlyFeeRaw !== undefined && monthlyFeeRaw !== null && monthlyFeeRaw !== '') {
      const monthlyFeeNumber = Number(monthlyFeeRaw)
      if (
        !Number.isInteger(monthlyFeeNumber) ||
        monthlyFeeNumber < MONTHLY_FEE_MIN ||
        monthlyFeeNumber > MONTHLY_FEE_MAX
      ) {
        return HttpApiError.badRequest(
          `월 회비는 ${MONTHLY_FEE_MIN.toLocaleString()}원 이상 ${MONTHLY_FEE_MAX.toLocaleString()}원 이하이어야 합니다.`
        ).toNextResponse()
      }
    }

    // birth_date는 실측(signupProfile.ts 참고)으로 nullable date 컬럼이라
    // 값이 없는 것 자체는 허용한다. 값이 있는데 형식이 틀리거나 존재하지 않는
    // 날짜(예: 2/31)면, 그걸 그대로 DB에 넘겨 500 계열로 실패시키는 대신
    // 여기서 400으로 걸러 어떤 필드가 문제인지 알려준다 — DB 실패로 뭉개면
    // 오타 하나가 "프로필 저장 실패, 사무국 문의"(202)로 확대된다.
    const birthDateRaw = body.birth_date
    if (birthDateRaw !== undefined && birthDateRaw !== null && birthDateRaw !== '') {
      if (typeof birthDateRaw !== 'string' || !isValidBirthDate(birthDateRaw)) {
        return HttpApiError.badRequest(
          '생년월일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로, 실제 존재하는 날짜를 입력해 주세요.'
        ).toNextResponse()
      }
    }

    // 4) Better Auth 가입. returnHeaders로 Set-Cookie를 받아야 가입 직후
    // 로그인 상태로 응답할 수 있다(node_modules/better-call/dist/endpoint.mjs 실측).
    let signUpHeaders: Headers
    let signedUpUser: { id: string; email: string }
    try {
      const result = await auth.api.signUpEmail({
        body: { email, password, name: displayName },
        returnHeaders: true,
      })
      signUpHeaders = result.headers
      signedUpUser = result.response.user
    } catch (error) {
      if (isBetterAuthApiError(error)) {
        const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 400
        const code = error.body?.code
        // 원문(영문)은 매핑 성공 여부와 무관하게 항상 로그에 남긴다 — 진단
        // 정보를 버리지 않는다. 화면에는 code로 찾은 한글 문구만 내려간다.
        const originalMessage = error.body?.message || error.message || String(error)
        log.warn(`[member-signup] signUpEmail 실패 code=${code ?? '(none)'}:`, originalMessage)
        const koreanMessage =
          (code && SIGN_UP_ERROR_MESSAGES[code]) || GENERIC_SIGN_UP_ERROR_MESSAGE
        return new HttpApiError(koreanMessage, statusCode).toNextResponse()
      }
      log.error('[member-signup] signUpEmail 실패:', safeErrorMessage(error))
      return HttpApiError.internalServerError('가입 처리 중 오류가 발생했습니다.').toNextResponse()
    }

    // 5) 프로필 업서트(7필드 포함, Turso) — databaseHooks.user.create.after
    // 훅이 이미 만든 pending/비활성 기본 행을 여기서 덮어쓴다. 실패해도 계정은 이미
    // 만들어졌으므로 가입 자체를 실패시키지 않고 로그로만 드러낸다(기존 훅의 정책과 동일).
    // `profileSaved`로 결과를 들고 있다가 6)에서 응답 문구·상태 코드를 가른다 —
    // 실패했는데도 "승인 후 이용하실 수 있습니다"라고 말하면, 저장되지 않은
    // 프로필에 대해 있지도 않을 승인을 기다리라고 회원을 오도하게 된다.
    let profileSaved = true
    try {
      const profile = buildSignupProfileRow({
        id: signedUpUser.id,
        email: signedUpUser.email,
        display_name: body.display_name,
        real_name: body.real_name,
        phone_number: body.phone_number,
        birth_date: body.birth_date,
        monthly_fee: body.monthly_fee,
        bank_name: body.bank_name,
        account_number: body.account_number,
        account_holder: body.account_holder,
      })
      await upsertProfile(profile as unknown as UpsertProfileInput)
    } catch (error) {
      profileSaved = false
      log.error(
        '[member-signup] 가입 후 member_profiles 업서트 실패:',
        maskId(signedUpUser.id),
        safeErrorMessage(error)
      )
    }

    // 6) 두 경우 모두 Set-Cookie는 그대로 응답에 싣는다 — Better Auth 계정과
    // 세션은 실제로 만들어졌으므로 로그인 상태 자체는 유효하다. 계정을 만들어
    // 놓고 로그인은 안 되게 하면 재가입을 유도해 이메일 중복 계정만 늘린다.
    //
    // 상태 코드는 프로필 저장 성공 여부로 가른다.
    // - profileSaved: 201 Created — 계정과 조합원 신청 정보가 둘 다 갖춰졌다.
    // - !profileSaved: 202 Accepted — "요청은 받아들여졌지만 처리가 끝나지
    //   않았다"는 HTTP 표준 의미 그대로 딱 들어맞는다. 계정(리소스) 자체는
    //   실제로 생겼으니 4xx로 감쌀 수 없고(거짓 실패), 신청 정보는 저장되지
    //   않았으니 201로 감쌀 수도 없다(거짓 성공). 문구에도 "승인"이라는 말을
    //   쓰지 않는다 — 프로필이 없으니 승인할 대상 자체가 없다. 재가입 시도는
    //   이메일 중복으로 막히므로(이 라우트 4단계) 재가입을 권하지 않고 사무국
    //   문의로 안내한다.
    //
    // 이 응답을 소비하는 쪽(단계 2b-6 화면)에 남기는 메모: `ApiSuccess`는
    // `success`를 항상 `true`로 고정한다(`src/utils/apiWrapper.ts`) — 공유
    // 래퍼를 이번 범위에서 고치지 않기로 했으므로, 202 응답도 `success: true`로
    // 나간다. 즉 `res.ok`나 `body.success`만 보고 "가입이 완료됐다"고 판단하면
    // 안 되고, 반드시 `data.profileSaved`를 읽어야 두 결과를 구분할 수 있다.
    const response = profileSaved
      ? ApiSuccess.created(
          { id: signedUpUser.id, email: signedUpUser.email, profileSaved: true },
          '가입이 완료되었습니다. 승인 후 이용하실 수 있습니다.'
        ).toNextResponse()
      : ApiSuccess.accepted(
          { id: signedUpUser.id, email: signedUpUser.email, profileSaved: false },
          '계정은 생성되었지만 조합원 정보 등록에 실패했습니다. 같은 이메일로 다시 가입하지 마시고, 사무국으로 문의해 주세요.'
        ).toNextResponse()
    signUpHeaders.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        response.headers.append('set-cookie', value)
      }
    })
    return response
  } catch (error) {
    log.error('[member-signup] 처리 중 오류:', safeErrorMessage(error))
    return HttpApiError.internalServerError('가입 처리 중 오류가 발생했습니다.').toNextResponse()
  }
}
