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
 * id의 행을 여기 만들어둬야 그 FK들을 통과한다. 비밀번호도 세션도 만들지
 * 않는다 — Better Auth가 인증을 전담하고, 이 행은 오직 참조 무결성을 위해서만
 * 존재한다. 콘텐츠 이관이 끝나 Supabase를 걷어내면 이 껍데기도 함께 사라진다.
 *
 * 멱등이어야 한다 — 훅 재시도나 이중 실행에서 실패하면 안 된다. GoTrue
 * Admin `createUser`는 id·email이 이미 있으면 4xx(예: `422 email_exists`)를
 * 준다(실측 확인) — 그건 "이미 준비돼 있다"는 뜻이니 성공으로 친다. 4xx가
 * 아닌 에러(네트워크 실패, 5xx 등)는 진짜 실패이므로 그대로 던져 훅의 기존
 * catch로 넘긴다.
 */
async function ensureSupabaseAuthShadowUser(id: string, email: string): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    email_confirm: true,
  })
  if (!error) return
  const status = (error as { status?: number }).status
  if (typeof status === 'number' && status >= 400 && status < 500) return
  throw error
}

/**
 * `sendAuthEmail`을 감싸 실패를 로그에 남기고 다시 던진다.
 * 다시 던지는 이유는 `sendAuthEmail`의 "실패하면 던진다" 계약을 이 훅
 * 레벨에서도 유지하기 위해서다 — 상위(Better Auth)가 그 예외를 삼키더라도,
 * 우리가 로그로 남긴 사실 자체는 삼켜지지 않는다.
 */
async function sendAuthEmailLogged(kind: AuthEmailKind, to: string, url: string): Promise<void> {
  try {
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
      const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || ''
      await sendAuthEmailLogged('recovery', user.email, `${base}/reset-password?token=${token}`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, token }) => {
      const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || ''
      // callbackURL이 없으면 /verify-email이 리다이렉트 대신 JSON을 반환한다
      // (실측: email-verification.mjs:314-319). 확인 후 착지할 곳을 명시한다.
      const callback = encodeURIComponent('/auth/callback')
      await sendAuthEmailLogged(
        'confirmation',
        user.email,
        `${base}/api/auth/verify-email?token=${token}&callbackURL=${callback}`
      )
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
            // 이미 있으면(재시도 등) 4xx가 오는데 그건 성공으로 친다.
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
