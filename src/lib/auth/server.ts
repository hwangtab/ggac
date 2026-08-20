import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'

import { db } from '@/db/client'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { logger, maskId } from '@/utils/logger'

import { type AuthEmailKind, sendAuthEmail } from './email'
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
 * email이 다른 값으로 재시도되는 경우는 없다). 이 정확한 모양으로 실측
 * 확인(로컬 GoTrue v2.188.1, curl로 raw HTTP·SDK 양쪽 확인):
 *   - id·email이 완전히 같은 재시도 → 422
 *     `{"code":422,"error_code":"email_exists","msg":"..."}`, SDK에서는
 *     `error.code === 'email_exists'`, `error.status === 422`.
 *   - id는 같고 email만 다른 경우(우리는 이 모양으로 호출하지 않지만
 *     확인차 시도) → 이 GoTrue 버전은 이걸 검증 단계에서 안 걸러 raw
 *     Postgres 23505(`users_pkey` 위반)가 그대로 500으로 샌다 — 4xx가
 *     아니라 진짜 실패로 던져진다.
 *   - 이메일 형식이 잘못된 경우(무관한 검증 실패의 예) → 400
 *     `{"code":400,"error_code":"validation_failed","msg":"..."}`.
 * `@supabase/auth-js`의 `ErrorCode` 타입에는 `user_already_exists`도
 * 존재하지만, 이 호출 모양(명시적 id를 주는 admin.createUser)에서는
 * 재현되지 않았다 — 다른 경로(예: id 없이 만드는 일반 가입) 전용으로 보인다.
 *
 * 그래서 `error.code === 'email_exists'`만 "이미 준비돼 있다"는 뜻으로 성공
 * 처리한다. status만으로 4xx를 뭉뚱그리면 이메일 형식 오류 같은 진짜 검증
 * 실패도 조용히 삼켜버려서, 뒤이은 프로필 upsert가 FK 위반으로 실패했을 때
 * 로그가 진짜 원인이 아니라 엉뚱한 FK를 가리키게 된다 — 그 외 모든 에러(다른
 * 4xx, 5xx, 네트워크 실패 등)는 그대로 던져 훅의 기존 catch로 넘긴다.
 */
async function ensureSupabaseAuthShadowUser(id: string, email: string): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    email_confirm: true,
  })
  if (!error) return
  if (error.code === 'email_exists') return
  throw error
}

/**
 * 인증 메일에 넣을 링크의 도메인 기준(base URL)을 고른다. 없으면 던진다.
 *
 * 예전 코드는 `NEXT_PUBLIC_SITE_URL || BETTER_AUTH_URL || ''`로, 둘 다
 * 없으면 빈 문자열로 조용히 폴백했다 — 그러면 메일에
 * `href="/reset-password?token=..."`처럼 스킴·호스트 없는 상대 경로가 그대로
 * 나간다. 받은 편지함에서는 열리지 않는 링크인데도 아무 로그가 안 남는다 —
 * "메일이 안 나감"보다 나쁘다(회원은 링크를 봤는데 왜 안 되는지 알 방법이
 * 없다). 이제는 여기서 던져 훅의 `[auth]` 로그 경로로 드러낸다.
 *
 * 주의: 이 우선순위(`NEXT_PUBLIC_SITE_URL` 우선)는 아래 `betterAuth({
 * baseURL: ... })`의 우선순위(`BETTER_AUTH_URL` 우선)와 **반대**다. 두 값이
 * 다르게 설정된 환경(드물지만 가능)에서는 Better Auth 자신의 baseURL과
 * 메일에 박히는 도메인이 서로 다른 호스트를 가리킬 수 있다는 뜻이다. Better
 * Auth는 그 상황에서도 정상 부팅되므로 여기서 따로 던지지 않으면 아무도
 * 눈치채지 못한다 — 리뷰에서 지적된 비대칭이라 순서를 바꾸지 않고 그대로
 * 기록만 남긴다(둘 다 명시적으로 설정되면 일치시키는 편이 더 안전하다).
 */
function resolveEmailLinkBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL
  if (!base) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL과 BETTER_AUTH_URL이 둘 다 비어 있어 인증 메일 링크의 도메인을 만들 수 없습니다.'
    )
  }
  return base
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
  emailAndPassword: {
    enabled: true,
    // 2b-2(화면 배선)까지 공개 가입을 막는다. 옵션명은
    // node_modules/@better-auth/core/dist/types/init-options.d.mts의
    // `emailAndPassword.disableSignUp?: boolean`에서 확인했다.
    //
    // 왜 막는가: 이 브랜치는 "배선"만 하는 단계라 화면 4개 중 어느 것도 아직
    // Better Auth 가입을 호출하지 않는다. 그런데 Vercel에
    // TURSO_*·BETTER_AUTH_SECRET이 채워지는 순간
    // POST /api/auth/sign-up/email이 인증 없이 누구에게나 열려, 임의
    // 이메일로 user+account+member_profiles(pending) 행이 생기고
    // noreply@ggac.kr에서 실제 메일이 나간다. 방어막인 Better Auth 기본
    // rate limit은 storage: "memory"라 서버리스 인스턴스별로 흩어져
    // 사실상 무방비고(이 저장소 CLAUDE.md가 자체 리미터에 금지한 바로 그
    // 폴백 형태), 그렇게 생긴 행은 Supabase를 읽는 관리자 승인 화면에
    // 안 보여 조용히 쌓이며 2b-2 이관 데이터를 오염시킨다.
    //
    // 2b-2에서 반드시 할 일: 가입 화면을 Better Auth에 연결하는 커밋에서
    // 이 줄을 지우거나 false로 바꿔라. 그 전까지 disableSignUp이 켜진
    // 채로는 sign-up/email 라우트가 항상 400
    // EMAIL_PASSWORD_SIGN_UP_DISABLED를 반환한다(node_modules/better-auth/
    // dist/api/routes/sign-up.mjs:144) — "가입이 안 된다"는 버그가 아니라
    // 의도된 상태다. scripts/auth/verify-wiring.mjs도 이 상태를 감지해
    // 안내만 하고 실패로 취급하지 않는다.
    disableSignUp: true,
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

            // (2) buildMemberProfileRow는 Postgres 컬럼명(snake_case)의 키를
            // 돌려준다. 승인 화면(admin/members)이 Supabase의 member_profiles를
            // 읽으므로(콘텐츠 이관 전까지 Supabase가 권위), 여기서도 Supabase에
            // 직접 업서트한다 — Turso에 쓰면 새 가입자가 관리자에게 안 보인다.
            // 그 다음에야 이 upsert가 FK를 통과한다.
            const profile = buildMemberProfileRow({
              id: user.id,
              email: user.email,
              name: user.name,
            })
            const admin = createServiceRoleClient()
            const { error } = await admin
              .from('member_profiles')
              .upsert(profile as never, { onConflict: 'id' })
            if (error) throw error
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
