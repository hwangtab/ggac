'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase/client'
import { useStablePageLoad, useSafeNavigation } from '@/utils/routeProtection'
import { toSafeInternalRedirectPath } from '@/utils/safeUrl'
import { fetchSessionProfile, type VerifiedSessionUser } from '@/utils/sessionProfile'

type MessageType = 'error' | 'warning' | 'success' | 'loading'

export default function LoginPage() {
  const t = useTranslations('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<MessageType>('error')
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false)
  // 방금 로그인에 성공해 머무는 경우와, 이미 로그인된 채 페이지에 진입한 경우를 구분한다.
  const [justAuthenticated, setJustAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState<
    (VerifiedSessionUser & { profile?: { display_name?: string | null } }) | null
  >(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoading: pageLoading, isReady } = useStablePageLoad('/login')
  const { navigateWithRetry } = useSafeNavigation()
  // redirect 파라미터가 명시된 경우에만 자동 이동한다. 없으면 빈 문자열 → 자동 이동하지 않음.
  const explicitRedirectPath = toSafeInternalRedirectPath(searchParams.get('redirect'), '')
  const hasExplicitRedirect = explicitRedirectPath !== ''
  const authRedirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setMsg = (msg: string, type: MessageType) => {
    setMessage(msg)
    setMessageType(type)
  }

  const clearAuthRedirectTimer = () => {
    if (authRedirectTimerRef.current) {
      clearTimeout(authRedirectTimerRef.current)
      authRedirectTimerRef.current = null
    }
  }

  // 모바일 디바이스 감지 함수 (waitForAuthStateAndRedirect에서 사용)
  const isMobileDeviceForAuth = () => {
    if (typeof window === 'undefined') return false

    const userAgent = window.navigator.userAgent.toLowerCase()
    const mobileKeywords = [
      'android',
      'iphone',
      'ipod',
      'ipad',
      'blackberry',
      'windows phone',
      'mobile',
    ]

    return (
      mobileKeywords.some(keyword => userAgent.includes(keyword)) ||
      window.innerWidth <= 768 ||
      'ontouchstart' in window
    )
  }

  // 페이지 로드 시 현재 인증 상태 확인
  useEffect(() => {
    let mounted = true

    const checkAuthStatus = async () => {
      try {
        const session = await fetchSessionProfile()

        if (mounted && session.user) {
          setIsAlreadyLoggedIn(true)
          setCurrentUser({ ...session.user, profile: session.profile ?? undefined })
        }
      } catch (error) {
        console.error('인증 상태 확인 중 오류:', error)
      }
    }

    checkAuthStatus()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return clearAuthRedirectTimer
  }, [])

  // 안전한 리다이렉트 함수 (모바일 최적화 버전)
  const waitForAuthStateAndRedirect = async () => {
    try {
      setMsg(t('login.msgLoggingIn'), 'loading')

      const isMobile = isMobileDeviceForAuth()

      // 모바일에서는 더 긴 재시도 로직 (네트워크 불안정성 고려)
      let session: Awaited<ReturnType<typeof fetchSessionProfile>> | null = null
      let retries = 0
      const maxRetries = isMobile ? 5 : 3
      const retryDelay = isMobile ? 500 : 200

      while (retries < maxRetries) {
        // 로그인 직후 확인 — 로그인 전의 미인증 캐시(30초 TTL)를 읽으면 안 되므로 강제 재검증
        const currentSession = await fetchSessionProfile({ force: true })

        if (currentSession.user) {
          session = currentSession
          break
        }

        retries++
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }

      // redirect 파라미터가 명시된 경우에만 자동 이동하고,
      // 그렇지 않으면 로그인 완료 상태 화면으로 전환해 이동은 사용자에게 맡긴다.
      const redirectOrStay = (verifiedSession: Awaited<ReturnType<typeof fetchSessionProfile>>) => {
        if (hasExplicitRedirect) {
          // 사용자가 원래 가려던 페이지로만 자동 이동 (이동 안내 배너 표시)
          setMsg(t('login.msgVerified'), 'success')
          const redirectDelay = isMobile ? 800 : 300
          clearAuthRedirectTimer()
          authRedirectTimerRef.current = setTimeout(() => {
            navigateWithRetry(explicitRedirectPath, isMobile ? 5 : 3)
            authRedirectTimerRef.current = null
          }, redirectDelay)
          return
        }

        // 자동 이동 없음: 이동 안내 배너 없이 로그인 성공 카드로 전환하고 이동은 사용자에게 맡긴다
        if (verifiedSession?.user) {
          setMessage('')
          setJustAuthenticated(true)
          setIsAlreadyLoggedIn(true)
          setCurrentUser({
            ...verifiedSession.user,
            profile: verifiedSession.profile ?? undefined,
          })
        }
      }

      if (!session) {
        // 세션 read-back에 실패했지만 로그인 자체는 성공한 상태.
        // redirect가 있으면 라우팅해 미들웨어로 판정을 위임하고,
        // 없으면 폼에 머무는 dead-end 대신 로그인 성공 카드로 전환해 사용자가 직접 이동하게 한다.
        if (hasExplicitRedirect) {
          navigateWithRetry(explicitRedirectPath, isMobile ? 5 : 3)
        } else {
          setMessage('')
          setJustAuthenticated(true)
          setIsAlreadyLoggedIn(true)
        }
        return
      }

      // 프로필이 있으면 상태에 맞춰 처리
      const profile = session.profile

      if (profile && profile.registration_status === 'approved' && profile.is_active) {
        redirectOrStay(session)
      } else if (profile && profile.registration_status === 'pending') {
        setMsg(t('login.msgPending'), 'loading')
        router.push('/register/pending')
      } else if (profile && profile.registration_status === 'rejected') {
        setMsg(t('login.msgRejected'), 'error')
        router.push('/register/rejected')
      } else {
        // 프로필이 불명확한 경우에도 자동 이동 없이 동일하게 처리
        redirectOrStay(session)
      }
    } catch (error) {
      console.error('로그인 후 인증 상태 확인 중 오류:', error)
      setMsg(t('login.msgAuthError'), 'error')
      // 에러 발생 시 3초 후 홈으로 이동
      clearAuthRedirectTimer()
      authRedirectTimerRef.current = setTimeout(() => {
        router.push('/')
        authRedirectTimerRef.current = null
      }, 3000)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          setMsg(t('login.msgRateLimited'), 'warning')
        } else if (error.message.includes('Invalid login credentials')) {
          setMsg(t('login.msgInvalidCredentials'), 'error')
        } else {
          setMsg(t('login.msgLoginError'), 'error')
        }
        console.error('Login error:', error)
        return
      }

      if (data.user) {
        // 이메일 인증 확인
        if (!data.user.email_confirmed_at) {
          setMsg(t('login.msgEmailNotVerified'), 'error')
          await supabase.auth.signOut()
          return
        }

        // 로그인 활동 로깅 (fire-and-forget, 로그인 프로세스 블로킹 방지)
        fetch('/api/activities/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(2000), // 2초 타임아웃
          body: JSON.stringify({
            action_type: 'login',
            target_type: 'system',
            metadata: {
              user_agent: navigator.userAgent,
              timestamp: new Date().toISOString(),
            },
          }),
        }).catch(logError => {
          // 로깅 실패는 로그인 과정을 방해하지 않음
          console.error('Failed to log login activity:', logError)
        })

        // 인증 상태 확인 후 안전한 리다이렉트
        setMsg(t('login.msgLoggingIn'), 'loading')

        // 인증 상태가 완전히 설정될 때까지 기다린 후 리다이렉트
        await waitForAuthStateAndRedirect()
      }
    } catch (error) {
      console.error('Unexpected error during login:', error)
      setMsg(t('login.msgUnexpectedError'), 'error')
    } finally {
      setLoading(false)
    }
  }

  // 모바일 환경 감지
  const isMobileDevice = () => {
    if (typeof window === 'undefined') return false

    const userAgent = window.navigator.userAgent.toLowerCase()
    const mobileKeywords = [
      'android',
      'iphone',
      'ipod',
      'ipad',
      'blackberry',
      'windows phone',
      'mobile',
    ]

    return (
      mobileKeywords.some(keyword => userAgent.includes(keyword)) ||
      window.innerWidth <= 768 ||
      'ontouchstart' in window
    )
  }

  // 모바일에서는 로딩 화면을 건너뛰고 바로 렌더링 (하얀 화면 문제 방지)
  const isMobile = typeof window !== 'undefined' && isMobileDevice()

  // 페이지 안정화 중이면 로딩 표시 (모바일 제외)
  if (!isMobile && (pageLoading || !isReady)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('login.pageLoading')}</p>
        </div>
      </div>
    )
  }

  const msgClassMap: Record<MessageType, string> = {
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    success: 'bg-green-50 text-green-800 border border-green-200',
    loading: 'bg-blue-50 text-blue-800 border border-blue-200',
    error: 'bg-red-50 text-red-800 border border-red-200',
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        {/* 헤더 섹션 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-primary-100 mb-6">
            <svg
              className="h-8 w-8 text-primary-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
              />
            </svg>
          </div>
          <h1 className="tw-heading-secondary mb-4">{t('login.heading')}</h1>
          <p className="tw-text-body text-gray-600">
            {t('login.subtitleLine1')}
            <br />
            {t('login.subtitleLine2')}
          </p>
        </div>

        {/* 메시지 표시 */}
        {message && (
          <div className={`mb-8 p-4 sm:p-6 rounded-xl shadow-sm ${msgClassMap[messageType]}`}>
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {messageType === 'warning' ? (
                  <svg
                    className="h-5 w-5 text-amber-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : messageType === 'success' ? (
                  <svg
                    className="h-5 w-5 text-green-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : messageType === 'loading' ? (
                  <svg
                    className="h-5 w-5 text-blue-400 mt-0.5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                ) : (
                  <svg
                    className="h-5 w-5 text-red-400 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <div className="text-sm leading-relaxed">{message}</div>
              </div>
            </div>
          </div>
        )}

        {/* 폼 섹션 */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
          {isAlreadyLoggedIn ? (
            /* 이미 로그인된 사용자를 위한 UI */
            <div className="p-8 text-center">
              <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-green-100 mb-6">
                <svg className="h-8 w-8 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {justAuthenticated ? t('login.loginSuccess') : t('login.alreadyLoggedIn')}
              </h2>
              <p className="text-gray-600 mb-6">
                {t('login.alreadyLoggedInBody', {
                  name: currentUser?.profile?.display_name || currentUser?.email || '',
                })}
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => router.push(hasExplicitRedirect ? explicitRedirectPath : '/board')}
                  className="w-full tw-btn-primary"
                >
                  {t('login.goToBoard')}
                </button>
                <button onClick={() => router.push('/mypage')} className="w-full tw-btn-secondary">
                  {t('login.goToMypage')}
                </button>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut()
                    setIsAlreadyLoggedIn(false)
                    setJustAuthenticated(false)
                    setCurrentUser(null)
                    setMsg(t('login.msgLoggedOut'), 'success')
                  }}
                  className="w-full text-gray-500 hover:text-gray-700 py-2 text-sm"
                >
                  {t('login.switchAccount')}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="p-8 space-y-6">
              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="email-address"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    {t('login.emailLabel')}
                  </label>
                  <input
                    id="email-address"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50 disabled:text-gray-500"
                    placeholder={t('login.emailPlaceholder')}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    {t('login.passwordLabel')}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50 disabled:text-gray-500"
                    placeholder={t('login.passwordPlaceholder')}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <div className="text-right mt-2">
                    <Link
                      href="/forgot-password"
                      className="text-sm font-medium text-primary-600 hover:text-primary-500 transition-colors"
                    >
                      {t('login.forgotPasswordLink')}
                    </Link>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      {t('login.submittingButton')}
                    </span>
                  ) : (
                    t('login.submitButton')
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 하단 링크 */}
        <div className="text-center mt-8">
          <p className="text-gray-600">
            {t('login.noAccountPrompt')}{' '}
            <Link
              href="/signup"
              className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
            >
              {t('login.signupLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
