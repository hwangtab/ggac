import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'

import { db } from '@/db/client'
import { upsertProfile, type UpsertProfileInput } from '@/db/queries/profiles'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { logger, maskId } from '@/utils/logger'

import { type AuthEmailKind, sendAuthEmail } from './email'
import { resolveEmailLinkBaseUrl } from './emailBaseUrl'
import { safeErrorMessage } from './errorMessage'
import { hashPassword, verifyPassword } from './password'
import { buildMemberProfileRow } from './profileHook'
import { isBenignShadowUserRetryError } from './shadowUserGuard'

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
 * `auth.users`에 같은 id의 껍데기 행을 만든다(없으면).
 *
 * public 스키마의 FK 13개(`member_profiles.id`·`.approved_by`,
 * `comment_likes`, `post_likes`, `notifications.user_id`/`.related_user_id`,
 * `user_activities`, `user_sessions`, `daily_activity_stats`, `profiles.id`,
 * `system_settings.updated_by`, `system_settings_history.changed_by`)가
 * `auth.users(id)`를 참조한다. Better Auth(Turso)가 만드는 사용자 id는
 * Supabase `auth.users`에 존재하지 않으므로, 프로필 upsert보다 먼저 같은
 * id의 행을 여기 만들어둬야 그 FK들을 통과한다.
 *
 * 이 행은 비밀번호도 세션도 없는 참조 무결성 전용 껍데기다 — Better Auth가
 * 인증을 전담한다. 다만 Supabase Auth 자체의 복구(recovery) 엔드포인트는
 * Supabase Auth를 걷어내기 전까지 이 행에 대해 계속 살아 있다. 컷오버 이후
 * Supabase 세션은 이 앱의 어떤 것도 인증하지 못하므로 실질 영향은 낮지만,
 * "이메일 확인·비밀번호 없음" 상태가 계속 안전하려면 최종 단계에서 Supabase
 * Auth를 실제로 폐기해야 한다 — 콘텐츠 이관이 끝나 Supabase를 걷어내면 이
 * 껍데기도 함께 사라진다.
 *
 * 멱등이어야 한다 — 훅 재시도나 이중 실행에서 실패하면 안 된다. 우리 호출은
 * 항상 같은 Better Auth 사용자의 같은 id+email로만 재시도된다(id가 같은데
 * email이 다른 값으로 재시도되는 경우는 없다). "이미 준비돼 있다"는 뜻의
 * 무해한 재시도인지 판정하는 로직은 `isBenignShadowUserRetryError`
 * (`./shadowUserGuard`)로 뺐다 — 그 판정 근거(GoTrue 실측 결과)도 그 파일에
 * 있다. 그 외 모든 에러(다른 4xx, 5xx, 네트워크 실패 등)는 그대로 던져 훅의
 * 기존 catch로 넘긴다.
 */
async function ensureSupabaseAuthShadowUser(id: string, email: string): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    email_confirm: true,
  })
  if (!error) return
  if (isBenignShadowUserRetryError(error)) return
  throw error
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
  // 단계 2b-5 실측(member-signup 라우트로 실제 `POST /sign-up/email`을 처음
  // 왕복시켜 발견): 기본 `generateId()`(@better-auth/core/dist/utils/id.mjs)는
  // 32자 영숫자 문자열을 만든다 — UUID가 아니다. 그런데 이 id는 그대로
  // (1) Supabase Auth Admin API의 `auth.users.id`(uuid, GoTrue가 v4 형식을
  // 강제)와 (2) `member_profiles.id`(uuid 컬럼, `auth.users(id)` FK)에 쓰인다.
  // 지정 없이 두면 가입 훅의 `ensureSupabaseAuthShadowUser`가 매번
  // "ID must conform to the uuid v4 format"로 실패하고, 뒤이은 프로필
  // upsert도 `22P02 invalid input syntax for type uuid`로 실패한다 — 계정만
  // 생기고 Supabase 쪽엔 아무 것도 안 남는 조용한 실패다.
  // `generateId: 'uuid'`는 sqlite 어댑터에서 `crypto.randomUUID()`로 대체된다
  // (get-id-field.mjs 실측). Turso 쪽 id 컬럼은 전부 `text('id')`라 포맷
  // 제약이 없어 안전하다(`src/db/schema/auth.ts`).
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
            // (1) FK 13개가 auth.users를 가리키므로, 같은 id의 껍데기를 먼저
            // 만든다. 비밀번호도 세션도 없다 — 오직 참조 무결성을 위한 행이다.
            // 재시도로 이미 있으면(GoTrue error.code === 'email_exists') 성공
            // 처리하고, 그 외 실패(진짜 검증 실패 등)는 그대로 던진다.
            await ensureSupabaseAuthShadowUser(user.id, user.email)

            // (2) buildMemberProfileRow는 snake_case 키를 돌려준다
            // (`src/db/queries/profiles.ts`의 `upsertProfile`이 기대하는 입력
            // 모양과 같다). 단계 2c(Task 3)부터 프로필의 권위는 Turso다 —
            // 여기서 Turso에 직접 업서트한다. **주의**: `/admin/members` 등
            // 나머지 `member_profiles` 라우트는 Task 3의 후속 작업(Step 7)이
            // 전환하기 전까지 여전히 Supabase를 읽는다 — 그 전환이 끝나기
            // 전에는 이 훅으로 가입한 신규 회원이 승인 화면에 보이지 않는다
            // (읽는 DB와 쓰는 DB가 갈렸으므로 당연한 과도기 증상이지 이 훅의
            // 결함이 아니다). Supabase 쪽 껍데기 행(위 1번)은 여전히 만든다 —
            // 다른 테이블(user_activities 등)의 FK가 아직 auth.users를
            // 가리키기 때문이다(단계 4에서 함께 걷어낸다).
            const profile = buildMemberProfileRow({
              id: user.id,
              email: user.email,
              name: user.name,
            })
            await upsertProfile(profile as unknown as UpsertProfileInput)
          } catch (error) {
            // Postgres 트리거(handle_new_user)는 이 실패를 EXCEPTION WHEN OTHERS로
            // 삼켜서 프로필 없는 사용자를 조용히 만들었다. 여기서는 로그로 드러낸다
            // — 다만 가입 자체를 실패시키지는 않는다. 계정은 이미 만들어졌고,
            // 프로필은 관리자가 복구할 수 있다.
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
