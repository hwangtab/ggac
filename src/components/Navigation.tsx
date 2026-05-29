'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'

// Supabase 클라이언트는 dynamic import — 초기 vendors 번들에서 분리해 LCP/FCP 가속.
// 인증 UI는 loading 상태로 시작했다가 마운트 직후 비동기로 채워진다.
import NotificationDropdown from './NotificationDropdown'
import LocaleSwitcher from './LocaleSwitcher'

type NavProfile = { is_director: boolean; is_admin: boolean } | null

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  // 상단 고정 헤더 투명/불투명 제어
  const [isAtTop, setIsAtTop] = useState(true)
  const [hasScrollSync, setHasScrollSync] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [navProfile, setNavProfile] = useState<NavProfile>(null)
  const [loading, setLoading] = useState(true)
  // i18n usePathname은 locale prefix 없는 경로를 반환한다.
  // /en 홈에서도 pathname === '/' 로 평가되어 투명 헤더가 올바르게 동작한다.
  const pathname = usePathname() || ''
  const router = useRouter()
  const t = useTranslations()

  // 홈페이지인지 확인
  const isHomePage = pathname === '/'

  // 이사회 링크 노출 여부 (이사 또는 관리자)
  const showBoardRoom = !!(navProfile?.is_director || navProfile?.is_admin)

  // 간소화된 색상 로직
  const isDark = isHomePage && isAtTop
  const textColor = isDark ? 'text-white' : 'text-gray-700'
  const activeColor = isDark ? 'text-accent-300' : 'text-primary-600'
  const hoverColor = isDark ? 'hover:text-accent-300' : 'hover:text-primary-600'

  const menuItems = [
    { href: '/', label: 'HOME' },
    { href: '/about', label: 'ABOUT' },
    { href: '/archive', label: 'PROJECTS' },
    { href: '/artists', label: 'ARTISTS' },
    { href: '/board', label: 'BOARD' },
    // 이사회: 이사/관리자에게만 노출, 게시판(BOARD) 다음에 배치
    ...(showBoardRoom ? [{ href: '/board-room', label: 'DIRECTORS' }] : []),
    { href: '/connect', label: 'CONNECT' },
  ]

  // 현재 경로 활성 판정(하위 경로 포함: /board-room/meetings 등에서도 활성)
  const isItemActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))

  // 스크롤 이벤트: 초기 위치 포함해 즉시 평가
  useEffect(() => {
    // Hint Next.js to prefetch board route for faster nav
    try {
      if (pathname !== '/board') router.prefetch('/board')
    } catch {}

    const syncScrollState = () => {
      setIsAtTop(window.scrollY <= 50)
      setHasScrollSync(true)
    }

    // 초기 상태를 첫 페인트 전에 최대한 맞추고, 브라우저 스크롤 복원도 한 번 더 반영한다.
    syncScrollState()
    const frame = window.requestAnimationFrame(syncScrollState)
    const timer = window.setTimeout(syncScrollState, 120)

    window.addEventListener('scroll', syncScrollState, { passive: true })
    return () => {
      window.removeEventListener('scroll', syncScrollState)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [pathname, router])

  // 사용자 인증 상태 관리 — Supabase 클라이언트를 dynamic import로 분리
  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | undefined

    const fetchNavProfile = async (supabase: any, userId: string) => {
      try {
        const { data } = await supabase
          .from('member_profiles')
          .select('is_director, is_admin')
          .eq('id', userId)
          .single()
        if (mounted) {
          setNavProfile(
            data ? { is_director: !!data.is_director, is_admin: !!data.is_admin } : null
          )
        }
      } catch {
        if (mounted) setNavProfile(null)
      }
    }

    ;(async () => {
      try {
        const { supabase } = await import('@/lib/supabase/client')
        if (!mounted) return

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (mounted) {
          if (error) {
            console.error('Session error in Navigation:', error)
            setUser(null)
            setNavProfile(null)
          } else {
            setUser(session?.user || null)
            if (session?.user) {
              await fetchNavProfile(supabase, session.user.id)
            }
          }
          setLoading(false)
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (mounted) {
            setUser(nextSession?.user || null)
            if (nextSession?.user) {
              fetchNavProfile(supabase, nextSession.user.id)
            } else {
              setNavProfile(null)
            }
            setLoading(false)
          }
        })
        unsubscribe = () => subscription.unsubscribe()
      } catch (error) {
        console.error('Error initializing Supabase in Navigation:', error)
        if (mounted) {
          setUser(null)
          setNavProfile(null)
          setLoading(false)
        }
      }
    })()

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const handleLogout = async () => {
    try {
      const { supabase } = await import('@/lib/supabase/client')
      await supabase.auth.signOut()
      router.push('/')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  return (
    <nav
      id="navigation"
      role="navigation"
      aria-label={t('nav.mainNav')}
      data-at-top={isAtTop ? 'true' : 'false'}
      className={`fixed top-0 left-0 right-0 z-50 ${
        hasScrollSync ? 'transition-all duration-300' : 'transition-none'
      } ${isHomePage && isAtTop ? 'bg-transparent' : 'bg-white/90 backdrop-blur-md shadow-sm'}`}
    >
      <div className="tw-container-custom">
        <div className="flex items-center justify-between h-16 md:h-20 overflow-x-hidden">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-3">
            <div
              className={`relative w-10 h-10 transition-all duration-300 ${
                isDark ? 'brightness-0 invert' : ''
              }`}
            >
              <Image
                src="/images/logo/gac_logo.webp"
                alt={t('common.brandShort')}
                fill
                sizes="40px"
                className="object-contain"
                priority
              />
            </div>
            <span className={`font-serif font-bold text-xl hidden sm:inline ${textColor}`}>
              {t('common.brandShort')}
            </span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden lg:flex items-center space-x-6">
            {/* Main Navigation */}
            <div className="flex items-center space-x-4 lg:space-x-6">
              {menuItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={item.href === '/board'}
                  className={`font-medium transition-colors duration-300 ${
                    isItemActive(item.href) ? activeColor : `${textColor} ${hoverColor}`
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Auth Section */}
            <div className="flex items-center space-x-2 lg:space-x-4 ml-2 lg:ml-4 pl-2 lg:pl-4 border-l border-gray-300/20">
              {loading ? (
                <div className="w-20 h-6" />
              ) : user ? (
                <>
                  {/* 알림 드롭다운 */}
                  <NotificationDropdown isDark={isDark} />

                  <Link
                    href="/mypage"
                    className={`font-medium transition-colors duration-300 text-xs lg:text-sm ${
                      pathname.startsWith('/mypage') ? activeColor : `${textColor} ${hoverColor}`
                    }`}
                  >
                    {t('nav.mypage')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className={`font-medium transition-colors duration-300 text-xs lg:text-sm ${textColor} ${hoverColor}`}
                  >
                    {t('nav.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className={`font-medium transition-colors duration-300 text-xs lg:text-sm ${
                      pathname === '/login' ? activeColor : `${textColor} ${hoverColor}`
                    }`}
                  >
                    {t('nav.login')}
                  </Link>
                  <Link
                    href="/signup"
                    className={`font-medium transition-colors duration-300 text-xs lg:text-sm px-2 lg:px-3 py-1 rounded-md ${
                      pathname === '/signup'
                        ? 'bg-primary-600 text-white'
                        : isDark
                          ? 'bg-accent-300 text-gray-900 hover:bg-accent-400'
                          : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {t('nav.join')}
                  </Link>
                </>
              )}

              <LocaleSwitcher
                className={textColor}
                activeClassName={`font-semibold ${activeColor}`}
                inactiveClassName={`opacity-60 hover:opacity-100 ${textColor}`}
                separatorClassName="opacity-30"
              />
            </div>
          </div>

          {/* Tablet Menu */}
          <div className="hidden md:flex lg:hidden items-center space-x-2 flex-shrink-0">
            {/* Simplified tablet menu with key items */}
            <Link
              href="/"
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/' ? activeColor : `${textColor} ${hoverColor}`
              }`}
            >
              HOME
            </Link>
            <Link
              href="/about"
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/about' ? activeColor : `${textColor} ${hoverColor}`
              }`}
            >
              ABOUT
            </Link>
            <Link
              href="/archive"
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/archive' ? activeColor : `${textColor} ${hoverColor}`
              }`}
            >
              PROJECT
            </Link>
            <Link
              href="/artists"
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/artists' ? activeColor : `${textColor} ${hoverColor}`
              }`}
            >
              ARTIST
            </Link>
            <Link
              href="/board"
              prefetch
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/board' ? activeColor : `${textColor} ${hoverColor}`
              }`}
            >
              BOARD
            </Link>
            {showBoardRoom && (
              <Link
                href="/board-room"
                className={`font-medium transition-colors duration-300 text-xs ${
                  pathname.startsWith('/board-room') ? activeColor : `${textColor} ${hoverColor}`
                }`}
              >
                DIRECTORS
              </Link>
            )}

            {/* Tablet Auth Section */}
            <div className="flex items-center space-x-1 ml-1 pl-1 border-l border-gray-300/20">
              {loading ? (
                <div className="w-12 h-6" />
              ) : user ? (
                <>
                  <Link
                    href="/mypage"
                    className={`font-medium transition-colors duration-300 text-xs ${
                      pathname.startsWith('/mypage') ? activeColor : `${textColor} ${hoverColor}`
                    }`}
                  >
                    {t('nav.mypage')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className={`font-medium transition-colors duration-300 text-xs ${textColor} ${hoverColor}`}
                  >
                    {t('nav.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className={`font-medium transition-colors duration-300 text-xs ${
                      pathname === '/login' ? activeColor : `${textColor} ${hoverColor}`
                    }`}
                  >
                    {t('nav.login')}
                  </Link>
                  <Link
                    href="/signup"
                    className={`font-medium transition-colors duration-300 text-xs px-2 py-1 rounded-md ${
                      pathname === '/signup'
                        ? 'bg-primary-600 text-white'
                        : isDark
                          ? 'bg-accent-300 text-gray-900 hover:bg-accent-400'
                          : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {t('nav.joinShort')}
                  </Link>
                </>
              )}

              <LocaleSwitcher
                className={textColor}
                activeClassName={`font-semibold ${activeColor}`}
                inactiveClassName={`opacity-60 hover:opacity-100 ${textColor}`}
                separatorClassName="opacity-30"
              />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            id="mobile-menu-button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`md:hidden p-2 rounded-md transition-colors duration-300 ${textColor} ${hoverColor} focus:outline-none focus:ring-2 focus:ring-primary-500`}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            aria-label={isMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          >
            <span className="sr-only">{isMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}</span>
            <div className="w-6 h-6 flex flex-col justify-center items-center">
              <span
                className={`bg-current h-0.5 w-6 transition-all duration-300 ${
                  isMenuOpen ? 'rotate-45 translate-y-0.5' : ''
                }`}
              />
              <span
                className={`bg-current h-0.5 w-6 mt-1 transition-all duration-300 ${
                  isMenuOpen ? 'opacity-0' : ''
                }`}
              />
              <span
                className={`bg-current h-0.5 w-6 mt-1 transition-all duration-300 ${
                  isMenuOpen ? '-rotate-45 -translate-y-1.5' : ''
                }`}
              />
            </div>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div
            id="mobile-menu"
            className="md:hidden absolute left-4 right-4 top-full mt-2 z-50"
            role="menu"
            aria-labelledby="mobile-menu-button"
          >
            <div
              className={`rounded-lg shadow-lg p-2 border ${
                isHomePage && isAtTop
                  ? 'bg-gray-900/95 backdrop-blur-md text-white'
                  : 'bg-white/95 backdrop-blur-md border-gray-200/20'
              }`}
            >
              {/* Main Menu Items */}
              {menuItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={item.href === '/board'}
                  onClick={() => {
                    setIsMenuOpen(false)
                  }}
                  className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                    isItemActive(item.href)
                      ? `${activeColor} ${isHomePage && isAtTop ? 'bg-white/10' : 'bg-primary-50'}`
                      : `${textColor} ${hoverColor} ${isHomePage && isAtTop ? 'hover:bg-white/10' : 'hover:bg-gray-50'}`
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {/* Mobile Auth Section */}
              <div
                className={`border-t mt-2 pt-2 ${isHomePage && isAtTop ? 'border-white/20' : 'border-gray-200/50'}`}
              >
                {loading ? null : user ? (
                  <>
                    <Link
                      href="/mypage"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                        pathname.startsWith('/mypage')
                          ? `${activeColor} ${isHomePage && isAtTop ? 'bg-white/10' : 'bg-primary-50'}`
                          : `${textColor} ${hoverColor} ${isHomePage && isAtTop ? 'hover:bg-white/10' : 'hover:bg-gray-50'}`
                      }`}
                    >
                      {t('nav.mypage')}
                    </Link>
                    <button
                      onClick={() => {
                        handleLogout()
                        setIsMenuOpen(false)
                      }}
                      className={`block w-full text-left py-3 px-4 rounded-md transition-colors duration-200 ${textColor} ${hoverColor} ${isHomePage && isAtTop ? 'hover:bg-white/10' : 'hover:bg-gray-50'}`}
                    >
                      {t('nav.logout')}
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                        pathname === '/login'
                          ? `${activeColor} ${isHomePage && isAtTop ? 'bg-white/10' : 'bg-primary-50'}`
                          : `${textColor} ${hoverColor} ${isHomePage && isAtTop ? 'hover:bg-white/10' : 'hover:bg-gray-50'}`
                      }`}
                    >
                      {t('nav.login')}
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 font-medium text-white bg-primary-600 ${isHomePage && isAtTop ? 'hover:bg-primary-700' : 'hover:bg-primary-700'}`}
                    >
                      {t('nav.join')}
                    </Link>
                  </>
                )}

                {/* 언어 전환 */}
                <div className="flex items-center justify-center mt-3 pb-1">
                  <LocaleSwitcher
                    className={isHomePage && isAtTop ? 'text-gray-300' : 'text-gray-600'}
                    activeClassName={
                      isHomePage && isAtTop
                        ? 'font-semibold text-accent-300'
                        : 'font-semibold text-primary-600'
                    }
                    inactiveClassName={`${isHomePage && isAtTop ? 'text-gray-300' : 'text-gray-600'} hover:opacity-100`}
                    separatorClassName={
                      isHomePage && isAtTop
                        ? 'opacity-30 text-gray-300'
                        : 'opacity-30 text-gray-600'
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

export default Navigation
