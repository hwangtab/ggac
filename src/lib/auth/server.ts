import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'

import { db } from '@/db/client'
import { upsertProfile, type UpsertProfileInput } from '@/db/queries/profiles'
import { logger, maskId } from '@/utils/logger'

import { type AuthEmailKind, sendAuthEmail } from './email'
import { resolveEmailLinkBaseUrl } from './emailBaseUrl'
import { safeErrorMessage } from './errorMessage'
import { hashPassword, verifyPassword } from './password'
import { buildMemberProfileRow } from './profileHook'

/**
 * Vercel 로그에서 grep하기 위한 고정 접두어.
 * `sendAuthEmail`이 던지는 예외는 Better Auth의 `runInBackgroundOrAwait()`가
 * 삼켜버려 가입/재설정 API 응답까지 전파되지 않는다(email.ts의 sendAuthEmail
 * JSDoc 참조). 그 라이브러리 로그(`Failed to run background task:`)에는
 * 수신자가 안 나오므로, 삼켜지기 전에 여기서 먼저 "누구에게 보내려다 실패했는지"
 * 남긴다.
 */
const AUTH_EMAIL_LOG_PREFIX = '[auth][email]'

/**
 * 이메일 로컬파트 앞 2자만 남기고 마스킹한다.
 * `src/utils/security.ts`의 `maskSecurityEmail` 관례(로컬파트 앞 2자 + `***` +
 * 도메인)를 따른다 — 그 함수는 파일 비공개(unexported)라 여기서는 같은 형태를
 * 별도로 둔다.
 */
function maskEmailForLog(email: string): string {
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart.slice(0, 2)}***@${domain}`
}

/**
 * `sendAuthEmail`을 감싸 실패를 로그에 남기고 다시 던진다.
 * 다시 던지는 이유는 `sendAuthEmail`의 "실패하면 던진다" 계약을 이 훅
 * 레벨에서도 유지하기 위해서다 — 상위(Better Auth)가 그 예외를 삼키더라도,
 * 우리가 로그로 남긴 사실 자체는 삼켜지지 않는다.
 *
 * `url`을 문자열이 아니라 `buildUrl` 콜백으로 받는다 — `resolveEmailLinkBaseUrl()`
 * 같은 URL 조립 자체가 던질 수 있는 경우까지 이 try 안에서 잡아 같은
 * `[auth][email]` 로그로 남기기 위해서다. 조립 실패를 호출부에서 미리
 * 처리해버리면 이 함수의 catch를 거치지 않아 로그가 하나도 안 남는다.
 */
async function sendAuthEmailLogged(
  kind: AuthEmailKind,
  to: string,
  buildUrl: () => string
): Promise<void> {
  try {
    const url = buildUrl()
    await sendAuthEmail(kind, to, url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      `${AUTH_EMAIL_LOG_PREFIX} 발송 실패 kind=${kind} to=${maskEmailForLog(to)}: ${message}`
    )
    throw error
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  // 기본 `generateId()`(@better-auth/core/dist/utils/id.mjs)는 32자 영숫자
  // 문자열을 만든다 — UUID가 아니다. `generateId: 'uuid'`는 sqlite 어댑터에서
  // `crypto.randomUUID()`로 대체된다(get-id-field.mjs 실측).
  //
  // 단계 2b-5에는 이게 필수였다 — 이 id가 Supabase auth.users(uuid, GoTrue가
  // v4 형식을 강제)와 member_profiles(uuid 컬럼)에 그대로 쓰였기 때문이다.
  // 단계 4 Task 5가 그림자 행을 걷어내면서 그 강제는 사라졌지만 **설정은
  // 그대로 둔다**: 이관된 기존 회원 23명의 id가 전부 uuid라, 컷오버 이후
  // 가입자만 32자 영숫자 id를 갖게 되면 두 형식이 섞인다. 최종 덤프를
  // Postgres로 되돌리는 복구 경로(id가 uuid 컬럼)도 그 순간 깨진다. Turso
  // 쪽 id 컬럼은 전부 `text('id')`라 어느 쪽이든 받지만, 형식을 하나로
  // 유지하는 편이 값이 있다.
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  emailAndPassword: {
    enabled: true,
    // 단계 2b-6(Task 4)에서 공개 가입을 연다. `disableSignUp: true`가 켜져
    // 있던 동안은 `POST /api/auth/sign-up/email`이 항상 400
    // EMAIL_PASSWORD_SIGN_UP_DISABLED를 반환했다(node_modules/better-auth/
    // dist/api/routes/sign-up.mjs:144).
    //
    // 그 줄을 지운 순간 이 라우트가 인증 없이 공개된다. Better Auth 기본
    // rate limit은 storage: "memory"라 서버리스 인스턴스별로 흩어져
    // 분산 환경에서 사실상 무방비이고(이 저장소 CLAUDE.md가 자체 리미터에
    // 금지한 바로 그 폴백 형태), `registration_enabled` 검사도 없어 관리자가
    // 신규 가입을 잠가도 이 라우트로는 계속 계정이 생긴다. 그래서 catch-all
    // 라우트(`src/app/api/auth/[...all]/route.ts`)의 POST가 `sign-up/email`
    // 경로에 한해 자체 레이트리밋과 `registration_enabled` 검사를 앞단에
    // 건다 — 그 파일의 주석에 왜 `hooks.before`가 아니라 이 방식을 골랐는지
    // 적어뒀다.
    minPasswordLength: 8,
    /**
     * 비밀번호를 재설정하면 그 사용자의 **기존 세션을 전부 지운다.**
     *
     * 이 옵션이 없으면 Better Auth는 세션을 손대지 않는다(실측:
     * `better-auth/dist/api/routes/password.mjs:172`이 이 플래그가 있을 때만
     * `deleteUserSessions`를 부른다). 즉 세션 쿠키를 탈취당한 회원이 그걸
     * 눈치채고 비밀번호를 바꿔도 **탈취된 세션은 만료(7일)까지 그대로 살아
     * 있었다.** 재설정은 바로 그 상황에서 쓰는 수단인데, 이 저장소에는 세션을
     * 일괄 취소하는 경로가 따로 없어서 사용자가 할 수 있는 대응이 하나도
     * 없었다(2026-09-01 감사).
     */
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    sendResetPassword: async ({ user, token }) => {
      // BA가 주는 url은 `${baseURL}/reset-password/${token}` 형태이고 baseURL은
      // `/api/auth`를 포함한다 — 우리 화면(`/[locale]/reset-password`)과 다르다.
      // token을 받아 우리가 직접 만든다(실측: password.mjs:80-86이 token을 넘긴다).
      await sendAuthEmailLogged('recovery', user.email, () => {
        const base = resolveEmailLinkBaseUrl()
        return `${base}/reset-password?token=${token}`
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, token }) => {
      // callbackURL이 없으면 /verify-email이 리다이렉트 대신 JSON을 반환한다
      // (실측: email-verification.mjs:314-319). 확인 후 착지할 곳을 명시한다.
      const callback = encodeURIComponent('/auth/callback')
      await sendAuthEmailLogged('confirmation', user.email, () => {
        const base = resolveEmailLinkBaseUrl()
        return `${base}/api/auth/verify-email?token=${token}&callbackURL=${callback}`
      })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // 단계 2b-6의 미들웨어가 요청마다 세션을 읽는다. getCookieCache는 이 옵션이
    // 켜져 있을 때만 동작하고, 켜져 있으면 DB 왕복 없이 세션을 준다.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  databaseHooks: {
    user: {
      create: {
        after: async user => {
          try {
            // 단계 4 Task 5 이전에는 이 앞에 Supabase 그림자 행 두 개
            // (`auth.users` 껍데기 + `member_profiles` 껍데기)를 만드는
            // 블록이 있었다. Supabase 쪽 FK 13개와 board_* 표가 아직 그
            // 행들을 참조했기 때문인데, 그 표들이 전부 Turso로 넘어오면서
            // 참조가 0이 됐다 — 그래서 통째로 걷어냈다. **Supabase에 이미
            // 쌓여 있는 그림자 행 자체는 컷오버 때 사람이 정리한다.**
            //
            // buildMemberProfileRow는 snake_case 키를 돌려준다
            // (`src/db/queries/profiles.ts`의 `upsertProfile`이 기대하는 입력
            // 모양과 같다).
            const profile = buildMemberProfileRow({
              id: user.id,
              email: user.email,
              name: user.name,
            })
            await upsertProfile(profile as unknown as UpsertProfileInput)
          } catch (error) {
            // Postgres 트리거(handle_new_user)는 이 실패를 EXCEPTION WHEN OTHERS로
            // 삼켜서 프로필 없는 사용자를 조용히 만들었다. 여기서는 로그로 드러낸다
            // — 다만 가입 자체를 실패시키지는 않는다.
            //
            // **던져도 계정은 남는다.** 이 훅은 `user` 행이 커밋된 **뒤**에
            // 실행된다(@better-auth/core의 `runWithTransaction`이 `pendingHooks`
            // 를 커밋 후에 돌린다 — dist/context/transaction.mjs:52~79). 여기서
            // 던지면 `signUpEmail`이 500으로 실패하지만 계정은 그대로 남아,
            // 회원은 "가입 실패"라고 읽고 재가입을 시도했다가 이메일 중복에
            // 막힌다. 계정을 남긴 채 사실대로 알리는 편이 낫다.
            //
            // 단계 4 Task 6b 전까지 이 주석의 "관리자가 복구할 수 있다"는
            // 사실이 아니었다 — 프로필 없는 계정은 어떤 화면에도 뜨지 않았다.
            // 이제 실제 경로가 셋이다.
            //   1. 회원에게: `/api/member-signup`이 202 + "사무국 문의" 안내.
            //   2. 자동: 이메일 인증 링크(`/auth/callback`)에서 프로필이 없으면
            //      승인 대기 프로필을 다시 만든다.
            //   3. 관리자: `GET/POST /api/admin/members/orphans` + 회원 관리
            //      화면 상단 경고 배너.
            logger.error(
              '[auth] 가입 후 member_profiles 생성 실패:',
              maskId(user.id),
              safeErrorMessage(error)
            )
          }
        },
      },
    },
  },
  plugins: [nextCookies()],
})
