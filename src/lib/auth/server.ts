import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'

import { db } from '@/db/client'
import { memberProfiles, REGISTRATION_STATUS } from '@/db/schema/identity'
import { logger, maskId } from '@/utils/logger'

import { type AuthEmailKind, sendAuthEmail } from './email'
import { hashPassword, verifyPassword } from './password'
import { buildMemberProfileRow } from './profileHook'

/**
 * `buildMemberProfileRow`가 돌려주는 형태를 좁힌 타입.
 *
 * `buildMemberProfileRow`의 시그니처는 `Record<string, unknown>`이라, 만약
 * `as typeof memberProfiles.$inferInsert`로 곧장 캐스트하면 그 캐스트가 타입
 * 체크를 무조건 통과시켜버려서 매핑 필드를 실수로 빠뜨려도(예: displayName
 * 누락) 컴파일러가 못 잡는다 — 실제로 최초 구현에서 이 캐스트가 snake_case↔
 * camelCase 키 불일치 버그를 가려버렸다. 여기서 한 번 좁혀두면, 아래
 * `db.insert(memberProfiles).values({...})`는 캐스트 없이 구조적으로 검사되고
 * 필드 누락은 TS2769로 즉시 드러난다.
 */
type MemberProfileRow = {
  id: string
  email: string
  display_name: string
  registration_status: (typeof REGISTRATION_STATUS)[number]
  is_active: boolean
  is_admin: boolean
  is_director: boolean
  is_auditor: boolean
}

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
 * 로그에 안전하게 남길 수 있는 에러 메시지를 고른다.
 *
 * drizzle의 `DrizzleQueryError#message`는 `Failed query: ...\nparams: ...`
 * 형태로 **쿼리 바인딩 파라미터 전체**를 담는다 — member_profiles INSERT
 * 실패 시 email·display_name(실명일 수 있다) 등 개인정보가 그대로 로그에
 * 찍힌다는 뜻이다. 반면 `error.cause`는 DB 드라이버가 던진 원인 오류만
 * 담는다(예: `SQLITE_CONSTRAINT: UNIQUE constraint failed:
 * member_profiles.email`) — 원인 파악에는 충분하고 파라미터는 없다.
 *
 * `cause`가 없는 일반 `Error`도 있으므로(예: 순수 JS 예외) 그 경우엔
 * `error.message`로 안전하게 폴백한다.
 */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.cause instanceof Error) {
      return error.cause.message
    }
    return error.message
  }
  return String(error)
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
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmailLogged('recovery', user.email, url)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmailLogged('confirmation', user.email, url)
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  databaseHooks: {
    user: {
      create: {
        after: async user => {
          try {
            // buildMemberProfileRow는 Postgres 컬럼명(snake_case)의 키를 돌려준다.
            // memberProfiles(Drizzle 스키마)는 JS 필드명(camelCase)으로 값을 받는다
            // (컬럼명 자체는 스키마 정의에서 이미 snake_case로 매핑돼 있다). 두 키
            // 체계가 달라 그대로 넘기면 displayName 등이 채워지지 않고 NOT NULL
            // 제약으로 INSERT가 실패한다 — 여기서 명시적으로 옮겨 담는다.
            const profile = buildMemberProfileRow({
              id: user.id,
              email: user.email,
              name: user.name,
            }) as MemberProfileRow
            await db
              .insert(memberProfiles)
              .values({
                id: profile.id,
                email: profile.email,
                displayName: profile.display_name,
                registrationStatus: profile.registration_status,
                isActive: profile.is_active,
                isAdmin: profile.is_admin,
                isDirector: profile.is_director,
                isAuditor: profile.is_auditor,
              })
              // id 충돌만 무시한다(2b-2 이관 후 훅 재실행 시 중복 방어 목적).
              // target을 안 주면 SQLite는 PK뿐 아니라 email UNIQUE 인덱스
              // (member_profiles_email_idx) 충돌까지 통째로 삼켜버려서, 트리거가
              // 만들던 바로 그 "프로필 없는 사용자"를 예외도 로그도 없이
              // 재현한다 — 그래서 target을 id로 못박는다.
              .onConflictDoNothing({ target: memberProfiles.id })
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
