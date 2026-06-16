'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

const isDevelopment = process.env.NODE_ENV === 'development'

const debugRouteProtection = (message: string, ...args: unknown[]) => {
  if (isDevelopment) {
    console.log(message, ...args)
  }
}

const warnRouteProtection = (message: string, ...args: unknown[]) => {
  if (isDevelopment) {
    console.warn(message, ...args)
  }
}

const errorRouteProtection = (message: string, ...args: unknown[]) => {
  if (isDevelopment) {
    console.error(message, ...args)
  }
}

// 모바일 디바이스 감지 유틸리티
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

// 네트워크 상태 감지 유틸리티
const isOnline = () => {
  if (typeof window === 'undefined') return true
  return window.navigator.onLine
}

const getLocalizedBrowserPath = (path: string, locale: string) => {
  if (typeof window === 'undefined') return path

  const parsed = new URL(path, window.location.origin)
  const segments = parsed.pathname.split('/')
  const pathLocale = segments[1]
  const hasLocalePrefix = routing.locales.some(supportedLocale => supportedLocale === pathLocale)

  if (!hasLocalePrefix && locale !== routing.defaultLocale) {
    parsed.pathname = `/${locale}${parsed.pathname === '/' ? '' : parsed.pathname}`
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

const getCurrentBrowserPath = () => {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

// 페이지 로딩 상태를 안정화하는 유틸리티 (모바일 최적화)
export const useStablePageLoad = (targetPath?: string) => {
  const [isLoading, setIsLoading] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [networkError, setNetworkError] = useState(false)

  useEffect(() => {
    let mounted = true
    let timer: NodeJS.Timeout
    let fallbackTimer: NodeJS.Timeout

    const initializePage = async () => {
      try {
        // 모바일 환경 감지
        const isMobile = isMobileDevice()

        // 모바일에서는 즉시 준비 완료로 설정하여 하얀 화면 문제 방지
        if (isMobile) {
          debugRouteProtection('📱 [ROUTE PROTECTION] Mobile detected - immediate ready state')
          if (mounted) {
            setIsLoading(false)
            setIsReady(true)
          }
          return
        }

        // 데스크탑에서는 최소한의 초기화 지연
        await new Promise(resolve => setTimeout(resolve, 50))

        if (!mounted) return

        // 빠른 페이지 준비
        timer = setTimeout(() => {
          if (mounted) {
            setIsLoading(false)
            setIsReady(true)
            debugRouteProtection('✅ [ROUTE PROTECTION] Page ready')
          }
        }, 30)

        // 안전장치: 최대 3초 후 강제 준비 완료
        fallbackTimer = setTimeout(() => {
          if (mounted) {
            warnRouteProtection('⚠️ [ROUTE PROTECTION] Fallback timeout - forcing ready state')
            setIsLoading(false)
            setIsReady(true)
          }
        }, 3000)
      } catch (error) {
        errorRouteProtection('💥 [ROUTE PROTECTION] Error initializing page:', error)
        if (mounted) {
          setIsLoading(false)
          setIsReady(true)
        }
      }
    }

    initializePage()

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [targetPath])

  return { isLoading, isReady, networkError }
}

// 네비게이션 안전 래퍼 (모바일 최적화)
export const useSafeNavigation = () => {
  const router = useRouter()
  const locale = useLocale()

  const navigateSafely = (path: string, delay?: number) => {
    const isMobile = isMobileDevice()
    const online = isOnline()

    // 모바일에서는 더 긴 지연 시간
    const defaultDelay = isMobile ? 300 : 100
    const actualDelay = delay ?? defaultDelay

    debugRouteProtection(
      `🚀 [SAFE NAVIGATION] Navigating to ${path} (Mobile: ${isMobile}, Delay: ${actualDelay}ms)`
    )

    if (!online) {
      warnRouteProtection('🌐 [SAFE NAVIGATION] Offline - navigation may fail')
    }

    // 미들웨어 처리 시간을 고려한 안전한 네비게이션
    setTimeout(() => {
      try {
        router.push(path)
      } catch (error) {
        errorRouteProtection('❌ [SAFE NAVIGATION] Router.push failed:', error)

        // 모바일에서는 fallback으로 window.location 사용
        if (isMobile) {
          debugRouteProtection('🔄 [SAFE NAVIGATION] Falling back to window.location')
          window.location.href = getLocalizedBrowserPath(path, locale)
        }
      }
    }, actualDelay)
  }

  const navigateWithRetry = (path: string, maxRetries = 3) => {
    const isMobile = isMobileDevice()
    let attempts = 0

    const attemptNavigation = () => {
      attempts++
      debugRouteProtection(
        `🔄 [SAFE NAVIGATION] Navigation attempt ${attempts}/${maxRetries} to ${path}`
      )
      const expectedBrowserPath = getLocalizedBrowserPath(path, locale)

      try {
        router.push(path)

        // 성공 확인을 위한 URL 체크
        setTimeout(
          () => {
            if (getCurrentBrowserPath() !== expectedBrowserPath && attempts < maxRetries) {
              debugRouteProtection(
                '⚠️ [SAFE NAVIGATION] Navigation seems to have failed, retrying...'
              )
              attemptNavigation()
            }
          },
          isMobile ? 1000 : 500
        )
      } catch (error) {
        errorRouteProtection(`❌ [SAFE NAVIGATION] Attempt ${attempts} failed:`, error)

        if (attempts < maxRetries) {
          setTimeout(attemptNavigation, 1000)
        } else {
          debugRouteProtection('🔄 [SAFE NAVIGATION] All attempts failed, using window.location')
          window.location.href = expectedBrowserPath
        }
      }
    }

    attemptNavigation()
  }

  return { navigateSafely, navigateWithRetry }
}

// 모바일 특화 에러 핸들링
export const useMobileErrorHandler = () => {
  const handleAuthError = (error: any, context: string) => {
    const isMobile = isMobileDevice()
    const online = isOnline()

    errorRouteProtection(
      `❌ [MOBILE ERROR] ${context} (Mobile: ${isMobile}, Online: ${online}):`,
      error
    )

    if (!online) {
      return {
        message: '네트워크 연결을 확인하고 다시 시도해주세요.',
        shouldRetry: true,
        retryDelay: 3000,
      }
    }

    if (isMobile && error.message?.includes('network')) {
      return {
        message: '모바일 네트워크가 불안정합니다. 잠시 후 다시 시도해주세요.',
        shouldRetry: true,
        retryDelay: 5000,
      }
    }

    if (error.message?.includes('session')) {
      return {
        message: '세션이 만료되었습니다. 다시 로그인해주세요.',
        shouldRetry: false,
        retryDelay: 0,
      }
    }

    return {
      message: '오류가 발생했습니다. 다시 시도해주세요.',
      shouldRetry: true,
      retryDelay: 2000,
    }
  }

  return { handleAuthError }
}
