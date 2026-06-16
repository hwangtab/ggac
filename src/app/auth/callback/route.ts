import { createSupabaseServer } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
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

const parseOptionalMonthlyFee = (value: unknown): number | null => {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^\d+$/.test(normalized.trim())) return null

  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const locale = resolveSafeLocale(requestUrl.searchParams.get('locale'))

  if (code) {
    const supabase = await createSupabaseServer()

    try {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

      // 코드 교환 실패(만료·무효 링크) 시 세션이 없으므로 로그인으로 보낸다.
      if (exchangeError) {
        log.warn('Code exchange failed', { message: exchangeError.message })
        return redirectToPath(requestUrl, '/login', locale)
      }

      // 비밀번호 복구 등: 교환 성공 후 next가 허용 경로면 프로필 상태와 무관하게 우선 라우팅
      const safeNext = resolveSafeNext(requestUrl.searchParams.get('next'))
      if (safeNext) {
        return redirectToPath(requestUrl, safeNext, locale)
      }

      // 사용자 프로필 확인
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // 로그인 활동 로깅
        try {
          const ip =
            request.headers.get('x-forwarded-for')?.split(',')[0] ||
            request.headers.get('x-real-ip') ||
            '127.0.0.1'
          const userAgent = request.headers.get('user-agent') || 'Unknown'

          // 1. 세션 시작 기록
          const sessionToken = `session_${user.id}_${Date.now()}`
          await supabase.rpc('manage_user_session', {
            p_user_id: user.id,
            p_session_token: sessionToken,
            p_action: 'start',
            p_ip_address: ip,
            p_user_agent: userAgent,
            p_metadata: {
              login_method: 'oauth',
              callback_url: requestUrl.toString(),
              timestamp: new Date().toISOString(),
            },
          })

          // 2. 로그인 활동 기록 (리포트용)
          await supabase.rpc('log_user_activity', {
            p_user_id: user.id,
            p_action_type: 'login',
            p_target_type: 'system',
            p_target_id: null,
            p_metadata: {
              login_method: 'oauth',
              callback_url: requestUrl.toString(),
              session_token: sessionToken,
              timestamp: new Date().toISOString(),
            },
            p_ip_address: ip,
            p_user_agent: userAgent,
            p_session_id: sessionToken,
          })

          log.info('로그인 활동 기록됨', { userId: maskId(user.id) })
        } catch (activityError) {
          log.error('Login activity logging failed', activityError)
        }

        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // 트리거가 실패한 경우 대비 - 프로필 생성 시도
          log.warn('Profile not found, attempting to create', { userId: maskId(user.id) })

          try {
            const { error: createError } = await supabase.from('member_profiles').insert({
              id: user.id,
              email: user.email || '',
              display_name: user.user_metadata?.display_name || user.email || 'Unknown',
              real_name: user.user_metadata?.real_name || null,
              phone_number: user.user_metadata?.phone_number || null,
              birth_date: user.user_metadata?.birth_date || null,
              monthly_fee: parseOptionalMonthlyFee(user.user_metadata?.monthly_fee),
              bank_name: user.user_metadata?.bank_name || null,
              account_number: user.user_metadata?.account_number || null,
              account_holder: user.user_metadata?.account_holder || null,
              registration_status: 'pending',
              is_active: false,
            })

            if (createError) {
              log.error('Profile creation failed', createError)
              // 프로필 생성에 실패해도 승인 대기 페이지로 이동 (관리자가 수동으로 처리 가능)
            } else {
              log.info('Profile created successfully', { userId: maskId(user.id) })
            }
          } catch (insertError) {
            log.error('Profile insertion error', insertError)
          }

          // 승인 대기 페이지로 바로 이동
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
  }

  // 오류 발생 시 로그인 페이지로
  return redirectToPath(requestUrl, '/login', locale)
}
