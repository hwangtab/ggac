'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase/client'
import { useStablePageLoad, useSafeNavigation } from '@/utils/routeProtection'

type MessageType = 'error' | 'warning' | 'success' | 'loading'

export default function LoginPage() {
  const t = useTranslations('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<MessageType>('error')
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentUser, setCurrentUser] = useState<
    (User & { profile?: { display_name?: string } }) | null
  >(null)
  const router = useRouter()
  const { isLoading: pageLoading, isReady } = useStablePageLoad('/login')
  const { navigateWithRetry } = useSafeNavigation()

  const setMsg = (msg: string, type: MessageType) => {
    setMessage(msg)
    setMessageType(type)
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
    const checkAuthStatus = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (session?.user) {
          setIsAlreadyLoggedIn(true)
          setCurrentUser(session.user)

          // 사용자 프로필 정보 가져오기
          const { data: profile } = await supabase
            .from('member_profiles')
            .select('registration_status, is_active, display_name')
            .eq('id', session.user.id)
            .single()

          if (profile) {
            setCurrentUser({ ...session.user, profile })
          }
        }
      } catch (error) {
        console.error('인증 상태 확인 중 오류:', error)
      }
    }

    checkAuthStatus()
  }, [])

  // 안전한 리다이렉트 함수 (모바일 최적화 버전)
  const waitForAuthStateAndRedirect = async () => {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('🔄 [LOGIN DEBUG] Starting auth state confirmation...')
      }
      setMsg(t('login.msgLoggingIn'), 'loading')

      const isMobile = isMobileDeviceForAuth()
      if (process.env.NODE_ENV === 'development') {
        console.log(`📱 [LOGIN DEBUG] Mobile device detected: ${isMobile}`)
      }

      // 모바일에서는 더 긴 재시도 로직 (네트워크 불안정성 고려)
      let session: any = null
      let profile: any = null
      let retries = 0
      const maxRetries = isMobile ? 5 : 3
      const retryDelay = isMobile ? 500 : 200
      let lastProfileError: any = null

      while (retries < maxRetries) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `🔄 [LOGIN DEBUG] Session check attempt ${retries + 1}/${maxRetries} (Mobile: ${isMobile})`
          )
        }

        const {
          data: { session: currentSession },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (currentSession && !sessionError) {
          session = currentSession
          // 프로필 확인은 시도하되, 실패하더라도 리다이렉트는 진행 (미들웨어가 최종 판정)
          try {
            const { data: currentProfile, error: profileError } = await supabase
              .from('member_profiles')
              .select('registration_status, is_active, display_name')
              .eq('id', currentSession.user.id)
              .single()
            if (currentProfile && !profileError) {
              profile = currentProfile
              if (process.env.NODE_ENV === 'development') {
                console.log('✅ [LOGIN DEBUG] Session and profile confirmed')
              }
            } else {
              lastProfileError = profileError
              if (process.env.NODE_ENV === 'development') {
                console.log(
                  '⚠️ [LOGIN DEBUG] Profile fetch failed, will fallback to middleware redirect'
                )
              }
            }
          } catch (e) {
            lastProfileError = e
            if (process.env.NODE_ENV === 'development') {
              console.log(
                '⚠️ [LOGIN DEBUG] Profile fetch exception, will fallback to middleware redirect'
              )
            }
          }
          break
        }

        retries++
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }

      // 세션이 확인되면, 프로필 여부와 관계없이 우선 라우팅
      if (!session) {
        if (process.env.NODE_ENV === 'development') {
          console.error('❌ [LOGIN DEBUG] No session confirmed - falling back to direct navigation')
        }
        // 세션 확인이 지연되어도 라우팅을 트리거해 미들웨어로 판정 위임
        navigateWithRetry('/board', isMobile ? 5 : 3)
        return
      }

      // 프로필이 있으면 상태에 맞춰 라우팅, 없으면 게시판으로 위임
      if (profile && profile.registration_status === 'approved' && profile.is_active) {
        if (process.env.NODE_ENV === 'development') {
          console.log('🎯 [LOGIN DEBUG] Approved user, redirecting to board...')
        }
        setMsg(t('login.msgVerified'), 'success')

        // 모바일에서의 세션 동기화를 고려한 지연 후 안전한 네비게이션
        const redirectDelay = isMobile ? 800 : 300
        setTimeout(() => {
          if (process.env.NODE_ENV === 'development') {
            console.log('🚀 [LOGIN DEBUG] Redirecting to board with retry...')
          }
          navigateWithRetry('/board', isMobile ? 5 : 3)
        }, redirectDelay)
      } else if (profile && profile.registration_status === 'pending') {
        console.log('⏳ [LOGIN DEBUG] Pending user, redirecting to pending page...')
        setMsg(t('login.msgPending'), 'loading')
        router.push('/register/pending')
      } else if (profile && profile.registration_status === 'rejected') {
        console.log('❌ [LOGIN DEBUG] Rejected user, redirecting to rejected page...')
        setMsg(t('login.msgRejected'), 'error')
        router.push('/register/rejected')
      } else {
        // 프로필을 못가져오거나 알 수 없는 상태: 게시판으로 보내고 미들웨어에 판정 위임
        if (process.env.NODE_ENV === 'development') {
          console.log(
            '❓ [LOGIN DEBUG] Profile missing or unknown - navigating to board and delegating to middleware',
            lastProfileError
          )
        }
        navigateWithRetry('/board', isMobile ? 5 : 3)
      }
    } catch (error) {
      console.error('💥 [LOGIN DEBUG] Error during auth state confirmation:', error)
      setMsg(t('login.msgAuthError'), 'error')
      // 에러 발생 시 3초 후 홈으로 이동
      setTimeout(() => {
        router.push('/')
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
            target_type: 'auth',
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
              <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('login.alreadyLoggedIn')}</h2>
              <p className="text-gray-600 mb-6">
                {t('login.alreadyLoggedInBody', {
                  name: currentUser?.profile?.display_name || currentUser?.email || '',
                })}
              </p>
              <div className="space-y-3">
                <button onClick={() => router.push('/board')} className="w-full tw-btn-primary">
                  {t('login.goToBoard')}
                </button>
                <button onClick={() => router.push('/mypage')} className="w-full tw-btn-secondary">
                  {t('login.goToMypage')}
                </button>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut()
                    setIsAlreadyLoggedIn(false)
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
