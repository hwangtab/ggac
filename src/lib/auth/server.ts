import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'

import { db } from '@/db/client'
import { logger } from '@/utils/logger'

import { type AuthEmailKind, sendAuthEmail } from './email'
import { hashPassword, verifyPassword } from './password'

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
  plugins: [nextCookies()],
})
