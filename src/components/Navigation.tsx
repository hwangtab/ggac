'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import {
  clearSessionProfileCache,
  fetchSessionProfile,
  SESSION_CHANGE_EVENT,
  type VerifiedSessionUser,
} from '@/utils/sessionProfile'

import NotificationDropdown from './NotificationDropdown'
import LocaleSwitcher from './LocaleSwitcher'

type NavProfile = { is_director: boolean; is_admin: boolean; is_auditor: boolean } | null

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  // 상단 고정 헤더 투명/불투명 제어
  const [isAtTop, setIsAtTop] = useState(true)
  const [hasScrollSync, setHasScrollSync] = useState(false)
  const [user, setUser] = useState<VerifiedSessionUser | null>(null)
  const [navProfile, setNavProfile] = useState<NavProfile>(null)
  const [loading, setLoading] = useState(true)
  // i18n usePathname은 locale prefix 없는 경로를 반환한다.
  // /en 홈에서도 pathname === '/' 로 평가되어 투명 헤더가 올바르게 동작한다.
  const pathname = usePathname() || ''
  const router = useRouter()
  const t = useTranslations()

  // 홈페이지인지 확인
  const isHomePage = pathname === '/'

  // 이사회 링크 노출 여부 (이사 · 관리자 · 감사)
  const showBoardRoom = !!(
    navProfile?.is_director ||
    navProfile?.is_admin ||
    navProfile?.is_auditor
  )

  // 사이트 전체가 다크 포스터 테마다. 내비도 항상 다크로 유지한다.
  const isDark = true
  const textColor = isDark ? 'text-white' : 'text-gray-700'
  const activeColor = isDark ? 'text-accent-300' : 'text-primary-600'
  const hoverColor = isDark ? 'hover:text-accent-300' : 'hover:text-primary-600'

  const menuItems = [
    { href: '/', label: 'HOME' },
    { href: '/about', label: 'ABOUT' },
    { href: '/projects', label: 'PROJECT' },
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

  // 사용자 인증 상태 관리는 서버 쿠키 세션 API를 단일 진실로 사용한다.
  useEffect(() => {
    let mounted = true

    const loadNavigationSession = async () => {
      try {
        const session = await fetchSessionProfile()
        if (mounted) {
          setUser(session.user)
          setNavProfile(
            session.profile
              ? {
                  is_director: !!session.profile.is_director,
                  is_admin: !!session.profile.is_admin,
                  is_auditor: !!session.profile.is_auditor,
                }
              : null
          )
          setLoading(false)
        }
      } catch {
        if (mounted) {
          setUser(null)
          setNavProfile(null)
          setLoading(false)
        }
      }
    }

    const refreshWhenVisible = () => {
      if (!document.hidden) {
        void loadNavigationSession()
      }
    }

    void loadNavigationSession()
    window.addEventListener('focus', loadNavigationSession)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    // 로그인 페이지에 머문 채 인증이 끝나는 경로에서는 pathname이 안 바뀌므로
    // 이 이벤트가 없으면 내비가 로그인 전 메뉴(이사회 링크 없음)로 남는다.
    window.addEventListener(SESSION_CHANGE_EVENT, loadNavigationSession)

    return () => {
      mounted = false
      window.removeEventListener('focus', loadNavigationSession)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener(SESSION_CHANGE_EVENT, loadNavigationSession)
    }
  }, [pathname])

  const handleLogout = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Logout failed: ${response.status}`)
      }

      // 세션 캐시를 비워 다른 소비자(활동 추적·좋아요 훅)가 30초간 낡은
      // 인증 상태를 읽지 않게 한다.
      clearSessionProfileCache()
      setUser(null)
      setNavProfile(null)
      setIsMenuOpen(false)
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Error signing out:', error)
      setLoading(false)
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
      } ${
        isAtTop && isHomePage
          ? 'bg-transparent'
          : 'bg-[#08080a]/85 backdrop-blur-md border-b border-white/10'
      }`}
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
                      // 앰버 위의 글자는 반드시 검정이다. 테마 오버라이드에 기대지 않고
                      // 여기서 확정한다(홈처럼 내비가 투명한 상태에서도 동일하게 유지).
                      pathname === '/signup'
                        ? 'bg-accent-400 !text-black'
                        : 'bg-accent-300 !text-black hover:bg-accent-400'
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
              href="/projects"
              className={`font-medium transition-colors duration-300 text-xs ${
                pathname === '/projects' ? activeColor : `${textColor} ${hoverColor}`
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
                      // 앰버 위의 글자는 반드시 검정이다. 테마 오버라이드에 기대지 않고
                      // 여기서 확정한다(홈처럼 내비가 투명한 상태에서도 동일하게 유지).
                      pathname === '/signup'
                        ? 'bg-accent-400 !text-black'
                        : 'bg-accent-300 !text-black hover:bg-accent-400'
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
                  // 막대 중심선 간격이 6px(막대 2px + mt-1 4px)이라 위/아래가 각각
                  // ±6px 이동해야 정확히 가운데서 교차한다. 값이 어긋나면 X가 찌그러진다.
                  isMenuOpen ? 'rotate-45 translate-y-1.5' : ''
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
            {/*
              패널은 fixed 내비 안의 absolute라 넘친 부분은 페이지 스크롤로 닿지 않는다.
              항목이 늘거나(이사회 링크) 화면이 짧으면 아래쪽 항목이 그대로 잘리므로
              뷰포트에 맞춰 자체 스크롤한다. dvh는 모바일 주소창 높이 변화를 반영한다.
            */}
            <div
              className={`max-h-[calc(100dvh-5.5rem)] overflow-y-auto overscroll-contain rounded-lg shadow-lg p-2 border ${'bg-[#08080a]/95 backdrop-blur-md text-white'}`}
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
                      ? `${activeColor} ${'bg-white/10'}`
                      : `${textColor} ${hoverColor} ${'hover:bg-white/10'}`
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {/* Mobile Auth Section */}
              <div className={`border-t mt-2 pt-2 ${'border-white/20'}`}>
                {loading ? null : user ? (
                  <>
                    <Link
                      href="/mypage"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                        pathname.startsWith('/mypage')
                          ? `${activeColor} ${'bg-white/10'}`
                          : `${textColor} ${hoverColor} ${'hover:bg-white/10'}`
                      }`}
                    >
                      {t('nav.mypage')}
                    </Link>
                    <button
                      onClick={() => {
                        handleLogout()
                        setIsMenuOpen(false)
                      }}
                      className={`block w-full text-left py-3 px-4 rounded-md transition-colors duration-200 ${textColor} ${hoverColor} ${'hover:bg-white/10'}`}
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
                          ? `${activeColor} ${'bg-white/10'}`
                          : `${textColor} ${hoverColor} ${'hover:bg-white/10'}`
                      }`}
                    >
                      {t('nav.login')}
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 font-medium text-white bg-primary-600 ${isHomePage ? 'hover:bg-primary-700' : 'hover:bg-primary-700'}`}
                    >
                      {t('nav.join')}
                    </Link>
                  </>
                )}

                {/* 언어 전환 */}
                <div className="flex items-center justify-center mt-3 pb-1">
                  <LocaleSwitcher
                    className={isHomePage ? 'text-gray-300' : 'text-gray-600'}
                    activeClassName={
                      isHomePage
                        ? 'font-semibold text-accent-300'
                        : 'font-semibold text-primary-600'
                    }
                    inactiveClassName={`${isHomePage ? 'text-gray-300' : 'text-gray-600'} hover:opacity-100`}
                    separatorClassName={
                      isHomePage ? 'opacity-30 text-gray-300' : 'opacity-30 text-gray-600'
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
