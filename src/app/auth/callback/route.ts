import { readSessionUser } from '@/lib/server/session'
import { getProfileById } from '@/db/queries/profiles'
import { manageUserSession } from '@/db/queries/sessions'
import { logUserActivity } from '@/db/queries/activities'
import { NextRequest, NextResponse, after } from 'next/server'
import { createLogger } from '@/utils/logger'

const log = createLogger('auth/callback')

const maskId = (id?: string | null): string => (id ? `${id.slice(0, 6)}…` : '<unknown>')
const SUPPORTED_LOCALES = ['ko', 'en'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const resolveSafeLocale = (value: string | null): SupportedLocale => {
  return SUPPORTED_LOCALES.some(locale => locale === value) ? (value as SupportedLocale) : 'ko'
}

const localizePath = (path: string, locale: SupportedLocale): string => {
  if (locale !== 'en') return path
  return path === '/' ? '/en' : `/en${path}`
}

const redirectToPath = (requestUrl: URL, path: string, locale: SupportedLocale): NextResponse => {
  return NextResponse.redirect(`${requestUrl.origin}${localizePath(path, locale)}`)
}

// open redirect 방지: 내부 경로 + 허용 목록만 통과
const ALLOWED_NEXT_PATHS: readonly string[] = ['/reset-password']
const resolveSafeNext = (next: string | null): string | null => {
  if (!next) return null
  // 절대 URL / 프로토콜 상대 경로 차단
  if (!next.startsWith('/') || next.startsWith('//')) return null
  // 쿼리·프래그먼트는 버리고 허용 목록의 순수 경로만 반환 (2차 리다이렉트 주입 방지)
  const pathOnly = next.split('?')[0].split('#')[0]
  return ALLOWED_NEXT_PATHS.includes(pathOnly) ? pathOnly : null
}

/**
 * Better Auth `/verify-email`의 `callbackURL`이 여기로 리다이렉트한다
 * (`src/lib/auth/server.ts`). Supabase 시절의 `?code=` 교환은 없다 — 이미
 * 로그인된 브라우저(가입 직후 세션이 있는 상태)가 이메일 인증 링크를 눌렀을
 * 때, 그 세션 쿠키를 읽어 조합원 승인 상태에 따라 목적지를 정한다.
 * 세션이 없으면(다른 브라우저에서 인증 링크를 열었거나 세션이 만료된 경우)
 * 로그인 페이지로 보낸다.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const locale = resolveSafeLocale(requestUrl.searchParams.get('locale'))

  try {
    // 비밀번호 복구 등: next가 허용 경로면 프로필 상태와 무관하게 우선 라우팅
    const safeNext = resolveSafeNext(requestUrl.searchParams.get('next'))
    if (safeNext) {
      return redirectToPath(requestUrl, safeNext, locale)
    }

    const user = await readSessionUser()

    if (user) {
      // 로그인 활동 로깅 — 쿼리 2건이 리다이렉트를 블로킹하지 않도록 응답 후
      // 실행한다(after). 실패해도 로그인 흐름에는 영향 없다(activities.ts/
      // sessions.ts 모듈 설명의 "뜨거운 경로" 원칙 — 여기서는 세션/로그인
      // 활동 기록이 부가 효과이고 리다이렉트가 본 작업이다).
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        '127.0.0.1'
      const userAgent = request.headers.get('user-agent') || 'Unknown'
      const sessionToken = `session_${user.id}_${Date.now()}`
      const callbackUrl = requestUrl.toString()

      after(async () => {
        try {
          // manageUserSession(start) 내부에서 유효 uuid(user_sessions.id)로
          // login 활동을 이미 기록하므로(sessions.ts), 이 명시적
          // logUserActivity는 callback_url 메타데이터 부착이 목적이다.
          // session_id는 uuid 컬럼이라 비-uuid sessionToken을 넘기면 FK/형식
          // 위반으로 조용히 실패했었다(코드리뷰 CONFIRMED, Supabase 시절
          // 22P02). null을 넘긴다.
          await manageUserSession(
            {
              user_id: user.id,
              session_token: sessionToken,
              action: 'start',
              ip_address: ip,
              user_agent: userAgent,
              metadata: {
                login_method: 'oauth',
                callback_url: callbackUrl,
                timestamp: new Date().toISOString(),
              },
            },
            sessionActivityError =>
              log.warn('세션 시작 활동 기록 실패', {
                message: (sessionActivityError as Error)?.message,
              })
          ).catch(sessionError =>
            log.warn('세션 시작 기록 실패', { message: (sessionError as Error)?.message })
          )

          try {
            await logUserActivity({
              user_id: user.id,
              action_type: 'login',
              target_type: 'system',
              target_id: null,
              metadata: {
                login_method: 'oauth',
                callback_url: callbackUrl,
                session_token: sessionToken,
                timestamp: new Date().toISOString(),
              },
              ip_address: ip,
              user_agent: userAgent,
              session_id: null, // was: sessionToken (비-uuid → 형식 위반)
            })
            log.info('로그인 활동 기록됨', { userId: maskId(user.id) })
          } catch (activityError) {
            log.warn('Login activity logging failed', {
              message: (activityError as Error)?.message,
            })
          }
        } catch (unexpectedError) {
          log.error('Login activity logging failed', unexpectedError)
        }
      })

      // 프로필의 권위는 Turso다(getProfileById). 이전 Supabase `.single()` 호출은
      // error를 검사하지 않고 `data: profile`만 봤다 — 즉 "행 없음"과 "조회
      // 자체가 실패함"을 구분하지 않고 둘 다 profile이 비어 아래 `!profile`
      // 분기(/register/pending)로 흘렀다. 여기서도 같은 결과가 되도록 조회
      // 실패를 삼켜 null로 합친다 — 이 라우트는 인가 경계가 아니라 로그인
      // 직후 목적지를 고르는 리다이렉트일 뿐이고(실제 승인·활성 검사는
      // requireActiveMember/requireAdmin/requireBoardMember가 매 API 요청마다
      // 다시 한다), /register/pending은 게시판·관리자 권한을 주지 않는
      // 안전한 목적지라 fail-closed 원칙에 어긋나지 않는다.
      let profile: Awaited<ReturnType<typeof getProfileById>> = null
      try {
        profile = await getProfileById(user.id)
      } catch (profileLookupError) {
        log.warn('Profile lookup failed', {
          userId: maskId(user.id),
          message: (profileLookupError as Error)?.message,
        })
      }

      if (!profile) {
        // Better Auth 가입 훅(databaseHooks.user.create.after)이 프로필을
        // 만든다 — 여기서 다시 만들지 않는다(단계 2b-5 `/api/member-signup`이
        // 그 책임을 갖는다). 훅이 실패했다면 관리자가 수동으로 복구한다.
        log.warn('Profile not found', { userId: maskId(user.id) })
        return redirectToPath(requestUrl, '/register/pending', locale)
      }

      if (profile.registration_status === 'pending') {
        // 승인 대기 중
        return redirectToPath(requestUrl, '/register/pending', locale)
      }

      if (profile.registration_status === 'approved' && profile.is_active) {
        // 승인된 조합원 - 게시판으로
        return redirectToPath(requestUrl, '/board', locale)
      }

      // 거절되었거나 비활성화된 경우
      return redirectToPath(requestUrl, '/register/rejected', locale)
    }
  } catch (error) {
    log.error('Auth callback error', error)
  }

  // 세션이 없거나 오류 발생 시 로그인 페이지로
  return redirectToPath(requestUrl, '/login', locale)
}
